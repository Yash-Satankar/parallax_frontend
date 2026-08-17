/**
 * webcodecs/exportPipeline.ts
 *
 * Orchestrates the full client-side export pipeline:
 *
 *   Demuxer → DecoderWorker → CompositorWorker → EncoderWorker → Blob
 *
 * Uses a manual frame budget (maxConcurrent = 10) instead of the Streams API
 * TransformStream so that VideoFrame objects are never buffered beyond the
 * memory guard threshold.
 *
 * The pipeline runs entirely in the browser — no server round-trip. It is
 * offered as an opt-in alternative to server-side FFmpeg export.
 *
 * @example
 *   const exporter = new ClientExportPipeline(clips, assetFiles, settings)
 *   for await (const progress of exporter.run()) {
 *     console.log(`${Math.round(progress * 100)}%`)
 *   }
 *   const blob = await exporter.result()
 *   downloadBlob(blob, 'export.mp4')
 */

import type { Clip, TimelineColor } from '../../types'
import { getDemuxResult, demuxRange } from './demuxer'
import { getOpenFrameCount } from './memoryGuard'

// ─── types ────────────────────────────────────────────────────────────────────

export type ExportFormat  = 'mp4' | 'webm'
export type ExportQuality = 'draft' | 'standard' | 'high' | 'original'

export interface ExportSettings {
  format: ExportFormat
  quality: ExportQuality
  fps: number
  width: number
  height: number
  /** Grade applied globally to all frames. */
  grade: TimelineColor
}

const MAX_CONCURRENT_FRAMES = 10   // VRAM safety ceiling

// ─── helpers ──────────────────────────────────────────────────────────────────

function sleep(ms: number) { return new Promise<void>((r) => setTimeout(r, ms)) }

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

// ─── ClientExportPipeline ─────────────────────────────────────────────────────

export class ClientExportPipeline {
  private _clips: Clip[]
  private _assets: Map<string, File>
  private _settings: ExportSettings
  private _blob: Blob | null = null
  private _aborted = false

  private _decoderWorker: Worker | null = null
  private _compositorWorker: Worker | null = null
  private _encoderWorker: Worker | null = null

  constructor(
    clips: Clip[],
    assets: Map<string, File>,
    settings: ExportSettings,
  ) {
    this._clips   = clips
    this._assets  = assets
    this._settings = settings
  }

  /** Async generator that yields progress values (0–1). */
  async *run(): AsyncGenerator<number, void> {
    try {
      yield* this._runPipeline()
    } finally {
      this._teardown()
    }
  }

  async result(): Promise<Blob> {
    if (!this._blob) throw new Error('exportPipeline: run() has not completed yet')
    return this._blob
  }

  abort(): void {
    this._aborted = true
    this._encoderWorker?.postMessage({ type: 'abort' })
    this._teardown()
  }

  // ── private ─────────────────────────────────────────────────────────────────

