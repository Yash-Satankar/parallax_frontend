/**
 * webcodecs/frameCache.ts
 *
 * LRU cache for decoded VideoFrame / ImageBitmap objects, keyed by
 * (clipId, timestampMicroseconds). Manages GPU VRAM budget automatically.
 *
 * Budget is auto-tuned from navigator.deviceMemory (20% of system RAM),
 * with an optional manual override via setVRAMOverrideMB() in capabilities.ts.
 *
 * When the cache is full, the Least-Recently-Used entry is evicted and its
 * frame is explicitly .close()'d to free VRAM.
 */

// ─── types ────────────────────────────────────────────────────────────────────

type CacheKey = string // `${clipId}:${timestampUs}`

interface CacheEntry {
  frame: VideoFrame | ImageBitmap
  byteSize: number   // approximate VRAM footprint
  lastUsed: number   // performance.now() at last access
}

// ─── helpers ──────────────────────────────────────────────────────────────────

function makeKey(clipId: string, timestampUs: number): CacheKey {
  return `${clipId}:${timestampUs}`
}

/** Approximate VRAM cost of a frame in bytes (RGBA = 4 bytes/pixel). */
function estimateBytes(width: number, height: number): number {
  return width * height * 4
}

function closeEntry(entry: CacheEntry): void {
  if ('close' in entry.frame && typeof entry.frame.close === 'function') {
    ;(entry.frame as VideoFrame).close()
  }
}

// ─── FrameCache ───────────────────────────────────────────────────────────────

export class FrameCache {
  private _map = new Map<CacheKey, CacheEntry>()
  private _usedBytes = 0
  private readonly _maxBytes: number

  /**
   * @param maxMB - Maximum VRAM budget in megabytes.
   *                Defaults to 20% of navigator.deviceMemory, clamped 128–2048 MB.
   */
  constructor(maxMB?: number) {
    if (maxMB != null) {
      this._maxBytes = maxMB * 1024 * 1024
    } else {
      const deviceMemoryGB =
        (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 4
      const mb = Math.min(2048, Math.max(128, Math.round(deviceMemoryGB * 1024 * 0.2)))
      this._maxBytes = mb * 1024 * 1024
    }
  }

  get usedMB(): number { return this._usedBytes / (1024 * 1024) }
  get maxMB(): number  { return this._maxBytes / (1024 * 1024) }
  get size(): number   { return this._map.size }

  // ── read ─────────────────────────────────────────────────────────────────

  get(clipId: string, timestampUs: number): VideoFrame | ImageBitmap | undefined {
    const key = makeKey(clipId, timestampUs)
    const entry = this._map.get(key)
    if (!entry) return undefined
    entry.lastUsed = performance.now()
    return entry.frame
  }

  has(clipId: string, timestampUs: number): boolean {
    return this._map.has(makeKey(clipId, timestampUs))
  }

  // ── write ────────────────────────────────────────────────────────────────

  put(
    clipId: string,
    timestampUs: number,
    frame: VideoFrame | ImageBitmap,
    width: number,
    height: number,
  ): void {
    const key = makeKey(clipId, timestampUs)

    // Evict existing entry for same key if present
    const existing = this._map.get(key)
    if (existing) {
      this._usedBytes -= existing.byteSize
      closeEntry(existing)
      this._map.delete(key)
    }

    const byteSize = estimateBytes(width, height)

    // Evict LRU entries until we have room
    while (this._usedBytes + byteSize > this._maxBytes && this._map.size > 0) {
      this._evictLRU()
    }

    this._map.set(key, { frame, byteSize, lastUsed: performance.now() })
    this._usedBytes += byteSize
  }

  // ── eviction ──────────────────────────────────────────────────────────────

  /** Evict all frames for a specific clip (e.g., when a clip is removed). */
  evict(clipId: string): void {
    const prefix = `${clipId}:`
    for (const [key, entry] of this._map) {
      if (key.startsWith(prefix)) {
        this._usedBytes -= entry.byteSize
        closeEntry(entry)
        this._map.delete(key)
      }
    }
  }

  /** Evict the single least-recently-used entry. */
  private _evictLRU(): void {
    let oldestKey: CacheKey | null = null
    let oldestTime = Infinity

    for (const [key, entry] of this._map) {
      if (entry.lastUsed < oldestTime) {
        oldestTime = entry.lastUsed
        oldestKey = key
      }
    }

    if (oldestKey) {
      const entry = this._map.get(oldestKey)!
      this._usedBytes -= entry.byteSize
      closeEntry(entry)
      this._map.delete(oldestKey)
    }
  }

  /** Close all frames and clear the cache. */
  clear(): void {
    for (const entry of this._map.values()) {
      closeEntry(entry)
    }
    this._map.clear()
    this._usedBytes = 0
  }
}

// ─── singleton ────────────────────────────────────────────────────────────────

/** Global frame cache shared across the preview stage and export pipeline. */
export const globalFrameCache = new FrameCache()
