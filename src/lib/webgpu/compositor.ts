/**
 * webgpu/compositor.ts
 *
 * Main-thread interface to compositor.worker.ts.
 * Creates the worker, transfers an OffscreenCanvas to it, and exposes
 * a renderFrame() method that sends layers + grade uniforms and resolves
 * when the GPU has finished compositing.
 *
 * Usage:
 *   const comp = new GPUCompositor()
 *   await comp.init(canvasElement)
 *   // per-frame:
 *   await comp.renderFrame(layers, grade)
 */

import type { TimelineTransform, TimelineColor } from '../../types'

export interface CompositorLayer {
  frame: VideoFrame
  transform: TimelineTransform
  opacity: number
  zIndex: number
}

type ReadyMode = 'webgpu' | 'canvas2d'

export class GPUCompositor {
  private _worker: Worker | null = null
  private _mode: ReadyMode | null = null
  private _pendingResolve: (() => void) | null = null
  private _pendingReject: ((err: Error) => void) | null = null
  private _canvas: HTMLCanvasElement | null = null

  /** Returns the HTMLCanvasElement attached to this compositor. */
  get canvas(): HTMLCanvasElement | null { return this._canvas }

  /** Returns the render mode chosen by the worker ('webgpu' | 'canvas2d'). */
  get mode(): ReadyMode | null { return this._mode }

  /**
   * Attaches the compositor to a canvas element.
   * Transfers an OffscreenCanvas to the worker — the canvas can no longer be
   * used directly on the main thread after this call.
   */
  async init(canvas: HTMLCanvasElement): Promise<ReadyMode> {
    this._canvas = canvas
    this._worker = new Worker(
      new URL('../../workers/compositor.worker.ts', import.meta.url),
      { type: 'module' },
    )

    return new Promise<ReadyMode>((resolve, reject) => {
      this._worker!.onmessage = (e: MessageEvent) => {
        const msg = e.data
        switch (msg.type) {
          case 'ready':
            this._mode = msg.mode as ReadyMode
            this._worker!.onmessage = this._handleMessage.bind(this)
            resolve(this._mode)
            break
          case 'error':
            reject(new Error(msg.message))
            break
        }
      }
      this._worker!.onerror = (err) => reject(err)

      const offscreen = canvas.transferControlToOffscreen()
      this._worker!.postMessage({ type: 'init', canvas: offscreen }, [offscreen])
    })
  }

  /**
   * Renders one video frame from all provided layers.
   * VideoFrame objects are transferred to the worker (zero-copy GPU transfer)
   * and closed by the worker after rendering.
   */
  async renderFrame(
    layers: CompositorLayer[],
    grade: TimelineColor,
    width: number,
    height: number,
  ): Promise<void> {
    if (!this._worker) throw new Error('GPUCompositor: call init() first')

    return new Promise<void>((resolve, reject) => {
      this._pendingResolve = resolve
      this._pendingReject = reject

      // Collect transferable VideoFrames
      const transferables: Transferable[] = []
      for (const layer of layers) {
        transferables.push(layer.frame as unknown as Transferable)
      }

      this._worker!.postMessage(
        {
          type: 'render',
          layers: layers.map((l) => ({
            frame: l.frame,
            transform: l.transform,
            opacity: l.opacity,
            zIndex: l.zIndex,
          })),
          grade: {
            exposure:    grade.exposure    ?? 1,
            contrast:    grade.contrast    ?? 1,
            saturation:  grade.saturation  ?? 1,
            temperature: grade.temperature ?? 0,
            tint:        grade.tint        ?? 0,
          },
          width,
          height,
        },
        transferables,
      )
    })
  }

  resize(width: number, height: number): void {
    this._worker?.postMessage({ type: 'resize', width, height })
  }

  destroy(): void {
    this._worker?.postMessage({ type: 'destroy' })
    this._worker?.terminate()
    this._worker = null
  }

  private _handleMessage(e: MessageEvent): void {
    const msg = e.data
    switch (msg.type) {
      case 'rendered':
        this._pendingResolve?.()
        this._pendingResolve = null
        this._pendingReject = null
        break
      case 'error':
        this._pendingReject?.(new Error(msg.message))
        this._pendingResolve = null
        this._pendingReject = null
        break
    }
  }
}
