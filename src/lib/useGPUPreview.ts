/**
 * lib/useGPUPreview.ts
 *
 * React hook that replaces the <video> element preview with a hardware-
 * accelerated WebCodecs decode → WebGPU composite pipeline.
 *
 * The hook manages:
 *  1. A VideoDecoder worker (per active video clip) for hardware-accelerated decoding
 *  2. A GPUCompositor that composites all visible layers via WGSL shaders
 *  3. Frame-accurate seeking: only fetches the chunks needed for the target timestamp
 *  4. Graceful fallback to Canvas2D when WebGPU is unavailable
 *
 * Usage:
 *   const canvasRef = useRef<HTMLCanvasElement>(null)
 *   useGPUPreview({ canvasRef, clips, currentTime, grade, isPlaying })
 */

import { useEffect, useRef, useCallback } from 'react'
import type { Clip, TimelineColor } from '../types'
import { detectGPUCapabilities } from './webgpu/capabilities'
import { GPUCompositor } from './webgpu/compositor'
import type { CompositorLayer } from './webgpu/compositor'
import { getDemuxResult, demuxRange } from './webcodecs/demuxer'
import { globalFrameCache } from './webcodecs/frameCache'
import { trackFrame } from './webcodecs/memoryGuard'

interface UseGPUPreviewOptions {
  canvasRef: React.RefObject<HTMLCanvasElement | null>
  /** Clips currently visible on screen (video + title tracks). */
  clips: Clip[]
  /** Current playhead time in seconds. */
  currentTime: number
  /** Global timeline color grade from the editor store. */
  grade: TimelineColor
  /** Whether the timeline is playing (used to pre-fetch upcoming frames). */
  isPlaying: boolean
  /** Output width in pixels (matches canvas display size). */
  width: number
  /** Output height in pixels. */
  height: number
}

/** Maps clipId → Worker instance */
type DecoderMap = Map<string, Worker>

// ─── main hook ────────────────────────────────────────────────────────────────

export function useGPUPreview({
  canvasRef,
  clips,
  currentTime,
  grade,
  isPlaying: _isPlaying,
  width,
  height,
}: UseGPUPreviewOptions): { gpuMode: string | null } {
  const compositorRef = useRef<GPUCompositor | null>(null)
  const decodersRef   = useRef<DecoderMap>(new Map())
  const gpuModeRef    = useRef<string | null>(null)
  const initdRef      = useRef(false)
  const rafRef        = useRef<number | null>(null)
  const lastTimeRef   = useRef<number>(-1)

  // ── initialise compositor once ────────────────────────────────────────────
  useEffect(() => {
    if (initdRef.current) return
    if (!canvasRef.current) return
    initdRef.current = true

    const canvas = canvasRef.current

    ;(async () => {
      const caps = await detectGPUCapabilities()
      const comp = new GPUCompositor()
      await comp.init(canvas)
      compositorRef.current = comp
      gpuModeRef.current = caps.renderMode
    })().catch(console.error)

    const decoders = decodersRef.current

    return () => {
      compositorRef.current?.destroy()
      for (const worker of decoders.values()) {
        worker.terminate()
      }
      decoders.clear()
    }
  }, [canvasRef])

  // ── resize compositor when dimensions change ──────────────────────────────
  useEffect(() => {
    compositorRef.current?.resize(width, height)
  }, [width, height])

  // ── decode & render on time change ────────────────────────────────────────
  const renderFrame = useCallback(async (time: number) => {
    const comp = compositorRef.current
    if (!comp) return

    const videoClips = clips.filter(
      (c) => (c.kind === 'video' || c.kind === 'title') && c.src,
    )

    const layers: CompositorLayer[] = []

    for (const clip of videoClips) {
      // Convert timeline time to source offset in microseconds
      const sourceOffsetSec = (time - clip.start) + (clip.sourceIn ?? 0)
      if (sourceOffsetSec < 0 || sourceOffsetSec > (clip.sourceDuration ?? Infinity)) continue

      const timestampUs = Math.round(sourceOffsetSec * 1e6)
      const src = clip.src!

      // ── check frame cache first ──────────────────────────────────────────
      let frame = globalFrameCache.get(clip.id, timestampUs) as VideoFrame | undefined

      if (!frame) {
        // ── decode a 1-frame window around the target timestamp ──────────────
        const decoded = await decodeFrameAt(clip.id, src, sourceOffsetSec, decodersRef.current)
        if (!decoded) continue
        frame = decoded
        globalFrameCache.put(
          clip.id,
          timestampUs,
          frame,
          frame.codedWidth,
          frame.codedHeight,
        )
      }

      layers.push({
        frame,
        transform: clip.transform ?? {},
        opacity: clip.transform?.opacity ?? 1,
        zIndex: clip.track === 'V2' ? 10 : 0,
      })
    }

    if (layers.length === 0) return

    await comp.renderFrame(layers, grade, width, height)
  }, [clips, grade, width, height])

  useEffect(() => {
    if (Math.abs(currentTime - lastTimeRef.current) < 0.001) return
    lastTimeRef.current = currentTime

    if (rafRef.current) cancelAnimationFrame(rafRef.current)
    rafRef.current = requestAnimationFrame(() => {
      renderFrame(currentTime).catch(console.error)
    })
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
    }
  }, [currentTime, renderFrame])

  return { gpuMode: gpuModeRef.current }
}

// ─── per-clip decoder ─────────────────────────────────────────────────────────

/**
 * Decodes a single VideoFrame at `sourceOffsetSec` for the given clip source.
 * Reuses (or creates) a dedicated Worker per clipId.
 */
async function decodeFrameAt(
  clipId: string,
  src: string,
  sourceOffsetSec: number,
  decoders: DecoderMap,
): Promise<VideoFrame | null> {
  return new Promise<VideoFrame | null>((resolve) => {
    ;(async () => {
      try {
        // Get or create decoder worker for this clip
        let worker = decoders.get(clipId)
        if (!worker) {
          worker = new Worker(
            new URL('../workers/videoDecoder.worker.ts', import.meta.url),
            { type: 'module' },
          )
          decoders.set(clipId, worker)
        }

        const { config } = await getDemuxResult(src)

        let resolved = false
        const handler = (e: MessageEvent) => {
          if (e.data.type === 'frame' && !resolved) {
            resolved = true
            worker!.removeEventListener('message', handler)
            // Track and immediately resolve — caller caches in globalFrameCache
            const tracked = trackFrame(e.data.frame as VideoFrame)
            resolve(tracked.inner)
          }
        }
        worker.addEventListener('message', handler)

        worker.postMessage({ type: 'configure', config })
        worker.postMessage({ type: 'reset' })

        // Demux the small window around the seek point
        for await (const chunk of demuxRange(src, Math.max(0, sourceOffsetSec - 0.5), sourceOffsetSec + 2)) {
          worker.postMessage({ type: 'decode', chunk })
        }
        worker.postMessage({ type: 'flush' })

        // Timeout safety — resolve null if no frame within 5 s
        setTimeout(() => {
          if (!resolved) {
            worker!.removeEventListener('message', handler)
            resolve(null)
          }
        }, 5000)
      } catch {
        resolve(null)
      }
    })()
  })
}
