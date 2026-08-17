/**
 * lib/useSyncedPlayback.ts
 *
 * Opt-in "Follow Playhead" hook for multi-user synchronized playback.
 * Wraps the collab WebSocket to broadcast and receive playback state.
 *
 * Design decisions (per user approval):
 *  - Independent playheads by default — sync is opt-in via `enabled` prop
 *  - When a remote leader plays/seeks, the local playhead follows
 *  - Network latency is corrected using serverTimeMs + local Date.now()
 *  - Outbound broadcasts are debounced to 4× per second (250 ms)
 *
 * Usage:
 *   const { isFollowing, leader, follow, unfollow } = useSyncedPlayback({
 *     wsRef,
 *     onSeek,
 *     onPlay,
 *     onPause,
 *   })
 */

import { useCallback, useEffect, useRef, useState } from 'react'

export interface PlaybackSyncPayload {
  client_id: string
  name: string
  frame: number
  fps: number
  is_playing: boolean
  server_time_ms: number
}

interface UseSyncedPlaybackOptions {
  /** The WebSocket ref from useCollab (or any live WS connection). */
  wsRef: React.RefObject<WebSocket | null>
  /** Called when the leader seeks — receives time in seconds. */
  onSeek: (timeSec: number) => void
  onPlay: () => void
  onPause: () => void
  /** FPS of the project timeline (used to convert frame → seconds). */
  fps?: number
}

export function useSyncedPlayback({
  wsRef,
  onSeek,
  onPlay,
  onPause,
  fps = 24,
}: UseSyncedPlaybackOptions) {
  const [isFollowing, setIsFollowing] = useState(false)
  const [leaderId, setLeaderId]       = useState<string | null>(null)
  const [leaderName, setLeaderName]   = useState<string | null>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const myIdRef = useRef<string>(`local-${Math.random().toString(36).slice(2)}`)

  // ── receive sync messages ─────────────────────────────────────────────────
  useEffect(() => {
    const ws = wsRef.current
    if (!ws) return

    const handler = (event: MessageEvent) => {
      try {
        const msg = JSON.parse(event.data as string) as {
          type: string
          payload: PlaybackSyncPayload
        }
        if (msg.type !== 'playback_sync') return
        const p = msg.payload
        if (p.client_id === myIdRef.current) return  // ignore own echoes

        // Latch onto this leader if following
        if (!isFollowing) return
        if (leaderId && p.client_id !== leaderId) return

        // Latency correction: leader sent at serverTimeMs, we receive now
        const networkDelaySec = (Date.now() - p.server_time_ms) / 1000
        const correctedSec = (p.frame / (p.fps || fps)) + (p.is_playing ? networkDelaySec : 0)

        onSeek(Math.max(0, correctedSec))
        if (p.is_playing) onPlay()
        else onPause()
      } catch { /* malformed message — ignore */ }
    }

    ws.addEventListener('message', handler)
    return () => ws.removeEventListener('message', handler)
  }, [wsRef, isFollowing, leaderId, fps, onSeek, onPlay, onPause])

  // ── send sync broadcast ────────────────────────────────────────────────────
  const broadcastSync = useCallback((frame: number, isPlaying: boolean) => {
    const ws = wsRef.current
    if (!ws || ws.readyState !== WebSocket.OPEN) return

    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      try {
        ws.send(JSON.stringify({
          type: 'playback_sync',
          payload: {
            client_id: myIdRef.current,
            frame,
            fps,
            is_playing: isPlaying,
            server_time_ms: Date.now(),
          } satisfies Omit<PlaybackSyncPayload, 'name' | 'server_time_ms'> & { server_time_ms: number },
        }))
      } catch { /* ignore transient WS errors */ }
    }, 250)   // 4× per second max
  }, [wsRef, fps])

  // ── public controls ───────────────────────────────────────────────────────
  const follow = useCallback((clientId: string, name: string) => {
    setLeaderId(clientId)
    setLeaderName(name)
    setIsFollowing(true)
  }, [])

  const unfollow = useCallback(() => {
    setIsFollowing(false)
    setLeaderId(null)
    setLeaderName(null)
  }, [])

  return {
    /** True when this client is following a remote leader's playhead. */
    isFollowing,
    /** The clientId of the user being followed (null if not following). */
    leaderId,
    /** The display name of the leader (null if not following). */
    leaderName,
    /**
     * Broadcast local playback position to all collaborators.
     * Call this on every play/pause/seek from the local user.
     * Debounced to 4× per second automatically.
     */
    broadcastSync,
    /** Start following a specific peer's playhead. */
    follow,
    /** Stop following — return to independent playback. */
    unfollow,
  }
}
