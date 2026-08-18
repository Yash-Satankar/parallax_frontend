import type { Clip, MediaAsset, TimelineColor, TimelineKeyframe, TimelineTransform, TrackKind } from '../types'
import { PROJECT_FPS } from '../data/project'

export const TIMELINE_SCHEMA = 2
export const MIN_CLIP_FRAMES = 1

export type TimelineClipRecord = {
  id: string
  name: string
  track: string
  kind: TrackKind
  start_frame: number
  duration_frames: number
  source_in_frame: number
  source_duration_frames?: number
  media_path?: string
  media_type?: 'video' | 'audio' | 'image'
  color: string
  wave_seed?: number
  link_id?: string
  enabled?: boolean
  transform?: SnakeTransform
  playback?: { rate?: number; preserve_pitch?: boolean }
  audio?: { volume_db?: number; muted?: boolean; pan?: number }
  grade?: TimelineColor
  title?: { text: string; font_family?: string; font_size?: number; font_weight?: number; align?: string; fill?: string; stroke?: string; stroke_width?: number; background?: string }
  keyframes?: TimelineKeyframe[]
}

type SnakeTransform = { x?: number; y?: number; anchor_x?: number; anchor_y?: number; scale_x?: number; scale_y?: number; rotation?: number; opacity?: number; crop_top?: number; crop_right?: number; crop_bottom?: number; crop_left?: number }
export type TimelineTransition = { id: string; type: 'crossfade' | 'dip_black' | 'dip_white'; from_item_id: string; to_item_id: string; duration_frames: number }

export type TimelineDocument = {
  schema: number
  fps: number
  revision: number
  playhead_frame: number
  selected_id?: string
  px_per_second?: number
  updated_at?: string
  canvas?: { width: number; height: number }
  clips: TimelineClipRecord[]
  transitions?: TimelineTransition[]
}

const COLOR_FOR: Record<TrackKind, string> = {
  video: '#8a6a48',
  title: '#c4a36a',
  audio: '#3d8f72',
}

export function toFrames(seconds: number, fps = PROJECT_FPS) {
  if (!Number.isFinite(seconds) || seconds <= 0) return 0
  return Math.round(seconds * fps)
}

export function fromFrames(frames: number, fps = PROJECT_FPS) {
  if (!Number.isFinite(frames) || frames <= 0 || fps <= 0) return 0
  return frames / fps
}

export function snapTime(seconds: number, fps = PROJECT_FPS) {
  return fromFrames(toFrames(seconds, fps), fps)
}

export function frameDuration(fps = PROJECT_FPS) {
  return 1 / Math.max(1, fps)
}

export function clipSourceTime(clip: Pick<Clip, 'start' | 'sourceIn'>, timelineTime: number) {
  return Math.max(0, (clip.sourceIn ?? 0) + (timelineTime - clip.start))
}

export function clampClip(clip: Clip, fps = PROJECT_FPS): Clip {
  const frame = frameDuration(fps)
  let start = Math.max(0, snapTime(clip.start, fps))
  let sourceIn = Math.max(0, snapTime(clip.sourceIn ?? 0, fps))
  let duration = Math.max(frame, snapTime(clip.duration, fps))
  const sourceDuration = clip.sourceDuration && clip.sourceDuration > 0
    ? snapTime(clip.sourceDuration, fps)
    : 0

  if (sourceDuration > 0) {
    const maxIn = Math.max(0, sourceDuration - frame)
    if (sourceIn > maxIn) sourceIn = maxIn
    const maxDur = sourceDuration - sourceIn
    if (duration > maxDur) duration = Math.max(frame, snapTime(maxDur, fps))
  }

  return {
    ...clip,
    start,
    duration,
    sourceIn,
    sourceDuration: sourceDuration || clip.sourceDuration,
  }
}

export function applySourceDuration(clip: Clip, sourceDuration: number, fps = PROJECT_FPS): Clip {
  if (!Number.isFinite(sourceDuration) || sourceDuration <= 0) return clip
  const next = { ...clip, sourceDuration }
  if (clip.autoFit) {
    next.duration = sourceDuration
    next.sourceIn = clip.sourceIn ?? 0
    next.autoFit = false
  }
  return clampClip(next, fps)
}

