import type { ChatMessage, Clip, MediaAsset, Track } from '../types'

export const PROJECT_NAME = 'Salt Road'
export const PROJECT_DURATION = 28
export const PROJECT_FPS = 24
export const PROJECT_RES = '3840 × 2160'

export const tracks: Track[] = [
  { id: 'V2', label: 'V2', kind: 'title' },
  { id: 'C1', label: 'C1', kind: 'caption' },
  { id: 'V1', label: 'V1', kind: 'video' },
  { id: 'A1', label: 'A1', kind: 'audio' },
  { id: 'A2', label: 'A2', kind: 'audio' },
]

export const initialClips: Clip[] = [
  {
    id: 'title-open',
    name: 'SALT ROAD',
    track: 'V2',
    kind: 'title',
    start: 0.6,
    duration: 3.4,
    color: '#c4a36a',
  },
  {
    id: 'clip-highway',
    name: 'Highway 01',
    track: 'V1',
    kind: 'video',
    start: 0,
    duration: 8,
    thumb: '/stills/highway.jpg',
    color: '#8a6a48',
  },
  {
    id: 'clip-wheel',
    name: 'Wheelhouse',
    track: 'V1',
    kind: 'video',
    start: 8,
    duration: 7,
    thumb: '/stills/wheel.jpg',
    color: '#6a5344',
  },
  {
    id: 'clip-cliff',
    name: 'Cliff Edge',
    track: 'V1',
    kind: 'video',
    start: 15,
    duration: 7,
    thumb: '/stills/cliff.jpg',
    color: '#3d4a5c',
  },
  {
    id: 'clip-dusk',
    name: 'Last Light',
    track: 'V1',
    kind: 'video',
    start: 22,
    duration: 6,
    thumb: '/stills/dusk.jpg',
    color: '#5a3d48',
  },
  {
    id: 'aud-wind',
    name: 'Wind ambience',
    track: 'A1',
    kind: 'audio',
    start: 0,
    duration: 28,
    color: '#3d8f72',
    waveSeed: 42,
  },
  {
    id: 'aud-score',
    name: 'Low strings',
    track: 'A2',
    kind: 'audio',
    start: 6,
    duration: 22,
    color: '#4a7d8a',
    waveSeed: 91,
  },
]

export const mediaAssets: MediaAsset[] = [
  { id: 'm-highway', name: 'Highway 01', kind: 'video', duration: 12.4, thumb: '/stills/highway.jpg' },
  { id: 'm-wheel', name: 'Wheelhouse', kind: 'video', duration: 9.1, thumb: '/stills/wheel.jpg' },
  { id: 'm-cliff', name: 'Cliff Edge', kind: 'video', duration: 11.8, thumb: '/stills/cliff.jpg' },
  { id: 'm-dusk', name: 'Last Light', kind: 'video', duration: 8.6, thumb: '/stills/dusk.jpg' },
  { id: 'm-wind', name: 'Wind ambience', kind: 'audio', duration: 48 },
  { id: 'm-score', name: 'Low strings', kind: 'audio', duration: 36 },
  { id: 'm-title', name: 'Title · Salt Road', kind: 'title', duration: 4 },
]

export const markers = [
  { time: 8, label: 'CUT' },
  { time: 15, label: 'WIDE' },
  { time: 22, label: 'HOLD' },
]

export const initialMessages: ChatMessage[] = [
  {
    id: 'a1',
    role: 'assistant',
    time: '14:02',
    text: 'Sequence is loaded. Four shots on V1, ambience under the whole piece, score coming in at 00:06. What do you want to change?',
  },
  {
    id: 'u1',
    role: 'user',
    time: '14:03',
    text: 'Tighten the open — the highway shot lingers. Keep a handle.',
  },
  {
    id: 'a2',
    role: 'assistant',
    time: '14:03',
    text: 'I’d take Highway 01 from 8.0s down to about 5.4s and let Wheelhouse enter earlier so the motion carries. Six-frame handle on both sides. Want me to do that?',
  },
]

export function clipsAtTime(clips: Clip[], time: number, kind?: Clip['kind']) {
  const frame = 1 / PROJECT_FPS
  const hits = clips.filter((clip) => (
    (kind == null || clip.kind === kind)
    && time >= clip.start
    && time < clip.start + clip.duration
  ))
  if (hits.length > 0) return hits
  return clips.filter((clip) => (
    (kind == null || clip.kind === kind)
    && time + frame * 0.5 >= clip.start
    && time < clip.start + clip.duration + frame * 0.5
  ))
}

export function clipAtTime(clips: Clip[], time: number, kind: Clip['kind'] = 'video') {
  const matches = clipsAtTime(clips, time, kind)
  if (matches.length <= 1) return matches[0]
  return matches.reduce((best, clip) => {
    if (clip.start > best.start) return clip
    if (clip.start < best.start) return best
    return clip.id > best.id ? clip : best
  })
}
