/**
 * workers/compositor.worker.ts
 *
 * Dedicated Web Worker that holds a WebGPU device and an OffscreenCanvas.
 * Composites all visible clip layers for a single frame into the canvas,
 * applying per-clip transforms and color grading via WGSL shaders.
 *
 * Pre-compiles pipelines on init to achieve 60+ FPS compositing without
 * re-allocating GPU state on each frame.
 *
 * Falls back to Canvas2D drawImage when WebGPU is unavailable (Firefox/Safari).
 */

import type { TimelineTransform } from '../types'
import {
  VERTEX_QUAD_WGSL,
  GRADE_FRAGMENT_WGSL,
  COMPOSITE_FRAGMENT_WGSL,
} from '../lib/webgpu/shaders'

// WebGPU bitwise flag constants
const BUFFER_USAGE_UNIFORM_COPY_DST = 0x0040 | 0x0008 // GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
const TEXTURE_USAGE_RENDER_BINDING   = 0x10 | 0x04     // GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING

// ─── types ────────────────────────────────────────────────────────────────────

export interface LayerDescriptor {
  frame: VideoFrame
  transform: TimelineTransform
  opacity: number
  zIndex: number
}

interface GradeUniforms {
  exposure: number
  contrast: number
  saturation: number
  temperature: number
  tint: number
}

// ─── state ────────────────────────────────────────────────────────────────────

let canvas: OffscreenCanvas | null = null
let mode: 'webgpu' | 'canvas2d' = 'canvas2d'

// WebGPU cached state
let device: GPUDevice | null = null
let ctx: GPUCanvasContext | null = null
let canvasFormat: GPUTextureFormat = 'rgba8unorm'
let gradeBuffer: GPUBuffer | null = null
let transformBuffer: GPUBuffer | null = null
let defaultSampler: GPUSampler | null = null

// Cached WebGPU Pipelines
let gradePipeline: GPURenderPipeline | null = null
let compPipeline: GPURenderPipeline | null = null

// Canvas2D fallback state
let ctx2d: OffscreenCanvasRenderingContext2D | null = null

// ─── WebGPU init ──────────────────────────────────────────────────────────────

async function initWebGPU(offscreen: OffscreenCanvas): Promise<boolean> {
  try {
    if (typeof navigator === 'undefined' || !navigator.gpu) return false
    const adapter = await navigator.gpu.requestAdapter()
    if (!adapter) return false
    device = await adapter.requestDevice()
    ctx = offscreen.getContext('webgpu') as GPUCanvasContext
    canvasFormat = navigator.gpu.getPreferredCanvasFormat()
    ctx.configure({ device, format: canvasFormat, alphaMode: 'premultiplied' })

    // Pre-allocate uniform buffers
    gradeBuffer = device.createBuffer({
      size: 5 * 4,  // 5 x f32
      usage: BUFFER_USAGE_UNIFORM_COPY_DST,
    })
    transformBuffer = device.createBuffer({
      size: 12 * 4, // 12 x f32
      usage: BUFFER_USAGE_UNIFORM_COPY_DST,
    })

    defaultSampler = device.createSampler({
      minFilter: 'linear',
      magFilter: 'linear',
    })

    // Pre-compile shader modules and render pipelines once on init
    const quadModule = device.createShaderModule({ code: VERTEX_QUAD_WGSL })
    const gradeModule = device.createShaderModule({ code: GRADE_FRAGMENT_WGSL })
    const compModule = device.createShaderModule({ code: COMPOSITE_FRAGMENT_WGSL })

    gradePipeline = device.createRenderPipeline({
      layout: 'auto',
      vertex: { module: quadModule, entryPoint: 'vs_main' },
      fragment: {
        module: gradeModule,
        entryPoint: 'fs_grade',
        targets: [{ format: canvasFormat }],
      },
      primitive: { topology: 'triangle-list' },
    })

    compPipeline = device.createRenderPipeline({
      layout: 'auto',
      vertex: { module: quadModule, entryPoint: 'vs_main' },
      fragment: {
        module: compModule,
        entryPoint: 'fs_composite',
        targets: [{
          format: canvasFormat,
          blend: {
            color: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
            alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
          },
        }],
      },
      primitive: { topology: 'triangle-list' },
    })

    return true
  } catch {
    return false
  }
}

