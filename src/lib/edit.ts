import type { Clip, MediaAsset, TrackKind } from '../types'
import { PROJECT_FPS } from '../data/project'
import { clampClip, frameDuration, snapTime } from './timeline'

export const MIN_DURATION = 8
export const ASSET_MIME = 'application/x-parallax-asset'
export const SNAP_PX = 8

export type EditMode = 'overwrite' | 'ripple'

const TRACK_FOR: Record<TrackKind, string> = {
  video: 'V1',
  title: 'V2',
  caption: 'C1',
  audio: 'A1',
}

const COLOR_FOR: Record<TrackKind, string> = {
  video: '#8a6a48',
  title: '#c4a36a',
  caption: '#5b7c99',
  audio: '#3d8f72',
}

export function sequenceDuration(clips: Clip[], assets: Array<{ duration: number }> = []) {
  let end = 0
  for (const clip of clips) {
    end = Math.max(end, clip.start + clip.duration)
  }
  if (end <= 0) {
    for (const asset of assets) {
      if (asset.duration > 0) end = Math.max(end, asset.duration)
    }
  }
  return end > 0 ? end : MIN_DURATION
}

export function defaultTrack(kind: TrackKind) {
  return TRACK_FOR[kind]
}

export function trackAccepts(trackId: string, kind: TrackKind) {
  if (kind === 'video') return trackId === 'V1'
  if (kind === 'title') return trackId === 'V2'
  if (kind === 'caption') return trackId === 'C1'
  return trackId === 'A1' || trackId === 'A2'
}

export function dropAccepts(trackId: string, kind: TrackKind, mediaType?: MediaAsset['mediaType']) {
  if (kind === 'video') {
    if (mediaType === 'image') return trackId === 'V1'
    return trackId === 'V1' || trackId === 'A1'
  }
  return trackAccepts(trackId, kind)
}

export function newClipId() {
  return `clip-${Math.random().toString(36).slice(2, 9)}`
}

export function newLinkId() {
  return `link-${Math.random().toString(36).slice(2, 9)}`
}

export function clipFromAsset(asset: MediaAsset, start: number, track?: string): Clip {
  const kind = asset.kind
  const known = asset.duration > 0
  return {
    id: newClipId(),
    name: kind === 'title' ? 'SALT ROAD' : asset.name,
    track: track && trackAccepts(track, kind) ? track : defaultTrack(kind),
    kind,
    start: Math.max(0, start),
    duration: known ? asset.duration : 8,
    sourceIn: 0,
    sourceDuration: known ? asset.duration : undefined,
    autoFit: !known,
    thumb: asset.thumb,
    src: asset.src,
    mediaPath: asset.path,
    mediaType: asset.mediaType,
    width: asset.width,
    height: asset.height,
    color: COLOR_FOR[kind],
    waveSeed: kind === 'audio' ? Math.floor(Math.random() * 200) + 1 : undefined,
  }
}

export function clipsFromAsset(asset: MediaAsset, start: number, track?: string): Clip[] {
  const placedTrack = asset.kind === 'video'
    ? 'V1'
    : track && trackAccepts(track, asset.kind)
      ? track
      : defaultTrack(asset.kind)
  const primary = clipFromAsset(asset, start, placedTrack)
  if (asset.kind !== 'video' || asset.mediaType === 'image') {
    return [primary]
  }

  const linkId = newLinkId()
  const audio = clipFromAsset({
    ...asset,
    kind: 'audio',
    mediaType: asset.mediaType ?? 'video',
  }, start, 'A1')

  return [
    { ...primary, linkId },
    { ...audio, linkId, name: primary.name },
  ]
}

export function linkedIds(clips: Clip[], id: string): string[] {
  const clip = clips.find((item) => item.id === id)
  if (!clip) return []
  if (!clip.linkId) return [clip.id]
  return clips.filter((item) => item.linkId === clip.linkId).map((item) => item.id)
}

export function linkedClips(clips: Clip[], id: string): Clip[] {
  const ids = new Set(linkedIds(clips, id))
  return clips.filter((clip) => ids.has(clip.id))
}

