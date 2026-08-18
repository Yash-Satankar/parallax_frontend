import { useRef, useState, type DragEvent, type PointerEvent } from 'react'
import { motion, useReducedMotion } from 'framer-motion'
import { Captions, Eye, Link2, Magnet, Scissors, Type, Unlink, Volume2, X } from 'lucide-react'
import type { Clip, MediaAsset, Track } from '../types'
import { PROJECT_FPS, markers, tracks } from '../data/project'
import { formatClock } from '../lib/time'
import { waveform } from '../lib/wave'
import { cn } from '../lib/cn'
import {
  collectSnapTimes,
  dropAccepts,
  getDraggingAsset,
  linkedIds,
  parseAssetTransfer,
  snapInterval,
  snapThresholdSeconds,
  snapToTimes,
  type EditMode,
} from '../lib/edit'
import { snapTime } from '../lib/timeline'

const LANE: Record<Track['kind'], number> = {
  video: 56,
  title: 36,
  caption: 30,
  audio: 42,
}
const HEADER = 72
const RULER = 28

type DropGhost = {
  tracks: string[]
  time: number
  duration: number
}

type Props = {
  clips: Clip[]
  selectedId: string | null
  linkedIds: Set<string>
  currentTime: number
  duration: number
  pxPerSecond: number
  snapEnabled: boolean
  editMode: EditMode
  canUnlink?: boolean
  onSelect: (id: string | null) => void
  onSeek: (time: number) => void
  onZoom: (px: number) => void
  onTrim: (id: string, start: number, duration: number, sourceIn: number) => void
  onMove: (id: string, start: number, track: string) => void
  onCommit: () => void
  onRemove: (id: string) => void
  onSplit: () => void
  onDropAsset: (asset: MediaAsset, start: number, track: string) => void
  onToggleSnap: () => void
  onEditMode: (mode: EditMode) => void
  onUnlink?: () => void
  saveStatus?: 'idle' | 'saving' | 'saved' | 'error'
}