// ─── render helpers ───────────────────────────────────────────────────────────

function writeGradeBuffer(grade: GradeUniforms) {
  if (!device || !gradeBuffer) return
  device.queue.writeBuffer(
    gradeBuffer, 0,
    new Float32Array([
      grade.exposure ?? 1,
      grade.contrast ?? 1,
      grade.saturation ?? 1,
      grade.temperature ?? 0,
      grade.tint ?? 0,
    ]),
  )
}

function writeTransformBuffer(t: TimelineTransform) {
  if (!device || !transformBuffer) return
  device.queue.writeBuffer(
    transformBuffer, 0,
    new Float32Array([
      t.x ?? 0, t.y ?? 0,
      t.scaleX ?? 1, t.scaleY ?? 1,
      t.rotation ?? 0,
      t.opacity ?? 1,
      t.cropTop ?? 0, t.cropRight ?? 0,
      t.cropBottom ?? 0, t.cropLeft ?? 0,
      0, 0, // padding
    ]),
  )
}

/**
 * Render all layers via WebGPU.
 * Each layer goes through a grade pass (external texture → render texture),
 * then a composite pass (render texture → canvas surface).
 */
async function renderWebGPU(layers: LayerDescriptor[], grade: GradeUniforms): Promise<void> {
  if (!device || !ctx || !gradePipeline || !compPipeline || !defaultSampler) return

  const { width, height } = canvas!
  if (width <= 0 || height <= 0) return

  // Accumulator texture — starts transparent
  const accumTex = device.createTexture({
    size: [width, height],
    format: canvasFormat,
    usage: TEXTURE_USAGE_RENDER_BINDING,
  })

  writeGradeBuffer(grade)

  const cmdEncoder = device.createCommandEncoder()
  const sorted = [...layers].sort((a, b) => a.zIndex - b.zIndex)

  for (let i = 0; i < sorted.length; i++) {
    const layer = sorted[i]
    writeTransformBuffer(layer.transform)

    // Import VideoFrame as external texture (stays on GPU)
    const extTex = device.importExternalTexture({ source: layer.frame })

    // Grade render target
    const gradeTex = device.createTexture({
      size: [width, height],
      format: canvasFormat,
      usage: TEXTURE_USAGE_RENDER_BINDING,
    })

    // --- Grade pass ---
    const gradeBindGroup = device.createBindGroup({
      layout: gradePipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: extTex },
        { binding: 1, resource: defaultSampler },
        { binding: 2, resource: { buffer: transformBuffer! } },
        { binding: 3, resource: { buffer: gradeBuffer! } },
      ],
    })

    const gradePass = cmdEncoder.beginRenderPass({
      colorAttachments: [{
        view: gradeTex.createView(),
        loadOp: 'clear',
        storeOp: 'store',
        clearValue: { r: 0, g: 0, b: 0, a: 0 },
      }],
    })
    gradePass.setPipeline(gradePipeline)
    gradePass.setBindGroup(0, gradeBindGroup)
    gradePass.draw(6)
    gradePass.end()

    // --- Composite pass ---
    const opacityBuffer = device.createBuffer({
      size: 16,
      usage: BUFFER_USAGE_UNIFORM_COPY_DST,
      mappedAtCreation: true,
    })
    new Float32Array(opacityBuffer.getMappedRange()).set([layer.opacity ?? 1, 0, 0, 0])
    opacityBuffer.unmap()

    const compBindGroup = device.createBindGroup({
      layout: compPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: gradeTex.createView() },
        { binding: 1, resource: defaultSampler },
        { binding: 2, resource: accumTex.createView() },
        { binding: 3, resource: { buffer: opacityBuffer } },
      ],
    })

    const compPass = cmdEncoder.beginRenderPass({
      colorAttachments: [{
        view: ctx.getCurrentTexture().createView(),
        loadOp: i === 0 ? 'clear' : 'load',
        storeOp: 'store',
        clearValue: { r: 0, g: 0, b: 0, a: 1 },
      }],
    })
    compPass.setPipeline(compPipeline)
    compPass.setBindGroup(0, compBindGroup)
    compPass.draw(6)
    compPass.end()

    gradeTex.destroy()
    opacityBuffer.destroy()
  }

  device.queue.submit([cmdEncoder.finish()])
  accumTex.destroy()
}

