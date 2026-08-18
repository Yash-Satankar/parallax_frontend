/**
 * Decouples inbound stream delivery from what the user sees.
 * The backend may dump tokens as fast as the network allows; this buffer
 * reveals them at a fixed character rate so the UI can fade new text in.
 */

export type StreamTextQueue = {
  push: (chunk: string) => void
  pushBreak: () => void
  end: () => void
  fail: () => void
  reset: () => void
  idle: () => Promise<void>
  readonly received: string
  readonly revealed: string
}

type Handlers = {
  onAppend: (chunk: string) => void
  onEnd?: () => void
}

/** Comfortable reading/typing pace. Independent of SSE chunk timing. */
const CHARS_PER_SEC = 150
/** Soft catch-up only when the buffer would lag for many seconds. */
const CATCHUP_CHARS_PER_SEC = 220
const CATCHUP_AFTER = 1200
const MAX_FRAME_MS = 48

export function createStreamTextQueue(handlers: Handlers): StreamTextQueue {
  let received = ''
  let revealed = ''
  let ended = false
  let frame: number | null = null
  let carry = 0
  let lastTick = 0
  let waiters: Array<() => void> = []

  function flushWaiters() {
    const ready = waiters
    waiters = []
    for (const resolve of ready) resolve()
  }

  function notifyIdle() {
    if (frame != null || pendingChars() > 0 || !ended) return
    flushWaiters()
  }

  function pendingChars() {
    return received.length - revealed.length
  }

  function revealRate() {
    if (prefersReducedMotion()) return 1e6
    return pendingChars() > CATCHUP_AFTER ? CATCHUP_CHARS_PER_SEC : CHARS_PER_SEC
  }

  function stop() {
    if (frame == null) return
    cancelAnimationFrame(frame)
    frame = null
  }

  function finish() {
    stop()
    ended = true
    carry = 0
    handlers.onEnd?.()
    notifyIdle()
  }

  function reveal(count: number) {
    if (count <= 0) return
    const piece = received.slice(revealed.length, revealed.length + count)
    if (!piece) return
    revealed += piece
    handlers.onAppend(piece)
  }

  function tick(now: number) {
    frame = null
    const waiting = pendingChars()
    if (waiting <= 0) {
      if (ended) finish()
      else notifyIdle()
      return
    }

    const dt = lastTick ? Math.min(now - lastTick, MAX_FRAME_MS) : 16
    lastTick = now
    carry += (dt / 1000) * revealRate()
    if (carry < 1) {
      frame = requestAnimationFrame(tick)
      return
    }

    const count = Math.min(waiting, Math.floor(carry))
    carry -= count
    reveal(count)

    if (pendingChars() > 0) {
      frame = requestAnimationFrame(tick)
      return
    }
    if (ended) finish()
  }

  function kick() {
    if (frame != null) return
    lastTick = 0
    frame = requestAnimationFrame(tick)
  }

  return {
    push(chunk) {
      if (!chunk || ended) return
      received += chunk
      kick()
    },
    pushBreak() {
      if (ended || !received.trim()) return
      const head = received.slice(0, revealed.length)
      const tail = received.slice(revealed.length).replace(/\s+$/, '')
      received = `${head}${tail}\n\n`
      kick()
    },
    end() {
      ended = true
      if (pendingChars() <= 0) {
        finish()
        return
      }
      kick()
    },
    fail() {
      stop()
      ended = true
      carry = 0
      const rest = received.slice(revealed.length)
      if (rest) reveal(rest.length)
      notifyIdle()
    },
    reset() {
      stop()
      received = ''
      revealed = ''
      ended = false
      carry = 0
      lastTick = 0
      flushWaiters()
    },
    idle() {
      if (frame == null && pendingChars() <= 0 && ended) return Promise.resolve()
      return new Promise<void>((resolve) => {
        waiters.push(resolve)
      })
    },
    get received() {
      return received
    },
    get revealed() {
      return revealed
    },
  }
}

function prefersReducedMotion() {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}