export function buildTimelineDocument(input: {
  clips: Clip[]
  fps?: number
  revision?: number
  playhead?: number
  selectedId?: string | null
  pxPerSecond?: number
  canvas?: { width: number; height: number }
  transitions?: TimelineTransition[]
}): TimelineDocument {
  const fps = input.fps && input.fps > 0 ? input.fps : PROJECT_FPS
  const clips = input.clips
    .map((clip) => clipToRecord(clampClip(clip, fps), fps))
    .sort((a, b) => a.start_frame - b.start_frame || a.id.localeCompare(b.id))
  return {
    schema: TIMELINE_SCHEMA,
    fps,
    revision: input.revision ?? 0,
    playhead_frame: toFrames(input.playhead ?? 0, fps),
    selected_id: input.selectedId || undefined,
    px_per_second: input.pxPerSecond,
    clips,
    canvas: input.canvas ?? { width: 1920, height: 1080 },
    transitions: input.transitions ?? [],
  }
}

export function clipsFromDocument(doc: TimelineDocument, assets: MediaAsset[]): Clip[] {
  const fps = doc.fps > 0 ? doc.fps : PROJECT_FPS
  return (doc.clips ?? []).map((record) => hydrateClip(clipFromRecord(record, fps), assets))
}

export function hydrateClip(clip: Clip, assets: MediaAsset[]): Clip {
  const asset = findClipAsset(clip, assets)
  if (!asset) {
    return { ...clip, src: undefined, thumb: undefined }
  }
  let next: Clip = {
    ...clip,
    name: clip.name || asset.name,
    src: asset.src,
    thumb: asset.thumb ?? clip.thumb,
    mediaPath: asset.path ?? clip.mediaPath,
    mediaType: asset.mediaType ?? clip.mediaType,
    width: asset.width || clip.width,
    height: asset.height || clip.height,
  }
  if (asset.duration > 0) {
    next = applySourceDuration(next, asset.duration)
  }
  return next
}

export function timelineFingerprint(doc: TimelineDocument): string {
  return JSON.stringify({
    fps: doc.fps,
    canvas: doc.canvas,
    clips: doc.clips,
    transitions: doc.transitions ?? [],
  })
}

export function emptyTimelineDocument(): TimelineDocument {
  return {
    schema: TIMELINE_SCHEMA,
    fps: PROJECT_FPS,
    revision: 0,
    playhead_frame: 0,
    canvas: { width: 1920, height: 1080 },
    clips: [],
    transitions: [],
  }
}

function clipToRecord(clip: Clip, fps: number): TimelineClipRecord {
  const record: TimelineClipRecord = {
    id: clip.id,
    name: clip.name,
    track: clip.track,
    kind: clip.kind,
    start_frame: toFrames(clip.start, fps),
    duration_frames: Math.max(MIN_CLIP_FRAMES, toFrames(clip.duration, fps)),
    source_in_frame: toFrames(clip.sourceIn ?? 0, fps),
    color: clip.color || COLOR_FOR[clip.kind],
  }
  if (clip.sourceDuration && clip.sourceDuration > 0) {
    record.source_duration_frames = toFrames(clip.sourceDuration, fps)
  }
  if (clip.mediaPath) record.media_path = clip.mediaPath
  if (clip.mediaType) record.media_type = clip.mediaType
  if (clip.waveSeed) record.wave_seed = clip.waveSeed
  if (clip.linkId) record.link_id = clip.linkId
  if (clip.enabled != null) record.enabled = clip.enabled
  if (clip.transform) record.transform = transformToRecord(clip.transform)
  if (clip.playback) record.playback = { rate: clip.playback.rate, preserve_pitch: clip.playback.preservePitch }
  if (clip.audio) record.audio = { volume_db: clip.audio.volumeDb, muted: clip.audio.muted, pan: clip.audio.pan }
  if (clip.grade) record.grade = clip.grade
  if (clip.title) record.title = { text: clip.title.text, font_family: clip.title.fontFamily, font_size: clip.title.fontSize, font_weight: clip.title.fontWeight, align: clip.title.align, fill: clip.title.fill, stroke: clip.title.stroke, stroke_width: clip.title.strokeWidth, background: clip.title.background }
  if (clip.title?.words?.length) {
    // Map caption words into snake_case record form
    // Each word's startSec is expected to be absolute timeline seconds
    // duration is derived from endSec - startSec
    // fps passed in to convert to frames
    // @ts-ignore - extend record.title with words
    record.title = record.title || { text: clip.title.text, font_family: clip.title.fontFamily, font_size: clip.title.fontSize, font_weight: clip.title.fontWeight, align: clip.title.align, fill: clip.title.fill, stroke: clip.title.stroke, stroke_width: clip.title.strokeWidth, background: clip.title.background }
    // @ts-ignore
    record.title.words = clip.title.words.map((w) => ({
      word: w.word,
      start_sec: w.startSec,
      end_sec: w.endSec,
      start_frame: toFrames(w.startSec, fps),
      duration_frames: toFrames(Math.max(0, w.endSec - w.startSec), fps),
    }))
  }
  if (clip.keyframes?.length) record.keyframes = clip.keyframes
  return record
}