export function unlinkClips(clips: Clip[], id: string): Clip[] {
  const clip = clips.find((item) => item.id === id)
  if (!clip?.linkId) return clips
  const linkId = clip.linkId
  return clips.map((item) => (item.linkId === linkId ? { ...item, linkId: undefined } : item))
}

export function clipContainsTime(clip: Pick<Clip, 'start' | 'duration'>, time: number, fps = PROJECT_FPS) {
  const frame = frameDuration(fps)
  return time >= clip.start + frame * 0.5 && time < clip.start + clip.duration - frame * 0.5
}

export function splitClipsAtTime(
  clips: Clip[],
  time: number,
  fps = PROJECT_FPS,
  tracks?: Iterable<string>,
): { clips: Clip[]; created: Clip[] } {
  const frame = frameDuration(fps)
  const cut = snapTime(time, fps)
  const trackSet = tracks ? new Set(tracks) : null
  const created: Clip[] = []
  const rightLink = new Map<string, string>()
  const next: Clip[] = []

  for (const clip of clips) {
    if (trackSet && !trackSet.has(clip.track)) {
      next.push(clip)
      continue
    }
    if (!clipContainsTime(clip, cut, fps)) {
      next.push(clip)
      continue
    }

    const leftDur = cut - clip.start
    const rightDur = clip.start + clip.duration - cut
    if (leftDur < frame || rightDur < frame) {
      next.push(clip)
      continue
    }

    let rightLinkId = clip.linkId
    if (clip.linkId) {
      const existing = rightLink.get(clip.linkId)
      if (existing) {
        rightLinkId = existing
      } else {
        rightLinkId = newLinkId()
        rightLink.set(clip.linkId, rightLinkId)
      }
    }

    const left = clampClip({ ...clip, duration: leftDur, autoFit: false }, fps)
    const right = clampClip({
      ...clip,
      id: newClipId(),
      start: cut,
      duration: rightDur,
      sourceIn: (clip.sourceIn ?? 0) + leftDur,
      linkId: rightLinkId,
      autoFit: false,
    }, fps)
    next.push(left, right)
    created.push(right)
  }

  return { clips: next, created }
}

export function collectSnapTimes(
  clips: Clip[],
  playhead: number,
  excludeIds: Iterable<string> = [],
): number[] {
  const skip = new Set(excludeIds)
  const times = [0, Math.max(0, playhead)]
  for (const clip of clips) {
    if (skip.has(clip.id)) continue
    times.push(clip.start, clip.start + clip.duration)
  }
  return times
}

export function snapThresholdSeconds(pxPerSecond: number, px = SNAP_PX) {
  return px / Math.max(1, pxPerSecond)
}

export function snapToTimes(value: number, targets: number[], threshold: number): { time: number; snapped: number | null } {
  if (threshold <= 0 || targets.length === 0) {
    return { time: value, snapped: null }
  }
  let best = value
  let bestDist = threshold
  let hit: number | null = null
  for (const target of targets) {
    const dist = Math.abs(value - target)
    if (dist <= bestDist) {
      best = target
      bestDist = dist
      hit = target
    }
  }
  return { time: best, snapped: hit }
}

export function snapInterval(
  start: number,
  duration: number,
  targets: number[],
  threshold: number,
): { start: number; snapped: number | null } {
  const head = snapToTimes(start, targets, threshold)
  const tail = snapToTimes(start + duration, targets, threshold)
  const headDist = Math.abs(head.time - start)
  const tailDist = Math.abs(tail.time - (start + duration))
  if (head.snapped != null && headDist <= tailDist) {
    return { start: Math.max(0, head.time), snapped: head.snapped }
  }
  if (tail.snapped != null) {
    return { start: Math.max(0, tail.time - duration), snapped: tail.snapped }
  }
  return { start: Math.max(0, start), snapped: null }
}

