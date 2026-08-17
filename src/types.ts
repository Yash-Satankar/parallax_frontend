export type ToolId = 'media' | 'titles' | 'audio' | 'effects' | 'transitions' | 'history'

/** Rendering capability of the current browser for the preview stage. */
export type GPUCapability = 'webgpu' | 'canvas2d' | 'unknown'

export type TrackKind = 'video' | 'audio' | 'title'

export type MediaKind = 'video' | 'audio' | 'title'

export type Clip = {
  id: string
  name: string
  track: string
  kind: TrackKind
  start: number
  duration: number
  sourceIn?: number
  sourceDuration?: number
  autoFit?: boolean
  thumb?: string
  src?: string
  mediaPath?: string
  mediaType?: 'video' | 'audio' | 'image'
  width?: number
  height?: number
  color: string
  waveSeed?: number
  linkId?: string
  enabled?: boolean
  transform?: TimelineTransform
  playback?: TimelinePlayback
  audio?: TimelineAudio
  grade?: TimelineColor
  title?: TimelineTitle
  keyframes?: TimelineKeyframe[]
}

export type TimelineTransform = {
  x?: number; y?: number; anchorX?: number; anchorY?: number
  scaleX?: number; scaleY?: number; rotation?: number; opacity?: number
  cropTop?: number; cropRight?: number; cropBottom?: number; cropLeft?: number
}
export type TimelinePlayback = { rate?: number; preservePitch?: boolean }
export type TimelineAudio = { volumeDb?: number; muted?: boolean; pan?: number }
export type TimelineColor = { exposure?: number; contrast?: number; saturation?: number; temperature?: number; tint?: number }
export type TimelineTitle = { text: string; fontFamily?: string; fontSize?: number; fontWeight?: number; align?: string; fill?: string; stroke?: string; strokeWidth?: number; background?: string }
export type TimelineKeyframe = { property: string; frame: number; value: number; easing?: 'linear' | 'ease_in' | 'ease_out' | 'ease_in_out' }

export type Track = {
  id: string
  label: string
  kind: TrackKind
  locked?: boolean
  muted?: boolean
}

export type MediaAsset = {
  id: string
  name: string
  kind: MediaKind
  duration: number
  thumb?: string
  src?: string
  path?: string
  mediaType?: 'video' | 'audio' | 'image'
  width?: number
  height?: number
}

export type ChatRole = 'user' | 'assistant'

export type ChatMessage = {
  id: string
  role: ChatRole
  text: string
  time: string
  workedMs?: number
  trace?: DirectorActivity[]
}

export type DirectorActivity = {
  id: string
  kind: 'thinking' | 'tool'
  status: 'active' | 'success' | 'error'
  title: string
  name?: string
  detail?: string
  arguments?: unknown
  iteration?: number
  elapsedMs?: number
}

export type Grade = {
  warmth: number
  contrast: number
  saturation: number
}

export type SearchResult = {
  file_id: string
  media_path: string
  content_url: string
  thumbnail_url?: string
  start_sec: number
  end_sec: number
  kind: 'frame' | 'transcript'
  text: string
  relevance_score: number
}
