import { useEffect, useRef, useState, useCallback } from 'react'
import type { Clip } from '../types'
import { API_BASE } from './api'

export type RemotePeer = {
  client_id: string
  name: string
  color: string
  playhead_frame: number
  selected_clip_id?: string
}

export type CollabMessage = {
  type: string
  payload: unknown
}

const PEER_COLORS = [
  '#ef4444', '#f97316', '#eab308', '#22c55e', '#06b6d4',
  '#3b82f6', '#8b5cf6', '#ec4899', '#f43f5e', '#14b8a6',
]

function randomColor(): string {
  return PEER_COLORS[Math.floor(Math.random() * PEER_COLORS.length)]
}

function randomName(): string {
  const adjectives = ['Swift', 'Bright', 'Cosmic', 'Nimble', 'Solar', 'Lunar', 'Astral', 'Hyper']
  const nouns = ['Editor', 'Director', 'Creator', 'Artist', 'Voyager', 'Pilot', 'Curator', 'Maker']
  const adj = adjectives[Math.floor(Math.random() * adjectives.length)]
  const noun = nouns[Math.floor(Math.random() * nouns.length)]
  return `${adj} ${noun}`
}

export function useCollab(
  projectId: string | null,
  options: {
    onClipInsert?: (clip: Clip, rank: string) => void
    onClipDelete?: (clipId: string) => void
    onClipFieldUpdate?: (clipId: string, fields: Record<string, unknown>) => void
    onRemoteSync?: () => void
  } = {},
) {
  const [peers, setPeers] = useState<RemotePeer[]>([])
  const [connected, setConnected] = useState(false)
  const wsRef = useRef<WebSocket | null>(null)
  const myColorRef = useRef<string>(randomColor())
  const myNameRef = useRef<string>(randomName())
  const localPresenceTimerRef = useRef<number | null>(null)
  const optionsRef = useRef(options)
  optionsRef.current = options

  // Connect / disconnect when projectId changes
  useEffect(() => {
    if (!projectId) {
      setConnected(false)
      setPeers([])
      return
    }

    let isUnmounted = false
    let reconnectTimer: number | null = null
    let backoffMs = 1000

    function connect() {
      if (isUnmounted) return

      const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
      const wsHost = API_BASE ? API_BASE.replace(/^https?:\/\//, '') : window.location.host
      const url = `${wsProtocol}//${wsHost}/v1/projects/${projectId}/collab`

      try {
        const ws = new WebSocket(url)
        wsRef.current = ws

        ws.onopen = () => {
          if (isUnmounted) {
            ws.close()
            return
          }
          setConnected(true)
          backoffMs = 1000

          // Announce initial presence
          ws.send(JSON.stringify({
            type: 'presence_update',
            payload: {
              name: myNameRef.current,
              color: myColorRef.current,
              playhead_frame: 0,
            },
          }))
        }

        ws.onmessage = (event) => {
          try {
            const msg = JSON.parse(event.data) as CollabMessage
            const payload = msg.payload as Record<string, unknown>

            switch (msg.type) {
              case 'timeline_sync': {
                if (Array.isArray(payload?.presence)) {
                  setPeers(payload.presence as RemotePeer[])
                }
                optionsRef.current.onRemoteSync?.()
                break
              }
              case 'presence_update': {
                const peer = payload as unknown as RemotePeer
                if (peer?.client_id) {
                  setPeers((curr) => {
                    const idx = curr.findIndex((p) => p.client_id === peer.client_id)
                    if (idx >= 0) {
                      const next = [...curr]
                      next[idx] = peer
                      return next
                    }
                    return [...curr, peer]
                  })
                }
                break
              }
              case 'presence_leave': {
                const leftId = payload?.client_id as string
                if (leftId) {
                  setPeers((curr) => curr.filter((p) => p.client_id !== leftId))
                }
                break
              }
              case 'clip_insert': {
                const clip = payload?.clip as unknown as Clip
                const rank = (payload?.clip as Record<string, unknown>)?.rank as string || ''
                if (clip?.id) {
                  optionsRef.current.onClipInsert?.(clip, rank)
                }
                break
              }
              case 'clip_delete': {
                const id = payload?.id as string
                if (id) {
                  optionsRef.current.onClipDelete?.(id)
                }
                break
              }
              case 'clip_field_update': {
                const clipId = payload?.clip_id as string
                const fields = payload?.fields as Record<string, unknown>
                if (clipId && fields) {
                  optionsRef.current.onClipFieldUpdate?.(clipId, fields)
                }
                break
              }
            }
          } catch {
            // Ignore malformed messages gracefully
          }
        }

        ws.onclose = () => {
          setConnected(false)
          setPeers([])
          if (!isUnmounted) {
            reconnectTimer = window.setTimeout(() => {
              backoffMs = Math.min(backoffMs * 1.5, 10000)
              connect()
            }, backoffMs)
          }
        }

        ws.onerror = () => {
          ws.close()
        }
      } catch {
        if (!isUnmounted) {
          reconnectTimer = window.setTimeout(connect, backoffMs)
        }
      }
    }

    connect()

    return () => {
      isUnmounted = true
      if (reconnectTimer) window.clearTimeout(reconnectTimer)
      if (localPresenceTimerRef.current) window.clearTimeout(localPresenceTimerRef.current)
      if (wsRef.current) {
        wsRef.current.close()
        wsRef.current = null
      }
      setConnected(false)
      setPeers([])
    }
  }, [projectId])

  // Send local presence update
  const sendPresence = useCallback((playheadFrame: number, selectedClipId?: string | null) => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return
    try {
      wsRef.current.send(JSON.stringify({
        type: 'presence_update',
        payload: {
          name: myNameRef.current,
          color: myColorRef.current,
          playhead_frame: playheadFrame,
          selected_clip_id: selectedClipId || undefined,
        },
      }))
    } catch {
      // Ignore transient socket write errors
    }
  }, [])

  // Send clip field update
  const sendFieldUpdate = useCallback((clipId: string, fields: Record<string, unknown>) => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return
    try {
      wsRef.current.send(JSON.stringify({
        type: 'clip_field_update',
        payload: {
          clip_id: clipId,
          fields,
        },
      }))
    } catch {
      // Ignore
    }
  }, [])

  return {
    peers,
    connected,
    myColor: myColorRef.current,
    myName: myNameRef.current,
    sendPresence,
    sendFieldUpdate,
  }
}