  private async *_runPipeline(): AsyncGenerator<number> {
    const { fps, width, height, format, quality, grade } = this._settings

    // ── collect ordered video clips on V1 ─────────────────────────────────
    const videoClips = this._clips
      .filter((c) => c.kind === 'video' && c.track === 'V1')
      .sort((a, b) => a.start - b.start)

    if (videoClips.length === 0) throw new Error('exportPipeline: no video clips found')

    // ── compute total frame count ─────────────────────────────────────────
    const sequenceEnd = Math.max(...this._clips.map((c) => c.start + c.duration))
    const totalFrames = Math.ceil(sequenceEnd * fps)

    // ── spin up workers ───────────────────────────────────────────────────
    this._decoderWorker   = this._spawnWorker('../workers/videoDecoder.worker.ts')
    this._compositorWorker = this._spawnWorker('../workers/compositor.worker.ts')
    this._encoderWorker   = this._spawnWorker('../workers/encoder.worker.ts')

    // Configure encoder
    this._encoderWorker.postMessage({
      type: 'configure',
      format, width, height, fps, quality, totalFrames,
    })

    let resultBlob: Blob | null = null
    let encoderError: string | null = null

    this._encoderWorker!.onmessage = (e) => {
      if (e.data.type === 'done')  resultBlob = e.data.blob as Blob
      if (e.data.type === 'error') encoderError = e.data.message as string
    }

    // ── frame loop ────────────────────────────────────────────────────────
    for (let frameIdx = 0; frameIdx < totalFrames; frameIdx++) {
      if (this._aborted) break
      if (encoderError) throw new Error(`Encoder: ${encoderError}`)

      // Back-pressure: wait if too many open frames
      while (getOpenFrameCount() >= MAX_CONCURRENT_FRAMES) {
        await sleep(16)
      }

      const timelineSec = frameIdx / fps
      const isLast = frameIdx === totalFrames - 1

      // Find which clip is active at this timeline position
      const clip = videoClips.find(
        (c) => timelineSec >= c.start && timelineSec < c.start + c.duration,
      )

      if (!clip || !clip.src) {
        // Black frame — encode a blank canvas frame
        const blankCanvas = new OffscreenCanvas(width, height)
        const blankCtx = blankCanvas.getContext('2d')!
        blankCtx.fillStyle = '#000'
        blankCtx.fillRect(0, 0, width, height)
        const blankFrame = new VideoFrame(blankCanvas, { timestamp: Math.round(timelineSec * 1e6) })
        this._encoderWorker!.postMessage({ type: 'frame', frame: blankFrame, isLast }, [blankFrame as unknown as Transferable])
        yield frameIdx / totalFrames
        continue
      }

      const sourceOffsetSec = (timelineSec - clip.start) + (clip.sourceIn ?? 0)
      const srcFile = this._assets.get(clip.mediaPath ?? clip.src ?? '') ?? clip.src

      // Decode → composite → encode
      const frame = await this._decodeFrame(srcFile as string | File, sourceOffsetSec, width, height, grade, Math.round(timelineSec * 1e6))
      if (!frame) { yield frameIdx / totalFrames; continue }

      this._encoderWorker!.postMessage(
        { type: 'frame', frame, isLast },
        [frame as unknown as Transferable],
      )

      yield frameIdx / totalFrames
    }

    // Wait for encoder to finish
    await new Promise<void>((resolve, reject) => {
      const check = setInterval(() => {
        if (encoderError) { clearInterval(check); reject(new Error(encoderError!)) }
        if (resultBlob)   { clearInterval(check); this._blob = resultBlob; resolve() }
      }, 100)
    })
  }

  private async _decodeFrame(
    src: string | File,
    sourceOffsetSec: number,
    width: number,
    height: number,
    grade: TimelineColor,
    timestampUs: number,
  ): Promise<VideoFrame | null> {
    return new Promise<VideoFrame | null>((resolve) => {
      ;(async () => {
        try {
          const { config } = await getDemuxResult(src)

          let gotFrame = false
          this._decoderWorker!.onmessage = (e) => {
            if (e.data.type === 'frame' && !gotFrame) {
              gotFrame = true
              const raw = e.data.frame as VideoFrame

              // Composite through canvas2d for simplicity during export
              // (compositor worker uses WebGPU if available)
              const canvas = new OffscreenCanvas(width, height)
              const ctx = canvas.getContext('2d')!

              // Apply grade as CSS filter on canvas
              const brightness = grade.exposure ?? 1
              const contrast   = Math.max(0, 1 + ((grade.contrast ?? 1) - 1) * 0.18)
              const saturate   = Math.max(0, 1 + ((grade.saturation ?? 1) - 1) * 0.2)
              ctx.filter = `brightness(${brightness}) contrast(${contrast}) saturate(${saturate})`
              ctx.drawImage(raw, 0, 0, width, height)
              raw.close()

              const outFrame = new VideoFrame(canvas, { timestamp: timestampUs })
              resolve(outFrame)
            }
          }

          this._decoderWorker!.postMessage({ type: 'configure', config })
          this._decoderWorker!.postMessage({ type: 'reset' })

          for await (const chunk of demuxRange(src, Math.max(0, sourceOffsetSec - 0.1), sourceOffsetSec + 1)) {
            this._decoderWorker!.postMessage({ type: 'decode', chunk })
          }
          this._decoderWorker!.postMessage({ type: 'flush' })

          setTimeout(() => { if (!gotFrame) resolve(null) }, 5000)
        } catch {
          resolve(null)
        }
      })()
    })
  }

  private _spawnWorker(path: string): Worker {
    return new Worker(new URL(path, import.meta.url), { type: 'module' })
  }

  private _teardown(): void {
    this._decoderWorker?.terminate()
    this._compositorWorker?.terminate()
    // Don't terminate encoder worker — it needs to finish muxing
    this._decoderWorker    = null
    this._compositorWorker = null
  }
}

/** Convenience wrapper: run pipeline and trigger browser download. */
export async function exportAndDownload(
  clips: Clip[],
  assets: Map<string, File>,
  settings: ExportSettings,
  filename: string,
  onProgress?: (pct: number) => void,
): Promise<void> {
  const pipeline = new ClientExportPipeline(clips, assets, settings)
  for await (const pct of pipeline.run()) {
    onProgress?.(pct)
  }
  const blob = await pipeline.result()
  downloadBlob(blob, filename)
}
