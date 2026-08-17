/**
 * workers/encoder.worker.ts
 *
 * Dedicated Web Worker that owns a VideoEncoder + MediaBunny muxer.
 * Receives VideoFrame objects from the compositor and produces a muxed
 * MP4 or WebM Blob as the client-side export output.
 *
 * Codec selection (from WebCodecs Handbook):
 *   MP4  → avc1.4d0034 (H.264 Main Profile L5.2, 4K, 98.9% device support)
 *   WebM → vp09.00.40.08.00 (VP9 Level 4, 99.96% device support)
 */

import {
  Output,
  Mp4OutputFormat,
  WebMOutputFormat,
  BufferTarget,
  EncodedVideoPacketSource,
  EncodedPacket,
} from 'mediabunny'

// ─── helpers ──────────────────────────────────────────────────────────────────

type ExportFormat  = 'mp4' | 'webm'
type ExportQuality = 'draft' | 'standard' | 'high' | 'original'

interface EncoderConfig {
  format: ExportFormat
  width: number
  height: number
  fps: number
  quality: ExportQuality
  totalFrames: number
}

function getCodec(format: ExportFormat): string {
  return format === 'mp4' ? 'avc1.4d0034' : 'vp09.00.40.08.00'
}

function getBitrate(width: number, height: number, fps: number, quality: ExportQuality): number {
  const pixels = width * height
  const factors: Record<ExportQuality, number> = {
    draft: 0.04, standard: 0.08, high: 0.12, original: 0.18,
  }
  return pixels * fps * factors[quality]
}

// ─── state ────────────────────────────────────────────────────────────────────

let encoder: VideoEncoder | null = null
let muxerOutput: Output | null = null
let videoSource: EncodedVideoPacketSource | null = null
let config: EncoderConfig | null = null
let frameCount = 0
let aborted = false

// ─── message handler ──────────────────────────────────────────────────────────

self.onmessage = async (e: MessageEvent) => {
  const msg = e.data

  switch (msg.type) {
    case 'configure': {
      aborted = false
      frameCount = 0
      config = msg as EncoderConfig

      const codec   = getCodec(config.format)
      const bitrate = getBitrate(config.width, config.height, config.fps, config.quality)

      // Set up muxer
      const format = config.format === 'mp4' ? new Mp4OutputFormat() : new WebMOutputFormat()
      const target = new BufferTarget()
      muxerOutput  = new Output({ format, target })
      videoSource  = new EncodedVideoPacketSource(config.format === 'mp4' ? 'avc' : 'vp9')
      muxerOutput.addVideoTrack(videoSource)
      await muxerOutput.start()

      // Set up encoder
      encoder = new VideoEncoder({
        output(chunk: EncodedVideoChunk) {
          if (aborted) return
          videoSource!.add(EncodedPacket.fromEncodedChunk(chunk))
        },
        error(err: DOMException) {
          self.postMessage({ type: 'error', message: err.message })
        },
      })

      encoder.configure({
        codec,
        width: config.width,
        height: config.height,
        bitrate,
        framerate: config.fps,
        hardwareAcceleration: 'prefer-hardware',
      })
      break
    }

    case 'frame': {
      if (!encoder || !config || aborted) {
        ;(msg.frame as VideoFrame).close()
        break
      }

      const frame     = msg.frame as VideoFrame
      const isLast    = msg.isLast === true
      const isKeyframe = frameCount % (config.fps * 2) === 0  // keyframe every 2 s

      encoder.encode(frame, { keyFrame: isKeyframe })
      frame.close()
      frameCount++

      const pct = config.totalFrames > 0 ? frameCount / config.totalFrames : 0
      self.postMessage({ type: 'progress', pct })

      if (isLast) {
        await encoder.flush()
        await muxerOutput!.finalize()

        const buffer = (muxerOutput!.target as BufferTarget).buffer as ArrayBuffer
        const mimeType = config.format === 'mp4' ? 'video/mp4' : 'video/webm'
        const blob = new Blob([buffer], { type: mimeType })
        self.postMessage({ type: 'done', blob })

        encoder.close()
        encoder = null
      }
      break
    }

    case 'abort': {
      aborted = true
      encoder?.close()
      encoder = null
      muxerOutput = null
      break
    }
  }
}