function clipFromRecord(record: TimelineClipRecord, fps: number): Clip {
  return {
    id: record.id,
    name: record.name || 'Clip',
    track: record.track,
    kind: record.kind,
    start: fromFrames(record.start_frame, fps),
    duration: fromFrames(Math.max(MIN_CLIP_FRAMES, record.duration_frames), fps),
    sourceIn: fromFrames(Math.max(0, record.source_in_frame), fps),
    sourceDuration: record.source_duration_frames
      ? fromFrames(record.source_duration_frames, fps)
      : undefined,
    mediaPath: record.media_path,
    mediaType: record.media_type,
    color: record.color || COLOR_FOR[record.kind],
    waveSeed: record.wave_seed,
    linkId: record.link_id,
    enabled: record.enabled,
    transform: transformFromRecord(record.transform),
    playback: record.playback ? { rate: record.playback.rate, preservePitch: record.playback.preserve_pitch } : undefined,
    audio: record.audio ? { volumeDb: record.audio.volume_db, muted: record.audio.muted, pan: record.audio.pan } : undefined,
    grade: record.grade,
    // build title object explicitly to satisfy typing
    title: (function(){
      if (!record.title) return undefined
      const t: any = {
        text: record.title.text || '',
        fontFamily: record.title.font_family,
        fontSize: record.title.font_size,
        fontWeight: record.title.font_weight,
        align: record.title.align,
        fill: record.title.fill,
        stroke: record.title.stroke,
        strokeWidth: record.title.stroke_width,
        background: record.title.background,
      }
      if (Array.isArray((record.title as any).words)) {
        t.words = (record.title as any).words.map((w: any) => ({ word: w.word, startSec: fromFrames(w.start_frame, fps), endSec: fromFrames((w.start_frame ?? 0) + (w.duration_frames ?? 0), fps), startFrame: w.start_frame, durationFrames: w.duration_frames }))
      }
      return t
    })(),
    keyframes: record.keyframes,
  }
}

function transformToRecord(value: TimelineTransform): SnakeTransform {
  return { x:value.x, y:value.y, anchor_x:value.anchorX, anchor_y:value.anchorY, scale_x:value.scaleX, scale_y:value.scaleY, rotation:value.rotation, opacity:value.opacity, crop_top:value.cropTop, crop_right:value.cropRight, crop_bottom:value.cropBottom, crop_left:value.cropLeft }
}
function transformFromRecord(value?: SnakeTransform): TimelineTransform | undefined {
  return value ? { x:value.x, y:value.y, anchorX:value.anchor_x, anchorY:value.anchor_y, scaleX:value.scale_x, scaleY:value.scale_y, rotation:value.rotation, opacity:value.opacity, cropTop:value.crop_top, cropRight:value.crop_right, cropBottom:value.crop_bottom, cropLeft:value.crop_left } : undefined
}

export function findClipAsset(clip: Pick<Clip, 'mediaPath' | 'src'>, assets: MediaAsset[]) {
  if (clip.mediaPath) {
    const want = normalizeMediaPath(clip.mediaPath)
    const byPath = assets.find((asset) => {
      if (!asset.path) return false
      const have = normalizeMediaPath(asset.path)
      return have === want || have.endsWith(`/${want}`) || want.endsWith(`/${have}`)
    })
    if (byPath) return byPath
  }
  if (clip.src) {
    const want = stripQuery(clip.src)
    return assets.find((asset) => asset.src && stripQuery(asset.src) === want)
  }
  return undefined
}

function normalizeMediaPath(path: string) {
  return path.replace(/\\/g, '/').replace(/^\.\//, '')
}

function stripQuery(url: string) {
  const index = url.indexOf('?')
  return index === -1 ? url : url.slice(0, index)
}
