import { useEffect, useState } from 'react'
import type { CaptionCue } from '../types'
import { API_BASE } from './api'

export const CAPTION_CANVAS_HEIGHT = 1080
export const DEFAULT_CAPTION_FONT = 32

export function captionFontPx(fontSize: number, scale: number, plateHeight: number) {
  const size = Number.isFinite(fontSize) && fontSize > 0 ? fontSize : DEFAULT_CAPTION_FONT
  const factor = Number.isFinite(scale) && scale > 0 ? scale : 1
  const plate = Number.isFinite(plateHeight) && plateHeight > 0 ? plateHeight : CAPTION_CANVAS_HEIGHT
  return Math.max(8, (size * factor * plate) / CAPTION_CANVAS_HEIGHT)
}

const cache = new Map<string, CaptionCue[]>()
const inflight = new Map<string, Promise<CaptionCue[]>>()

export function projectFileURL(projectId: string, path: string) {
  const encoded = path.split('/').filter(Boolean).map(encodeURIComponent).join('/')
  return `${API_BASE}/v1/projects/${projectId}/files/${encoded}`
}

export function parseSRT(body: string): CaptionCue[] {
  const text = body.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  const cues: CaptionCue[] = []
  for (const block of text.split('\n\n')) {
    const lines = block.trim().split('\n')
    if (lines.length < 2) continue
    let idx = 0
    if (/^\d+$/.test(lines[0].trim()) && lines[1].includes('-->')) idx = 1
    if (!lines[idx]?.includes('-->')) continue
    const range = parseRange(lines[idx])
    if (!range) continue
    const value = lines.slice(idx + 1).join('\n').trim()
    if (!value) continue
    cues.push({ start: range.start, end: range.end, text: value })
  }
  return cues
}

function parseRange(line: string) {
  const [left, right] = line.split('-->')
  if (!left || !right) return null
  const start = parseStamp(left)
  const end = parseStamp(right)
  if (start == null || end == null || end < start) return null
  return { start, end }
}

function parseStamp(value: string) {
  const token = value.trim().split(/\s+/)[0]?.replace(',', '.')
  if (!token) return null
  const match = /^(\d+):(\d+):(\d+(?:\.\d+)?)$/.exec(token)
  if (!match) return null
  const hours = Number(match[1])
  const minutes = Number(match[2])
  const seconds = Number(match[3])
  if (![hours, minutes, seconds].every(Number.isFinite) || minutes > 59) return null
  return hours * 3600 + minutes * 60 + seconds
}

export function cueAt(cues: CaptionCue[], time: number) {
  let hit: CaptionCue | undefined
  for (const cue of cues) {
    if (time + 0.02 >= cue.start && time < cue.end) hit = cue
  }
  return hit
}

export function useCaptionCues(projectId: string, path: string | undefined, revision = 0) {
  const [cues, setCues] = useState<CaptionCue[]>([])
  useEffect(() => {
    if (!projectId || !path) {
      setCues([])
      return
    }
    const key = `${projectId}:${path}:${revision}`
    const cached = cache.get(key)
    if (cached) {
      setCues(cached)
      return
    }
    let cancelled = false
    const pending = inflight.get(key) ?? fetch(projectFileURL(projectId, path))
      .then((response) => (response.ok ? response.text() : ''))
      .then((body) => {
        const next = body ? parseSRT(body) : []
        cache.set(key, next)
        inflight.delete(key)
        return next
      })
      .catch(() => {
        inflight.delete(key)
        return [] as CaptionCue[]
      })
    inflight.set(key, pending)
    void pending.then((next) => {
      if (!cancelled) setCues(next)
    })
    return () => {
      cancelled = true
    }
  }, [projectId, path, revision])
  return cues
}