/**
 * Canvas2D fallback — used when WebGPU is unavailable.
 * Applies CSS-equivalent grade as globalFilter and composites layers in order.
 */
function renderCanvas2D(layers: LayerDescriptor[], grade: GradeUniforms, w: number, h: number): void {
  if (!ctx2d) return
  ctx2d.clearRect(0, 0, w, h)

  const contrast   = Math.max(0, 1 + (grade.contrast   - 1) * 0.18)
  const saturate   = Math.max(0, 1 + (grade.saturation  - 1) * 0.2)
  const brightness = grade.exposure ?? 1

  ctx2d.filter = [
    `brightness(${brightness})`,
    `contrast(${contrast})`,
    `saturate(${saturate})`,
  ].join(' ')

  const sorted = [...layers].sort((a, b) => a.zIndex - b.zIndex)
  for (const layer of sorted) {
    const t = layer.transform
    ctx2d.save()
    ctx2d.globalAlpha = layer.opacity ?? 1
    if (t.rotation) {
      ctx2d.translate(w / 2 + (t.x ?? 0), h / 2 + (t.y ?? 0))
      ctx2d.rotate(t.rotation)
      ctx2d.translate(-(w / 2), -(h / 2))
    } else {
      ctx2d.translate(t.x ?? 0, t.y ?? 0)
    }
    ctx2d.scale(t.scaleX ?? 1, t.scaleY ?? 1)
    ctx2d.drawImage(layer.frame, 0, 0, w, h)
    ctx2d.restore()
  }

  ctx2d.filter = 'none'
}

// ─── message handler ──────────────────────────────────────────────────────────

self.onmessage = async (e: MessageEvent) => {
  const msg = e.data

  switch (msg.type) {
    case 'init': {
      canvas = msg.canvas as OffscreenCanvas
      const gpuOk = await initWebGPU(canvas)
      if (gpuOk) {
        mode = 'webgpu'
      } else {
        mode = 'canvas2d'
        ctx2d = canvas.getContext('2d') as OffscreenCanvasRenderingContext2D
      }
      postMessage({ type: 'ready', mode })
      break
    }

    case 'render': {
      const { layers, grade, width, height } = msg as {
        layers: LayerDescriptor[]
        grade: GradeUniforms
        width: number
        height: number
      }

      try {
        if (mode === 'webgpu') {
          await renderWebGPU(layers, grade)
        } else {
          renderCanvas2D(layers, grade, width, height)
        }

        // Close all transferred frames after rendering
        for (const l of layers) l.frame.close()

        postMessage({ type: 'rendered' })
      } catch (err) {
        for (const l of layers) { try { l.frame.close() } catch { /* noop */ } }
        postMessage({ type: 'error', message: String(err) })
      }
      break
    }

    case 'resize': {
      if (canvas) {
        canvas.width  = msg.width
        canvas.height = msg.height
      }
      break
    }

    case 'destroy': {
      device?.destroy()
      device = null
      gradePipeline = null
      compPipeline = null
      defaultSampler = null
      break
    }
  }
}