export function Timeline({
  clips,
  selectedId,
  linkedIds,
  currentTime,
  duration,
  pxPerSecond,
  snapEnabled,
  editMode,
  canUnlink = false,
  onSelect,
  onSeek,
  onZoom,
  onTrim,
  onMove,
  onCommit,
  onRemove,
  onSplit,
  onDropAsset,
  onToggleSnap,
  onEditMode,
  onUnlink,
  saveStatus = 'idle',
}: Props) {
  const reduce = useReducedMotion()
  const scroller = useRef<HTMLDivElement>(null)
  const dragging = useRef(false)
  const [ghost, setGhost] = useState<DropGhost | null>(null)
  const [snapGuide, setSnapGuide] = useState<number | null>(null)

  const contentW = Math.max(duration * pxPerSecond + 80, 640)
  const playX = HEADER + currentTime * pxPerSecond
  const ticks = buildTicks(duration, pxPerSecond)
  const threshold = snapEnabled ? snapThresholdSeconds(pxPerSecond) : 0

  function timeFromClientX(clientX: number) {
    const el = scroller.current
    if (!el) return 0
    const x = clientX - el.getBoundingClientRect().left + el.scrollLeft - HEADER
    return Math.max(0, x / pxPerSecond)
  }

  function snapDrop(time: number, length: number, excludeIds: string[] = []) {
    const raw = Math.max(0, time)
    if (!snapEnabled) return { time: snapTime(raw, PROJECT_FPS), snapped: null as number | null }
    const targets = collectSnapTimes(clips, currentTime, excludeIds)
    const snapped = snapInterval(raw, length, targets, threshold)
    return { time: snapTime(snapped.start, PROJECT_FPS), snapped: snapped.snapped }
  }

  function startScrub(e: PointerEvent<HTMLDivElement>) {
    if (e.button !== 0) return
    if ((e.target as HTMLElement).closest('[data-clip]')) return
    dragging.current = true
    capturePointer(e)
    onSeek(timeFromClientX(e.clientX))
  }

  function moveScrub(e: PointerEvent<HTMLDivElement>) {
    if (!dragging.current || (e.buttons & 1) === 0) return
    onSeek(timeFromClientX(e.clientX))
  }

  function endScrub() {
    dragging.current = false
  }

  function onDragOverLane(e: DragEvent, track: Track) {
    const asset = peekAsset()
    if (!asset || !dropAccepts(track.id, asset.kind, asset.mediaType)) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
    const length = asset.duration > 0 ? asset.duration : 8
    const snapped = snapDrop(timeFromClientX(e.clientX), length)
    setGhost({
      tracks: asset.kind === 'video' && asset.mediaType !== 'image' ? ['V1', 'A1'] : [track.id],
      time: snapped.time,
      duration: length,
    })
    setSnapGuide(snapped.snapped)
  }

  function onDropLane(e: DragEvent, track: Track) {
    e.preventDefault()
    setGhost(null)
    setSnapGuide(null)
    const asset = parseAssetTransfer(e.dataTransfer)
    if (!asset || !dropAccepts(track.id, asset.kind, asset.mediaType)) return
    const length = asset.duration > 0 ? asset.duration : 8
    const snapped = snapDrop(timeFromClientX(e.clientX), length)
    onDropAsset(asset, snapped.time, track.id)
  }

  return (
    <div className="chrome flex h-[280px] shrink-0 flex-col border-t border-line bg-panel">
      <div className="flex min-h-10 shrink-0 items-center gap-3 border-b border-line px-3">
        <div className="flex shrink-0 items-center gap-2">
          <span className="text-[10px] font-medium tracking-[0.16em] text-mute uppercase">Timeline</span>
          {saveStatus !== 'idle' && (
            <span className={cn(
              'rounded-full border px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wider',
              saveStatus === 'error'
                ? 'border-mark/30 bg-mark/10 text-mark'
                : 'border-line bg-well text-dim',
            )}>
              {saveStatus === 'saving' ? 'Saving' : saveStatus === 'saved' ? 'Saved' : 'Save failed'}
            </span>
          )}
        </div>
        <div className="min-w-0 flex-1 overflow-x-auto scroll-thin">
          <div className="flex min-w-max items-center justify-end gap-1.5">
          <button
            type="button"
            title="Split at playhead (C)"
            aria-label="Split at playhead"
            onClick={onSplit}
            className="grid size-7 place-items-center rounded-md text-mute transition-colors hover:bg-wash hover:text-cream"
          >
            <Scissors size={11} />
          </button>
          <button
            type="button"
            title={snapEnabled ? 'Snap on (S)' : 'Snap off (S)'}
            aria-label={snapEnabled ? 'Snap on' : 'Snap off'}
            aria-pressed={snapEnabled}
            onClick={onToggleSnap}
            className={cn(
              'grid size-7 place-items-center rounded-md transition-colors hover:bg-wash hover:text-cream',
              snapEnabled ? 'bg-wash-strong text-cream ring-1 ring-inset ring-line-strong' : 'text-mute',
            )}
          >
            <Magnet size={11} />
          </button>
          {canUnlink && onUnlink && (
            <button
              type="button"
              title="Unlink (U)"
              aria-label="Unlink"
              onClick={onUnlink}
              className="grid size-7 place-items-center rounded-md text-mute transition-colors hover:bg-wash hover:text-cream"
            >
              <Unlink size={11} />
            </button>
          )}
          <div
            className="relative flex items-center gap-0.5 rounded-lg border border-line bg-well p-0.5"
            role="group"
            aria-label="Edit mode"
          >
            <span className="hidden px-1 text-[9px] font-medium tracking-[0.12em] text-dim uppercase xl:inline">
              Mode
            </span>
            <motion.button
              type="button"
              title="Overwrite: replace content at the insertion point (R)"
              aria-label="Overwrite edit mode"
              aria-pressed={editMode === 'overwrite'}
              onClick={() => onEditMode('overwrite')}
              whileHover={reduce ? undefined : { y: -1 }}
              whileTap={reduce ? undefined : { scale: 0.96 }}
              transition={{ type: 'spring', stiffness: 520, damping: 30 }}
              className={cn(
                'relative isolate z-10 h-6 rounded-md px-2.5 text-[10px] font-medium transition-colors',
                editMode === 'overwrite'
                  ? 'text-ink'
                  : 'text-dim hover:bg-wash hover:text-cream',
              )}
            >
              {editMode === 'overwrite' && (
                <motion.span
                  layoutId="timeline-edit-mode"
                  className="absolute inset-0 -z-10 rounded-md bg-cream shadow-sm"
                  transition={reduce ? { duration: 0 } : { type: 'spring', stiffness: 520, damping: 34, mass: 0.7 }}
                />
              )}
              <span className="relative">Overwrite</span>
            </motion.button>
            <motion.button
              type="button"
              title="Ripple: push following clips when inserting or trimming (R)"
              aria-label="Ripple edit mode"
              aria-pressed={editMode === 'ripple'}
              onClick={() => onEditMode('ripple')}
              whileHover={reduce ? undefined : { y: -1 }}
              whileTap={reduce ? undefined : { scale: 0.96 }}
              transition={{ type: 'spring', stiffness: 520, damping: 30 }}
              className={cn(
                'relative isolate z-10 h-6 rounded-md px-2.5 text-[10px] font-medium transition-colors',
                editMode === 'ripple'
                  ? 'text-ink'
                  : 'text-dim hover:bg-wash hover:text-cream',
              )}
            >
              {editMode === 'ripple' && (
                <motion.span
                  layoutId="timeline-edit-mode"
                  className="absolute inset-0 -z-10 rounded-md bg-cream shadow-sm"
                  transition={reduce ? { duration: 0 } : { type: 'spring', stiffness: 520, damping: 34, mass: 0.7 }}
                />
              )}
              <span className="relative">Ripple</span>
            </motion.button>
          </div>
          <span className="hidden items-center gap-1.5 whitespace-nowrap text-[10px] text-dim 2xl:flex">
            <kbd className="rounded border border-line bg-well px-1 py-0.5 font-mono text-[9px]">C</kbd> split
            <kbd className="rounded border border-line bg-well px-1 py-0.5 font-mono text-[9px]">S</kbd> snap
            <kbd className="rounded border border-line bg-well px-1 py-0.5 font-mono text-[9px]">R</kbd> mode
            <kbd className="rounded border border-line bg-well px-1 py-0.5 font-mono text-[9px]">Del</kbd> remove
          </span>
          <label className="flex items-center gap-2 text-[10px] text-dim">
            Zoom
            <input
              type="range"
              min={18}
              max={72}
              value={pxPerSecond}
              onChange={(e) => onZoom(Number(e.target.value))}
              className="w-24 accent-cream"
            />
          </label>
          </div>
        </div>
      </div>

      <div
        ref={scroller}
        className="relative min-h-0 flex-1 overflow-auto scroll-thin select-none"
        onPointerDown={startScrub}
        onPointerMove={moveScrub}
        onPointerUp={endScrub}
        onPointerCancel={endScrub}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node)) {
            setGhost(null)
            setSnapGuide(null)
          }
        }}
        onDrop={() => {
          setGhost(null)
          setSnapGuide(null)
        }}
      >
        <div className="relative" style={{ width: HEADER + contentW, minHeight: '100%' }}>
          <div
            className="chrome sticky top-0 z-20 border-b border-line bg-panel"
            style={{ height: RULER }}
          >
            <div className="absolute inset-y-0 left-0 flex w-[72px] items-center px-3 text-[9px] tracking-wider text-dim uppercase">
              TC
            </div>
            {ticks.map((t) => (
              <div
                key={t.time}
                className="absolute top-0 bottom-0"
                style={{ left: HEADER + t.time * pxPerSecond }}
              >
                <div className={cn('w-px bg-tick', t.major ? 'h-3' : 'h-1.5')} />
                {t.major && (
                  <div className="mt-0.5 font-mono text-[9px] text-dim">{formatClock(t.time)}</div>
                )}
              </div>
            ))}
            {markers
              .filter((m) => m.time <= duration)
              .map((m) => (
                <div
                  key={m.label}
                  className="absolute top-1 font-mono text-[8px] tracking-wider text-mark"
                  style={{ left: HEADER + m.time * pxPerSecond + 4 }}
                >
                  {m.label}
                </div>
              ))}
          </div>

          {tracks.map((track) => (
            <TrackLane
              key={track.id}
              track={track}
              clips={clips.filter((c) => c.track === track.id)}
              allClips={clips}
              selectedId={selectedId}
              linkedIds={linkedIds}
              currentTime={currentTime}
              pxPerSecond={pxPerSecond}
              snapEnabled={snapEnabled}
              ghost={ghost?.tracks.includes(track.id) ? ghost : null}
              onSelect={onSelect}
              onTrim={onTrim}
              onMove={onMove}
              onCommit={onCommit}
              onRemove={onRemove}
              onSnapGuide={setSnapGuide}
              onDragOver={(e) => onDragOverLane(e, track)}
              onDrop={(e) => onDropLane(e, track)}
            />
          ))}

          {snapGuide != null && (
            <div
              className="pointer-events-none absolute top-0 bottom-0 z-20"
              style={{ left: HEADER + snapGuide * pxPerSecond }}
            >
              <div className="h-full w-px bg-cream/45" />
            </div>
          )}

          <div
            className="pointer-events-none absolute top-0 bottom-0 z-30"
            style={{ left: playX }}
          >
            <div className="playhead-head absolute -top-0 -left-[5px] h-2 w-2.5 bg-mark" />
            <div className="h-full w-px bg-mark shadow-[0_0_8px_#ff4336]" />
          </div>
        </div>
      </div>
    </div>
  )
}

