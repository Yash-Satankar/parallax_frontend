/**
 * webcodecs/chunkBroadcaster.ts
 *
 * Phase 5 — Multi-User Chunk Relay.
 *
 * When multiple users collaborate on the same project:
 *  - One user demuxes a video file range locally.
 *  - As EncodedVideoChunks are generated, they are base64-encoded and broadcast
 *    via the collab WebSocket (`frame_chunk` message).
 *  - Connected peers receive the message, decode the base64 data to Uint8Array,
 *    and construct an EncodedVideoChunk locally to feed into their own VideoDecoder.
 *  - This avoids every user making duplicate HTTP range requests to download
 *    and demux large video assets from the media server.
 *
 * Because EncodedVideoChunks are compressed (100x smaller than raw VideoFrames),
 * transmitting them over WebSocket is efficient and lightweight.
 */

export interface FrameChunkMessage {
  clip_id: string
  timestamp_us: number
  is_key_frame: boolean
  data: string // base64 string
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  let binary = ''
  const bytes = new Uint8Array(buffer)
  const len = bytes.byteLength
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i])
  }
  return btoa(binary)
}

function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binaryString = atob(base64)
  const len = binaryString.length
  const bytes = new Uint8Array(len)
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i)
  }
  return bytes.buffer
}

export class ChunkBroadcaster {
  private _wsRef: React.RefObject<WebSocket | null>

  constructor(wsRef: React.RefObject<WebSocket | null>) {
    this._wsRef = wsRef
  }

  /**
   * Broadcast an EncodedVideoChunk to peers over WebSocket.
   */
  broadcastChunk(clipId: string, chunk: EncodedVideoChunk): void {
    const ws = this._wsRef.current
    if (!ws || ws.readyState !== WebSocket.OPEN) return

    const buffer = new ArrayBuffer(chunk.byteLength)
    chunk.copyTo(buffer)
    const base64Data = arrayBufferToBase64(buffer)

    const payload: FrameChunkMessage = {
      clip_id: clipId,
      timestamp_us: chunk.timestamp,
      is_key_frame: chunk.type === 'key',
      data: base64Data,
    }

    try {
      ws.send(JSON.stringify({
        type: 'frame_chunk',
        payload,
      }))
    } catch {
      // Ignore transient WS send errors
    }
  }

  /**
   * Reconstitutes an EncodedVideoChunk from a received frame_chunk payload.
   */
  static parseChunk(payload: FrameChunkMessage): EncodedVideoChunk {
    const buffer = base64ToArrayBuffer(payload.data)
    return new EncodedVideoChunk({
      type: payload.is_key_frame ? 'key' : 'delta',
      timestamp: payload.timestamp_us,
      data: buffer,
    })
  }
}
