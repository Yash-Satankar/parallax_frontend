/**
 * workers/videoDecoder.worker.ts
 *
 * Dedicated Web Worker that owns a single VideoDecoder lifecycle.
 * Receives EncodedVideoChunk objects from the main thread, decodes them with
 * hardware acceleration, and posts VideoFrame objects back via structured clone
 * with transfer so the frame stays on the GPU without a CPU round-trip.
 */

const HIGH_WATER_MARK = 10   // max simultaneous open VideoFrames
const LOW_WATER_MARK  = 4    // resume decoding below this count

let decoder: VideoDecoder | null = null
let openFrames = 0

function createDecoder(): VideoDecoder {
  return new VideoDecoder({
    output(frame: VideoFrame) {
      openFrames++
      // Transfer the VideoFrame to the main thread — it stays on GPU
      const transfer = [frame as unknown as Transferable]
      ;(self as unknown as Worker).postMessage(
        { type: 'frame', frame, timestamp: frame.timestamp },
        transfer,
      )
    },
    error(e: DOMException) {
      self.postMessage({ type: 'error', message: e.message })
    },
  })
}

self.onmessage = (e: MessageEvent) => {
  const msg = e.data as {
    type: 'configure' | 'decode' | 'flush' | 'reset' | 'frame_consumed'
    config?: VideoDecoderConfig
    chunk?: EncodedVideoChunk
  }

  switch (msg.type) {
    case 'configure': {
      if (decoder && decoder.state !== 'closed') {
        decoder.close()
      }
      decoder = createDecoder()
      decoder.configure(msg.config!)
      openFrames = 0
      break
    }

    case 'decode': {
      if (!decoder || decoder.state === 'closed') break

      // Back-pressure: drop if GPU is saturated
      if (openFrames >= HIGH_WATER_MARK) {
        self.postMessage({ type: 'pressure', openFrames })
        break
      }

      decoder.decode(msg.chunk!)
      break
    }

    case 'flush': {
      if (!decoder || decoder.state === 'closed') break
      decoder.flush().then(() => {
        self.postMessage({ type: 'flushed' })
      }).catch((err: Error) => {
        self.postMessage({ type: 'error', message: err.message })
      })
      break
    }

    case 'reset': {
      if (decoder && decoder.state !== 'closed') {
        decoder.reset()
      }
      openFrames = 0
      break
    }

    case 'frame_consumed': {
      // Main thread signals it has consumed (and closed) one frame
      openFrames = Math.max(0, openFrames - 1)
      if (openFrames < LOW_WATER_MARK) {
        self.postMessage({ type: 'ready' })
      }
      break
    }
  }
}