function TrackLane({
  track,
  clips,
  allClips,
  selectedId,
  linkedIds,
  currentTime,
  pxPerSecond,
  snapEnabled,
  ghost,
  onSelect,
  onTrim,
  onMove,
  onCommit,
  onRemove,
  onSnapGuide,
  onDragOver,
  onDrop,
}: {
  track: Track
  clips: Clip[]
  allClips: Clip[]
  selectedId: string | null
  linkedIds: Set<string>
  currentTime: number
  pxPerSecond: number
  snapEnabled: boolean
  ghost: DropGhost | null
  onSelect: (id: string) => void
  onTrim: (id: string, start: number, duration: number, sourceIn: number) => void
  onMove: (id: string, start: number, track: string) => void
  onCommit: () => void
  onRemove: (id: string) => void
  onSnapGuide: (time: number | null) => void
  onDragOver: (e: DragEvent) => void
  onDrop: (e: DragEvent) => void
}) {
  return (
    <div
      data-lane={track.id}
      className="relative border-b border-line"
      style={{ height: LANE[track.kind] }}
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
      <div className="chrome sticky left-0 z-10 flex h-full w-[72px] items-center gap-1.5 border-r border-line bg-panel px-2">
        <span className="w-6 font-mono text-[10px] text-mute">{track.label}</span>
        <span className="text-dim">
          {track.kind === 'audio' ? (
            <Volume2 size={10} />
          ) : track.kind === 'title' ? (
            <Type size={10} />
          ) : track.kind === 'caption' ? (
            <Captions size={10} />
          ) : (
            <Eye size={10} />
          )}
        </span>
      </div>

      {ghost && (
        <div
          className="pointer-events-none absolute top-1.5 bottom-1.5 rounded-[4px] border border-dashed border-cream/40 bg-cream/10"
          style={{
            left: HEADER + ghost.time * pxPerSecond,
            width: Math.max(ghost.duration * pxPerSecond, 8),
          }}
        />
      )}

      {clips.map((clip) => (
        <ClipBlock
          key={clip.id}
          clip={clip}
          selected={selectedId === clip.id}
          linked={selectedId !== clip.id && linkedIds.has(clip.id)}
          allClips={allClips}
          currentTime={currentTime}
          pxPerSecond={pxPerSecond}
          snapEnabled={snapEnabled}
          onSelect={onSelect}
          onTrim={onTrim}
          onMove={onMove}
          onCommit={onCommit}
          onRemove={onRemove}
          onSnapGuide={onSnapGuide}
        />
      ))}
    </div>
  )
}