export function subtractRange(clips: Clip[], track: string, start: number, end: number, fps = PROJECT_FPS): Clip[] {
  const frame = frameDuration(fps)
  const out: Clip[] = []
  for (const clip of clips) {
    if (clip.track !== track) {
      out.push(clip)
      continue
    }
    const clipEnd = clip.start + clip.duration
    if (clipEnd <= start + frame * 0.5 || clip.start >= end - frame * 0.5) {
      out.push(clip)
      continue
    }
    if (clip.start >= start - frame * 0.5 && clipEnd <= end + frame * 0.5) {
      continue
    }
    if (clip.start < start && clipEnd > end) {
      const leftDur = start - clip.start
      const rightDur = clipEnd - end
      if (leftDur >= frame) {
        out.push(clampClip({ ...clip, duration: leftDur, autoFit: false }, fps))
      }
      if (rightDur >= frame) {
        out.push(clampClip({
          ...clip,
          id: newClipId(),
          start: end,
          duration: rightDur,
          sourceIn: (clip.sourceIn ?? 0) + (end - clip.start),
          linkId: clip.linkId ? newLinkId() : undefined,
          autoFit: false,
        }, fps))
      }
      continue
    }
    if (clip.start < start) {
      const duration = start - clip.start
      if (duration >= frame) {
        out.push(clampClip({ ...clip, duration, autoFit: false }, fps))
      }
      continue
    }
    const delta = end - clip.start
    const duration = clip.duration - delta
    if (duration >= frame) {
      out.push(clampClip({
        ...clip,
        start: end,
        duration,
        sourceIn: (clip.sourceIn ?? 0) + delta,
        autoFit: false,
      }, fps))
    }
  }
  return out
}

export function overwritePlace(clips: Clip[], incoming: Clip[], fps = PROJECT_FPS): Clip[] {
  if (incoming.length === 0) return clips
  const keep = new Set(incoming.map((clip) => clip.id))
  let next = clips.filter((clip) => !keep.has(clip.id))
  for (const clip of incoming) {
    next = subtractRange(next, clip.track, clip.start, clip.start + clip.duration, fps)
  }
  return [...next, ...incoming]
}

export function closeGapOnTracks(
  clips: Clip[],
  tracks: Iterable<string>,
  start: number,
  duration: number,
  fps = PROJECT_FPS,
): Clip[] {
  const trackSet = new Set(tracks)
  const frame = frameDuration(fps)
  const holeEnd = start + duration
  return clips.map((clip) => {
    if (!trackSet.has(clip.track)) return clip
    if (clip.start >= holeEnd - frame * 0.5) {
      return { ...clip, start: snapTime(Math.max(0, clip.start - duration), fps) }
    }
    return clip
  })
}

export function rippleInsertClips(clips: Clip[], incoming: Clip[], fps = PROJECT_FPS): Clip[] {
  if (incoming.length === 0) return clips
  const dest = incoming[0].start
  const duration = incoming[0].duration
  const tracks = incoming.map((clip) => clip.track)
  const frame = frameDuration(fps)
  let next = splitClipsAtTime(clips, dest, fps, tracks).clips
  next = next.map((clip) => {
    if (!tracks.includes(clip.track)) return clip
    if (clip.start >= dest - frame * 0.5) {
      return { ...clip, start: snapTime(clip.start + duration, fps) }
    }
    return clip
  })
  return [...next, ...incoming]
}

export function rippleMoveClips(
  clips: Clip[],
  movingIds: Iterable<string>,
  destStart: number,
  originStart: number,
  originDuration: number,
  fps = PROJECT_FPS,
): Clip[] {
  const ids = new Set(movingIds)
  const moving = clips.filter((clip) => ids.has(clip.id))
  if (moving.length === 0) return clips
  const tracks = [...new Set(moving.map((clip) => clip.track))]
  const frame = frameDuration(fps)
  let next = clips.filter((clip) => !ids.has(clip.id))
  next = closeGapOnTracks(next, tracks, originStart, originDuration, fps)

  const originEnd = originStart + originDuration
  let dest = snapTime(Math.max(0, destStart), fps)
  if (destStart >= originEnd - frame * 0.5) {
    dest = snapTime(Math.max(0, destStart - originDuration), fps)
  } else if (destStart >= originStart - frame * 0.5) {
    dest = snapTime(originStart, fps)
  }

  next = splitClipsAtTime(next, dest, fps, tracks).clips
  next = next.map((clip) => {
    if (!tracks.includes(clip.track)) return clip
    if (clip.start >= dest - frame * 0.5) {
      return { ...clip, start: snapTime(clip.start + originDuration, fps) }
    }
    return clip
  })

  const placed = moving.map((clip) => clampClip({ ...clip, start: dest, autoFit: false }, fps))
  return [...next, ...placed]
}

