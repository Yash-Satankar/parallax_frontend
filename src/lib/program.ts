import type { Clip } from '../types'
import { clipAtTime, clipsAtTime } from '../data/project'
import { clipSourceTime } from './timeline'
import { sequenceDuration } from './edit'

export const SEQUENCE_SOURCE = 'sequence'

export type ProgramLayer = {
  clip: Clip
  sourceTime: number
}

export type ProgramFrame = {
  time: number
  video?: ProgramLayer
  overlay?: ProgramLayer
  captions?: ProgramLayer
  audio: ProgramLayer[]
  gap: boolean
}

export function programAtTime(clips: Clip[], time: number): ProgramFrame {
  const videoClip = clipAtTime(clips, time, 'video')
  const titleClip = clipAtTime(clips, time, 'title')
  const captionClip = clipAtTime(clips, time, 'caption')
  const audioClips = clipsAtTime(clips, time, 'audio')
  return {
    time,
    video: layerFor(videoClip, time),
    overlay: layerFor(titleClip, time),
    captions: layerFor(captionClip, time),
    audio: audioClips.map((clip) => ({ clip, sourceTime: clipSourceTime(clip, time) })),
    gap: videoClip == null,
  }
}

export function sequenceAudioClips(clips: Clip[]) {
  return clips.filter((clip) => clip.kind === 'audio' && Boolean(clip.src))
}

export function programDuration(clips: Clip[]) {
  return sequenceDuration(clips)
}

export function programLabel(frame: ProgramFrame) {
  if (frame.video && frame.overlay) return `${frame.video.clip.name} + ${frame.overlay.clip.name}`
  if (frame.video) return frame.video.clip.name
  if (frame.overlay) return frame.overlay.clip.name
  if (frame.audio.length > 0) return frame.audio.map((layer) => layer.clip.name).join(' + ')
  return 'Gap'
}

function layerFor(clip: Clip | undefined, time: number): ProgramLayer | undefined {
  if (!clip) return undefined
  return { clip, sourceTime: clipSourceTime(clip, time) }
}