function ClipBlock({
  clip,
  selected,
  linked,
  allClips,
  currentTime,
  pxPerSecond,
  snapEnabled,
  onSelect,
  onTrim,
  onMove,
  onCommit,
  onRemove,
  onSnapGuide,
}: {
  clip: Clip
  selected: boolean
  linked: boolean
  allClips: Clip[]
  currentTime: number
  pxPerSecond: number
  snapEnabled: boolean
  onSelect: (id: string) => void
  onTrim: (id: string, start: number, duration: number, sourceIn: number) => void
  onMove: (id: string, start: number, track: string) => void
  onCommit: () => void
  onRemove: (id: string) => void
  onSnapGuide: (time: number | null) => void
}) {
  const bars = waveform(clip.waveSeed ?? 1, Math.max(12, Math.floor(clip.duration * 6)))
  const session = useRef<{
    kind: 'move' | 'in' | 'out'
    pointerId: number
    x: number
    start: number
    duration: number
    sourceIn: number
    sourceDuration: number
    armed: boolean
  } | null>(null)

  function excludeIds() {
    return linkedIds(allClips, clip.id)
  }

  function applySnap(start: number, duration: number) {
    if (!snapEnabled) {
      onSnapGuide(null)
      return { start: snapTime(Math.max(0, start), PROJECT_FPS), snapped: null as number | null }
    }
    const targets = collectSnapTimes(allClips, currentTime, excludeIds())
    const threshold = snapThresholdSeconds(pxPerSecond)
    const snapped = snapInterval(start, duration, targets, threshold)
    onSnapGuide(snapped.snapped)
    return { start: snapTime(Math.max(0, snapped.start), PROJECT_FPS), snapped: snapped.snapped }
  }

  function begin(kind: 'move' | 'in' | 'out', e: PointerEvent<Element>) {
    if (e.button !== 0) return
    e.stopPropagation()
    e.preventDefault()
    onSelect(clip.id)
    session.current = {
      kind,
      pointerId: e.pointerId,
      x: e.clientX,
      start: clip.start,
      duration: clip.duration,
      sourceIn: clip.sourceIn ?? 0,
      sourceDuration: clip.sourceDuration ?? 0,
      armed: kind !== 'move',
    }
    capturePointer(e)
    ;(e.currentTarget as HTMLElement).focus?.()
  }

  function drag(e: PointerEvent<Element>) {
    const s = session.current
    if (!s || s.pointerId !== e.pointerId) return
    if ((e.buttons & 1) === 0) return

    const dt = (e.clientX - s.x) / pxPerSecond
    const frame = 1 / PROJECT_FPS
    if (s.kind === 'move') {
      if (!s.armed) {
        if (Math.abs(e.clientX - s.x) < 6) return
        s.armed = true
      }
      const snapped = applySnap(Math.max(0, s.start + dt), s.duration)
      onMove(clip.id, snapped.start, clip.track)
      return
    }
    if (s.kind === 'in') {
      const rawStart = Math.min(s.start + s.duration - frame, s.start + dt)
      let start = rawStart
      let duration = s.duration - (rawStart - s.start)
      let sourceIn = s.sourceIn + (rawStart - s.start)
      if (sourceIn < 0) {
        start -= sourceIn
        duration += sourceIn
        sourceIn = 0
      }
      if (start < 0) {
        sourceIn -= start
        duration += start
        start = 0
      }
      if (snapEnabled) {
        const targets = collectSnapTimes(allClips, currentTime, excludeIds())
        const snapped = snapToTimes(start, targets, snapThresholdSeconds(pxPerSecond))
        const delta = snapped.time - start
        start = snapped.time
        duration -= delta
        sourceIn += delta
        if (sourceIn < 0) {
          start -= sourceIn
          duration += sourceIn
          sourceIn = 0
        }
        onSnapGuide(snapped.snapped)
      }
      onTrim(clip.id, snapTime(start, PROJECT_FPS), Math.max(frame, duration), Math.max(0, sourceIn))
      return
    }
    let duration = Math.max(frame, s.duration + dt)
    if (s.sourceDuration > 0) {
      duration = Math.min(duration, Math.max(frame, s.sourceDuration - s.sourceIn))
    }
    if (snapEnabled) {
      const targets = collectSnapTimes(allClips, currentTime, excludeIds())
      const snapped = snapToTimes(s.start + duration, targets, snapThresholdSeconds(pxPerSecond))
      duration = Math.max(frame, snapped.time - s.start)
      if (s.sourceDuration > 0) {
        duration = Math.min(duration, Math.max(frame, s.sourceDuration - s.sourceIn))
      }
      onSnapGuide(snapped.snapped)
    }
    onTrim(clip.id, s.start, duration, s.sourceIn)
  }

  function end(e: PointerEvent<Element>) {
    if (!session.current || session.current.pointerId !== e.pointerId) return
    const armed = session.current.armed
    session.current = null
    onSnapGuide(null)
    try {
      e.currentTarget.releasePointerCapture(e.pointerId)
    } catch {
      /* already released */
    }
    if (armed) onCommit()
  }

  return (
    <div
      role="button"
      tabIndex={0}
      data-clip
      onPointerDown={(e) => begin('move', e)}
      onPointerMove={drag}
      onPointerUp={end}
      onPointerCancel={end}
      onKeyDown={(e) => {
        if (e.key === 'Delete' || e.key === 'Backspace') {
          e.preventDefault()
          e.stopPropagation()
          onRemove(clip.id)
        }
      }}
      className={cn(
        'absolute top-1.5 bottom-1.5 overflow-hidden rounded-[4px] text-left',
        selected
          ? 'z-10 cursor-grab ring-1 ring-cream active:cursor-grabbing'
          : linked
            ? 'z-10 cursor-grab ring-1 ring-cream/40'
            : 'ring-1 ring-tick',
      )}
      style={{
        left: HEADER + clip.start * pxPerSecond,
        width: Math.max(clip.duration * pxPerSecond, 8),
        background: clip.thumb
          ? `linear-gradient(180deg, rgb(0 0 0 / 0.15), rgb(0 0 0 / 0.45)), url(${clip.thumb}) center/cover`
          : clip.kind === 'audio'
            ? 'linear-gradient(180deg, #16352c, #10241f)'
            : clip.kind === 'caption'
              ? 'linear-gradient(180deg, #243848, #16232e)'
              : 'linear-gradient(180deg, #2a2418, #1b1710)',
      }}
    >
      {clip.mediaType === 'video' && clip.src && clip.kind !== 'audio' && (
        <>
          <video
            key={`${clip.src}:${clip.sourceIn ?? 0}`}
            src={clip.src}
            muted
            preload="metadata"
            playsInline
            onLoadedMetadata={(event) => {
              const inPoint = clip.sourceIn ?? 0
              if (inPoint > 0) event.currentTarget.currentTime = inPoint
            }}
            className="pointer-events-none absolute inset-0 size-full object-cover"
          />
          <span className="pointer-events-none absolute inset-0 bg-linear-to-t from-black/55 to-black/10" />
        </>
      )}
      {clip.kind === 'audio' && (
        <div className="absolute inset-x-1 inset-y-1 flex items-end gap-px">
          {bars.map((h, i) => (
            <span
              key={i}
              className="min-w-px flex-1 rounded-sm bg-audio/80"
              style={{ height: `${h * 100}%` }}
            />
          ))}
        </div>
      )}
      <span className="relative z-10 flex items-center gap-1 truncate pr-5 pl-1.5 pt-0.5 text-[10px] font-medium text-plate drop-shadow">
        {clip.linkId && <Link2 size={8} className="shrink-0 opacity-80" />}
        {clip.name}
      </span>
      {selected && (
        <>
          <button
            type="button"
            data-clip
            aria-label={`Remove ${clip.name}`}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation()
              onRemove(clip.id)
            }}
            className="absolute top-0.5 right-0.5 z-20 grid size-4 place-items-center rounded-sm bg-black/55 text-plate/80 hover:bg-mark hover:text-plate"
          >
            <X size={9} />
          </button>
          <span
            data-clip
            onPointerDown={(e) => begin('in', e)}
            onPointerMove={drag}
            onPointerUp={end}
            onPointerCancel={end}
            className="absolute inset-y-0 left-0 z-20 w-1.5 cursor-ew-resize bg-plate/80"
          />
          <span
            data-clip
            onPointerDown={(e) => begin('out', e)}
            onPointerMove={drag}
            onPointerUp={end}
            onPointerCancel={end}
            className="absolute inset-y-0 right-0 z-20 w-1.5 cursor-ew-resize bg-plate/80"
          />
        </>
      )}
    </div>
  )
}

function capturePointer(e: PointerEvent<Element>) {
  try {
    e.currentTarget.setPointerCapture(e.pointerId)
  } catch {
    // synthetic or already-released pointers
  }
}

function peekAsset() {
  return getDraggingAsset()
}

function buildTicks(duration: number, pxPerSecond: number) {
  const step = pxPerSecond >= 48 ? 1 : pxPerSecond >= 28 ? 2 : 5
  const ticks: { time: number; major: boolean }[] = []
  const last = Math.ceil(duration)
  for (let t = 0; t <= last; t += 1) {
    ticks.push({ time: t, major: t % step === 0 })
  }
  return ticks
}
