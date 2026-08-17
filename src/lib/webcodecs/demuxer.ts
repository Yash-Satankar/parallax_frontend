/**
 * webcodecs/demuxer.ts
 *
 * Thin async wrapper around mediabunny for demuxing video files.
 * Returns a VideoDecoderConfig and an async iterator of EncodedVideoChunk
 * objects. Supports range-seeking so only chunks needed for the current
 * playback position are fetched, keeping memory usage bounded.
 *
 * WebCodecs pipeline position:
 *   [File/URL] → demuxer.ts → [EncodedVideoChunk] → videoDecoder.worker.ts
 */

import {
  Input,
  ALL_FORMATS,
  BlobSource,
  UrlSource,
  EncodedPacketSink,
  type InputVideoTrack,
} from 'mediabunny'

// ─── types ────────────────────────────────────────────────────────────────────

export interface DemuxResult {
  /** Config to pass to VideoDecoder.configure(). */
  config: VideoDecoderConfig
  /** Total video duration in seconds. */
  durationSec: number
  /** Native frame rate of the source. */
  fps: number
  /** Coded width in pixels. */
  width: number
  /** Coded height in pixels. */
  height: number
}

// ─── helpers ──────────────────────────────────────────────────────────────────

function makeSource(src: File | string) {
  if (src instanceof File) return new BlobSource(src)
  return new UrlSource(src)
}

function openInput(src: File | string): Input {
  return new Input({ formats: ALL_FORMATS, source: makeSource(src) })
}

// ─── public API ───────────────────────────────────────────────────────────────

/**
 * Reads the video decoder config from a source without loading all frames.
 * This is the first thing to call before creating a VideoDecoder.
 */
export async function getDemuxResult(src: File | string): Promise<DemuxResult> {
  const input = openInput(src)
  try {
    const track = await input.getPrimaryVideoTrack()
    if (!track) throw new Error('demuxer: no video track found in source')

    const config = await track.getDecoderConfig()
    const width = await track.getDisplayWidth()
    const height = await track.getDisplayHeight()
    const durationSec = (await input.getDurationFromMetadata()) ?? (await input.computeDuration().catch(() => 0))
    let fps = 30
    try {
      const metrics = await track.computeFrameRateMetrics()
      if (metrics.bestGuessFrameRate) fps = metrics.bestGuessFrameRate
    } catch {
      // Fall back to 30 fps
    }

    const fallbackConfig: VideoDecoderConfig = {
      codec: (await track.getCodecParameterString()) ?? 'avc1.4d0034',
      codedWidth: width,
      codedHeight: height,
    }

    return {
      config: config ?? fallbackConfig,
      durationSec: durationSec ?? 0,
      fps: fps || 30,
      width: width ?? 1920,
      height: height ?? 1080,
    }
  } finally {
    input.dispose()
  }
}

/**
 * Async generator that yields every EncodedVideoChunk in the source,
 * from the beginning to end.
 */
export async function* demuxAll(src: File | string): AsyncGenerator<EncodedVideoChunk> {
  const input = openInput(src)
  try {
    const track = (await input.getPrimaryVideoTrack()) as InputVideoTrack | null
    if (!track) throw new Error('demuxer: no video track found')
    const sink = new EncodedPacketSink(track)
    for await (const packet of sink.packets()) {
      yield packet.toEncodedVideoChunk()
    }
  } finally {
    input.dispose()
  }
}

/**
 * Async generator that yields EncodedVideoChunks within a time range.
 * Starts at the nearest key frame at or before `startSec` so the decoder
 * always gets a full I-frame first.
 *
 * @param startSec - Start of desired range in seconds (seeks to nearest keyframe).
 * @param endSec   - End of desired range in seconds (exclusive).
 */
export async function* demuxRange(
  src: File | string,
  startSec: number,
  endSec: number,
): AsyncGenerator<EncodedVideoChunk> {
  const input = openInput(src)
  try {
    const track = (await input.getPrimaryVideoTrack()) as InputVideoTrack | null
    if (!track) throw new Error('demuxer: no video track found')

    const sink = new EncodedPacketSink(track)
    const startPacket = await sink.getKeyPacket(Math.max(0, startSec), { verifyKeyPackets: true }).catch(() => null)

    for await (const packet of sink.packets(startPacket ?? undefined)) {
      const chunk = packet.toEncodedVideoChunk()
      // Duration is in microseconds
      const chunkStartSec = chunk.timestamp / 1e6
      if (chunkStartSec > endSec) break
      yield chunk
    }
  } finally {
    input.dispose()
  }
}