export function rippleTrimClips(
  clips: Clip[],
  incoming: Clip[],
  originStart: number,
  originDuration: number,
  fps = PROJECT_FPS,
): Clip[] {
  if (incoming.length === 0) return clips
  const ids = new Set(incoming.map((clip) => clip.id))
  const tracks = incoming.map((clip) => clip.track)
  const frame = frameDuration(fps)
  const oldEnd = originStart + originDuration
  const newEnd = incoming[0].start + incoming[0].duration
  const delta = newEnd - oldEnd

  let next = clips.map((clip) => incoming.find((item) => item.id === clip.id) ?? clip)
  if (Math.abs(delta) >= frame * 0.5) {
    next = next.map((clip) => {
      if (ids.has(clip.id) || !tracks.includes(clip.track)) return clip
      if (clip.start >= oldEnd - frame * 0.5) {
        return { ...clip, start: snapTime(Math.max(0, clip.start + delta), fps) }
      }
      return clip
    })
  }
  if (delta > frame * 0.5) {
    return overwritePlace(next, incoming, fps)
  }
  return next
}

export function placeClips(
  clips: Clip[],
  incoming: Clip[],
  mode: EditMode,
  fps = PROJECT_FPS,
): Clip[] {
  return mode === 'ripple'
    ? rippleInsertClips(clips, incoming, fps)
    : overwritePlace(clips, incoming, fps)
}

export function commitMove(
  clips: Clip[],
  movingIds: Iterable<string>,
  destStart: number,
  originStart: number,
  originDuration: number,
  mode: EditMode,
  fps = PROJECT_FPS,
): Clip[] {
  if (mode === 'ripple') {
    return rippleMoveClips(clips, movingIds, destStart, originStart, originDuration, fps)
  }
  const ids = new Set(movingIds)
  const incoming = clips.filter((clip) => ids.has(clip.id))
  return overwritePlace(clips, incoming, fps)
}

export function commitTrim(
  clips: Clip[],
  incoming: Clip[],
  originStart: number,
  originDuration: number,
  mode: EditMode,
  fps = PROJECT_FPS,
): Clip[] {
  if (mode === 'ripple') {
    return rippleTrimClips(clips, incoming, originStart, originDuration, fps)
  }
  return overwritePlace(clips, incoming, fps)
}

export function removeClips(
  clips: Clip[],
  ids: Iterable<string>,
  mode: EditMode,
  fps = PROJECT_FPS,
): Clip[] {
  const remove = new Set(ids)
  const doomed = clips.filter((clip) => remove.has(clip.id))
  let next = clips.filter((clip) => !remove.has(clip.id))
  const broken = new Set(doomed.map((clip) => clip.linkId).filter((id): id is string => Boolean(id)))
  if (broken.size > 0) {
    next = next.map((clip) => {
      if (!clip.linkId || !broken.has(clip.linkId)) return clip
      const remaining = next.filter((other) => other.linkId === clip.linkId).length
      return remaining < 2 ? { ...clip, linkId: undefined } : clip
    })
  }
  if (mode !== 'ripple' || doomed.length === 0) return next
  const originStart = Math.min(...doomed.map((clip) => clip.start))
  const originDuration = doomed[0].duration
  const tracks = doomed.map((clip) => clip.track)
  return closeGapOnTracks(next, tracks, originStart, originDuration, fps)
}

let draggingAsset: MediaAsset | null = null

export function setDraggingAsset(asset: MediaAsset | null) {
  draggingAsset = asset
}

export function getDraggingAsset() {
  return draggingAsset
}

export function parseAssetTransfer(data: DataTransfer) {
  if (draggingAsset) return draggingAsset
  const raw = data.getData(ASSET_MIME)
  if (!raw) return null
  try {
    return JSON.parse(raw) as MediaAsset
  } catch {
    return null
  }
}
