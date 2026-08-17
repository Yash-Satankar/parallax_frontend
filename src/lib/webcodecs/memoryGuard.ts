/**
 * webcodecs/memoryGuard.ts
 *
 * VideoFrame objects live in GPU VRAM and are NOT garbage-collected.
 * Every frame MUST be explicitly .close()'d when done, or the tab will crash
 * when VRAM is exhausted (~67 4K frames on a typical 2 GB VRAM budget).
 *
 * This module provides:
 *  - A global open-frame counter with configurable warning threshold
 *  - A TrackedFrame wrapper that catches double-close and use-after-close
 *    in development mode
 *  - VRAM pressure reporting via Performance API when available
 */

const isDev = import.meta.env.DEV

// ─── configuration ─────────────────────────────────────────────────────────────

/** Warn to console when this many frames are simultaneously open. */
let _warnThreshold = 50

export function setOpenFrameWarnThreshold(n: number): void {
  _warnThreshold = Math.max(1, n)
}

// ─── global counter ───────────────────────────────────────────────────────────

let _openFrames = 0

export function getOpenFrameCount(): number {
  return _openFrames
}

function _onOpen() {
  _openFrames++
  if (_openFrames >= _warnThreshold) {
    console.warn(
      `[memoryGuard] ${_openFrames} VideoFrames open simultaneously ` +
      `(threshold: ${_warnThreshold}). Ensure frame.close() is called promptly.`,
    )
  }
}

function _onClose() {
  _openFrames = Math.max(0, _openFrames - 1)
}

// ─── TrackedFrame ─────────────────────────────────────────────────────────────

/**
 * Wraps a raw VideoFrame with open/close tracking.
 * In development builds, throws descriptive errors on misuse.
 * In production builds, wraps with minimal overhead.
 */
export class TrackedFrame {
  private _inner: VideoFrame
  private _closed = false
  private _stack: string | undefined

  constructor(frame: VideoFrame) {
    this._inner = frame
    if (isDev) {
      this._stack = new Error().stack
    }
    _onOpen()
  }

  get inner(): VideoFrame {
    if (isDev && this._closed) {
      throw new Error(
        '[memoryGuard] Attempted to use a VideoFrame after close().\n' +
        'Frame was created at:\n' + (this._stack ?? 'unknown'),
      )
    }
    return this._inner
  }

  get timestamp(): number { return this._inner.timestamp }
  get codedWidth(): number { return this._inner.codedWidth }
  get codedHeight(): number { return this._inner.codedHeight }

  close(): void {
    if (isDev && this._closed) {
      throw new Error(
        '[memoryGuard] VideoFrame.close() called twice.\n' +
        'Frame was created at:\n' + (this._stack ?? 'unknown'),
      )
    }
    if (!this._closed) {
      this._closed = true
      this._inner.close()
      _onClose()
    }
  }

  get isClosed(): boolean { return this._closed }
}

// ─── factory ──────────────────────────────────────────────────────────────────

/**
 * Creates a new VideoFrame from any CanvasImageSource and wraps it in a
 * TrackedFrame for VRAM accounting.
 *
 * @example
 * const frame = createTrackedFrame(canvas, { timestamp: 0 })
 * // ... use frame.inner for WebGPU / encoder operations
 * frame.close() // MUST be called when done
 */
export function createTrackedFrame(
  source: CanvasImageSource,
  init: VideoFrameInit,
): TrackedFrame {
  return new TrackedFrame(new VideoFrame(source, init))
}

/**
 * Wraps an existing VideoFrame (e.g., one received from a VideoDecoder output
 * callback) in a TrackedFrame without creating a new VideoFrame.
 */
export function trackFrame(frame: VideoFrame): TrackedFrame {
  return new TrackedFrame(frame)
}

// ─── VRAM pressure reporter ───────────────────────────────────────────────────

/**
 * Attempts to read current JS heap + GPU memory usage via the
 * `performance.measureUserAgentSpecificMemory()` API (Chrome only, requires
 * cross-origin isolation). Returns null if unavailable.
 */
export async function measureVRAMPressure(): Promise<{ totalBytes: number } | null> {
  try {
    const perf = performance as Performance & {
      measureUserAgentSpecificMemory?: () => Promise<{ bytes: number }>
    }
    if (typeof perf.measureUserAgentSpecificMemory !== 'function') return null
    const result = await perf.measureUserAgentSpecificMemory()
    return { totalBytes: result.bytes }
  } catch {
    return null
  }
}
