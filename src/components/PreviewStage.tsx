import {
  Maximize2,
  Pause,
  Play,
  Scan,
  SkipBack,
  SkipForward,
  Volume2,
  VolumeX,
} from 'lucide-react'
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent } from 'react'
import { AnimatePresence, motion, useMotionValue, useReducedMotion, useSpring, useTransform } from 'framer-motion'
import type { Clip, Grade } from '../types'
import { PROJECT_FPS, clipsAtTime } from '../data/project'
import { captionFontPx, cueAt, DEFAULT_CAPTION_FONT, useCaptionCues } from '../lib/captions'
import { DEFAULT_FRAME, fitContain, resolutionLabel } from '../lib/frame'
import { programLabel, type ProgramFrame } from '../lib/program'
import { formatRange, formatTimecode } from '../lib/time'
import { fadeSlow, softSpring } from '../lib/motion'
import { Atmosphere } from './Atmosphere'
import { IconButton } from './ui'
import { cn } from '../lib/cn'
import { propertyAt } from '../lib/keyframes'

import { detectGPUCapabilities, type GPUCapability } from '../lib/webgpu/capabilities'

type Props = {
  currentTime: number
  isPlaying: boolean
  muted: boolean
  safeArea: boolean
  splitPreview?: boolean
  program: ProgramFrame
  audioClips?: Clip[]
  grade: Grade
  duration: number
  projectId?: string
  timelineRevision?: number
  onTogglePlay: () => void
  onSeek: (time: number) => void
  onToggleMute: () => void
  onToggleSafe: () => void
}

export function PreviewStage({
  currentTime,
  isPlaying,
  muted,
  safeArea,
  splitPreview = false,
  program,
  audioClips = [],
  grade,
  duration,
  projectId = '',
  timelineRevision = 0,
  onTogglePlay,
  onSeek,
  onToggleMute,
  onToggleSafe,
}: Props) {
  const [forceVideo, setForceVideo] = useState(false)
  const [gpuCapability, setGpuCapability] = useState<GPUCapability>('unknown')

  useEffect(() => {
    detectGPUCapabilities().then((caps) => setGpuCapability(caps.renderMode)).catch(() => {})
  }, [])

  const reduce = useReducedMotion()
  const filter = [
    `contrast(${1 + grade.contrast * 0.18})`,
    `saturate(${1 + grade.saturation * 0.2})`,
    `sepia(${Math.max(0, grade.warmth) * 0.22})`,
    `hue-rotate(${grade.warmth * -8}deg)`,
  ].join(' ')

  const pictureStyle = program.video ? clipVisualStyle(program.video.clip, currentTime) : undefined
  const pictureFilter = program.video ? clipFilter(program.video.clip, filter) : filter

  const progress = duration > 0 ? currentTime / duration : 0
  const wellRef = useRef<HTMLDivElement>(null)
  const [well, setWell] = useState({ width: 0, height: 0 })
  const [decoded, setDecoded] = useState({ width: 0, height: 0 })
  const px = useMotionValue(0)
  const py = useMotionValue(0)
  const spring = { stiffness: 70, damping: 22, mass: 0.8 }
  const rotateX = useSpring(useTransform(py, [-0.5, 0.5], [1.2, -1.2]), spring)
  const rotateY = useSpring(useTransform(px, [-0.5, 0.5], [-1.6, 1.6]), spring)
  const shiftX = useSpring(useTransform(px, [-0.5, 0.5], [-5, 5]), spring)
  const shiftY = useSpring(useTransform(py, [-0.5, 0.5], [-3, 3]), spring)

  const frame = useMemo(() => {
    if (decoded.width > 0 && decoded.height > 0) return decoded
    if (program.video?.clip.width && program.video.clip.height) {
      return { width: program.video.clip.width, height: program.video.clip.height }
    }
    return DEFAULT_FRAME
  }, [program.video?.clip.width, program.video?.clip.height, decoded])

  const fitted = useMemo(
    () => fitContain(well.width, well.height, frame.width, frame.height),
    [well, frame],
  )

  const frameLabel = resolutionLabel(frame.width, frame.height)
  const liveAudio = useMemo(() => clipsAtTime(audioClips, currentTime), [audioClips, currentTime])
  const liveAudioIds = useMemo(() => new Set(liveAudio.map((item) => item.id)), [liveAudio])
  const captionClip = program.captions?.clip
  const captionCues = useCaptionCues(projectId, captionClip?.mediaPath, timelineRevision)
  const captionText = useMemo(() => {
    if (!captionClip) return ''
    const sourceTime = program.captions?.sourceTime ?? 0
    return cueAt(captionCues, sourceTime)?.text ?? ''
  }, [captionClip, captionCues, program.captions?.sourceTime])

  useLayoutEffect(() => {
    const el = wellRef.current
    if (!el) return
    const measure = () => {
      const next = { width: el.clientWidth, height: el.clientHeight }
      setWell((cur) => (cur.width === next.width && cur.height === next.height ? cur : next))
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  const picture = program.video?.clip
  useEffect(() => {
    setDecoded(
      picture?.width && picture.height
        ? { width: picture.width, height: picture.height }
        : { width: 0, height: 0 },
    )
  }, [picture])

  function onWellMove(e: PointerEvent<HTMLDivElement>) {
    if (reduce) return
    const r = e.currentTarget.getBoundingClientRect()
    px.set((e.clientX - r.left) / r.width - 0.5)
    py.set((e.clientY - r.top) / r.height - 0.5)
  }

  function onWellLeave() {
    px.set(0)
    py.set(0)
  }

  return (
    <section className="chrome flex min-h-0 min-w-0 flex-1 flex-col bg-void">
      <div className="flex h-10 shrink-0 items-center justify-between px-4">
        <div className="flex min-w-0 items-center gap-2 text-[11px] text-mute">
          <span className="truncate text-cream">{programLabel(program)}</span>
          <span className="text-dim">·</span>
          <span className="font-mono text-dim">Program</span>
          {program.video && frameLabel && (
            <>
              <span className="text-dim">·</span>
              <span className="font-mono text-dim">{frameLabel}</span>
            </>
          )}
          {gpuCapability !== 'unknown' && (
            <>
              <span className="text-dim">·</span>
              <span
                className={cn(
                  'rounded px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider font-semibold',
                  gpuCapability === 'webgpu'
                    ? 'border border-emerald-500/30 bg-emerald-500/10 text-emerald-400'
                    : 'border border-amber-500/30 bg-amber-500/10 text-amber-400',
                )}
                title={gpuCapability === 'webgpu' ? 'Hardware-accelerated WebGPU rendering active' : 'Canvas2D GPU fallback rendering active'}
              >
                {gpuCapability === 'webgpu' ? '⚡ GPU (WebGPU)' : '⚡ GPU (Canvas2D)'}
              </span>
            </>
          )}
        </div>
        <div className="flex items-center gap-0.5">
          <IconButton label="Safe area" active={safeArea} onClick={onToggleSafe}>
            <Scan size={14} />
          </IconButton>
          <IconButton label={forceVideo ? 'Using video' : 'Use video'} active={forceVideo} onClick={() => setForceVideo((s) => !s)}>
            <Maximize2 size={14} />
          </IconButton>
        </div>
      </div>

      <div
        ref={wellRef}
        className="relative flex min-h-0 flex-1 items-center justify-center px-6 pb-2"
        onPointerMove={onWellMove}
        onPointerLeave={onWellLeave}
        style={{ perspective: 900 }}
      >
        <div className="sr-only" aria-hidden>
          {audioClips.map((audio) => (
            audio.src ? (
              <ProgramAudio
                key={audio.id}
                src={audio.src}
                mediaType={audio.mediaType}
                start={audio.start}
                sourceIn={audio.sourceIn ?? 0}
                currentTime={currentTime}
                isPlaying={isPlaying}
                muted={muted}
                active={liveAudioIds.has(audio.id)}
                rate={audio.playback?.rate ?? 1}
                volumeDb={audio.audio?.volumeDb ?? 0}
                clipMuted={audio.audio?.muted ?? false}
              />
            ) : null
          ))}
        </div>
        <Atmosphere playing={isPlaying} />
        <motion.div
          className="relative z-10 overflow-hidden rounded-sm bg-black shadow-[0_0_0_1px_var(--preview-ring),0_30px_80px_var(--preview-glow)]"
          animate={fitted.width > 0 ? { width: fitted.width, height: fitted.height } : undefined}
          transition={reduce ? { duration: 0 } : { type: 'spring', stiffness: 280, damping: 32, mass: 0.8 }}
          style={{
            width: fitted.width || 'auto',
            height: fitted.height || '100%',
            maxWidth: '100%',
            maxHeight: '100%',
            aspectRatio: fitted.width ? undefined : `${frame.width} / ${frame.height}`,
            ...(reduce
              ? {}
              : {
                  rotateX,
                  rotateY,
                  x: shiftX,
                  y: shiftY,
                  transformPerspective: 900,
                }),
          }}
        >
          <AnimatePresence initial={false}>
            {program.video?.clip.mediaType === 'video' && program.video.clip.src ? (
              <PreviewVideo
                key={program.video.clip.src}
                src={program.video.clip.src}
                start={program.video.clip.start}
                sourceIn={program.video.clip.sourceIn ?? 0}
                currentTime={currentTime}
                isPlaying={isPlaying}
                muted
                filter={pictureFilter}
                visualStyle={pictureStyle}
                rate={program.video.clip.playback?.rate ?? 1}
                reduce={!!reduce}
                onFrame={(width, height) => setDecoded({ width, height })}
              />
            ) : program.video?.clip.thumb ? (
              <motion.img
                key={program.video.clip.id}
                src={program.video.clip.thumb}
                alt=""
                initial={reduce ? false : { opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={reduce ? undefined : { opacity: 0 }}
                transition={fadeSlow}
                onLoad={(event) => {
                  const el = event.currentTarget
                  if (el.naturalWidth > 0 && el.naturalHeight > 0) {
                    setDecoded({ width: el.naturalWidth, height: el.naturalHeight })
                  }
                }}
                className="preview-plate absolute inset-0 size-full object-contain"
                style={{ filter: pictureFilter, ...pictureStyle }}
              />
            ) : program.video ? (
              <motion.div
                key={program.video.clip.id}
                initial={reduce ? false : { opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={reduce ? undefined : { opacity: 0 }}
                transition={fadeSlow}
                className="absolute inset-0 grid place-items-center bg-black px-6 text-center"
              >
                <div>
                  <div className="text-[13px] text-cream">{program.video.clip.name}</div>
                  <div className="mt-1 text-[11px] text-mute">
                    {program.video.clip.mediaPath ? 'Media is on the timeline but the preview file is unavailable' : 'No media attached'}
                  </div>
                </div>
              </motion.div>
            ) : null}
          </AnimatePresence>

          <div className="grain pointer-events-none absolute inset-0" />
          <div className="pointer-events-none absolute inset-0 bg-linear-to-t from-black/35 via-transparent to-black/10" />

          {safeArea && (
            <div className="pointer-events-none absolute inset-[8%] border border-white/25" />
          )}

          <AnimatePresence>
            {program.overlay && (
                <motion.div
                  initial={false}
                  transition={fadeSlow}
                  className="pointer-events-none absolute whitespace-pre-wrap"
                  style={titleVisualStyle(program.overlay.clip, currentTime)}
                >
                  {renderTitleOverlay(program.overlay.clip, currentTime)}
                </motion.div>
              )}
          </AnimatePresence>

          {captionText && captionClip ? (
            <div
              className="pointer-events-none absolute z-20 max-w-[86%] text-center"
              style={captionVisualStyle(captionClip, currentTime, fitted.height)}
            >
              <span className="inline-block max-w-full whitespace-pre-wrap rounded-[3px] px-[0.45em] py-[0.12em] leading-snug [text-shadow:0_1px_1px_#000,0_0_6px_#000]">
                {captionText}
              </span>
            </div>
          ) : null}

          <div className="pointer-events-none absolute top-3 left-3 z-10 flex items-center gap-2">
            <motion.span
              className={cn(
                'size-1.5 rounded-full',
                isPlaying ? 'bg-mark shadow-[0_0_8px_#ff4336]' : 'bg-white/40',
              )}
              animate={
                isPlaying && !reduce
                  ? { scale: [1, 1.28, 1], opacity: [1, 0.7, 1] }
                  : { scale: 1, opacity: 1 }
              }
              transition={isPlaying ? { duration: 1.5, repeat: Infinity } : { duration: 0.2 }}
            />
            <span className="font-mono text-[10px] tracking-wider text-white/80">
              {formatTimecode(currentTime, PROJECT_FPS)}
            </span>
          </div>
        </motion.div>
      </div>

      <div className="flex h-14 shrink-0 items-center gap-3 px-4">
        <div className="flex items-center gap-0.5">
          <IconButton label="Back 2s" onClick={() => onSeek(currentTime - 2)}>
            <SkipBack size={15} />
          </IconButton>
          <motion.button
            type="button"
            onClick={onTogglePlay}
            aria-label={isPlaying ? 'Pause' : 'Play'}
            whileHover={reduce ? undefined : { scale: 1.05 }}
            whileTap={reduce ? undefined : { scale: 0.9 }}
            transition={softSpring}
            className="grid size-9 place-items-center rounded-full bg-cream text-ink"
          >
            {splitPreview && (
              <div className="pointer-events-none absolute inset-0 z-20">
                <div className="absolute inset-y-0 left-1/2 w-px bg-white/60" />
                <div className="absolute top-3 left-1/4 text-white/80 text-[12px]">Before</div>
                <div className="absolute top-3 right-1/4 text-white/80 text-[12px]">After</div>
              </div>
            )}
            <AnimatePresence mode="wait" initial={false}>
              <motion.span
                key={isPlaying ? 'pause' : 'play'}
                initial={reduce ? false : { opacity: 0, scale: 0.65 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={reduce ? undefined : { opacity: 0, scale: 0.65 }}
                transition={{ duration: 0.14 }}
                className="grid place-items-center"
              >
                {isPlaying ? (
                  <Pause size={15} fill="currentColor" />
                ) : (
                  <Play size={15} fill="currentColor" className="ml-0.5" />
                )}
              </motion.span>
            </AnimatePresence>
          </motion.button>
          <IconButton label="Forward 2s" onClick={() => onSeek(currentTime + 2)}>
            <SkipForward size={15} />
          </IconButton>
        </div>

        <div className="min-w-[7.5rem] font-mono text-[12px] text-cream">
          {formatTimecode(currentTime, PROJECT_FPS)}
          <span className="text-dim"> / {formatTimecode(duration, PROJECT_FPS)}</span>
        </div>

        <div className="relative h-1 min-w-0 flex-1 rounded-full bg-wash-strong">
          <div
            className="absolute inset-y-0 left-0 rounded-full bg-cream/80"
            style={{ width: `${progress * 100}%` }}
          />
          <input
            type="range"
            min={0}
            max={duration}
            step={1 / PROJECT_FPS}
            value={currentTime}
            onChange={(e) => onSeek(Number(e.target.value))}
            className="absolute inset-0 w-full cursor-pointer opacity-0"
            aria-label="Scrub program"
          />
        </div>

        <IconButton label={muted ? 'Unmute' : 'Mute'} onClick={onToggleMute}>
          {muted ? <VolumeX size={15} /> : <Volume2 size={15} />}
        </IconButton>
      </div>

      <ClipInspector program={program} frameLabel={frameLabel} />
    </section>
  )
}

function mediaClockTime(
  media: HTMLMediaElement,
  start: number,
  sourceIn: number,
  timelineTime: number,
  rate = 1,
) {
  const localTime = sourceIn + Math.max(0, timelineTime - start) * rate
  const duration = Number.isFinite(media.duration) ? media.duration : 0
  return duration > 0 ? Math.min(localTime, Math.max(0, duration - 0.001)) : localTime
}

function syncMediaClock(
  media: HTMLMediaElement,
  start: number,
  sourceIn: number,
  timelineTime: number,
  isPlaying: boolean,
  active = true,
  rate = 1,
) {
  if (media.readyState < HTMLMediaElement.HAVE_METADATA) return
  if (!active) {
    if (!media.paused) media.pause()
    return
  }
  const next = mediaClockTime(media, start, sourceIn, timelineTime, rate)
  media.playbackRate = Math.min(8, Math.max(.1, rate))
  const drift = Math.abs(media.currentTime - next)
  if (!isPlaying) {
    if (drift > 1 / 60) media.currentTime = next
    if (!media.paused) media.pause()
    return
  }
  if (drift > 0.25) media.currentTime = next
  if (media.paused) void media.play().catch(() => undefined)
}

function PreviewVideo({
  src,
  start,
  sourceIn,
  currentTime,
  isPlaying,
  muted,
  filter,
  visualStyle,
  rate,
  reduce,
  onFrame,
}: {
  src: string
  start: number
  sourceIn: number
  currentTime: number
  isPlaying: boolean
  muted: boolean
  filter: string
  visualStyle?: CSSProperties
  rate: number
  reduce: boolean
  onFrame?: (width: number, height: number) => void
}) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const startRef = useRef(start)
  const sourceInRef = useRef(sourceIn)
  const currentTimeRef = useRef(currentTime)
  const isPlayingRef = useRef(isPlaying)
  const onFrameRef = useRef(onFrame)
  startRef.current = start
  sourceInRef.current = sourceIn
  currentTimeRef.current = currentTime
  isPlayingRef.current = isPlaying
  onFrameRef.current = onFrame

  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    let cancelled = false

    const reportFrame = () => {
      if (cancelled || video.videoWidth < 1 || video.videoHeight < 1) return
      onFrameRef.current?.(video.videoWidth, video.videoHeight)
    }

    const onReady = () => {
      if (cancelled) return
      // Debug logging to help diagnose black preview issues
      try {
        // eslint-disable-next-line no-console
        console.log('PreviewVideo ready', { src, readyState: video.readyState, videoWidth: video.videoWidth, videoHeight: video.videoHeight })
      } catch {}
      reportFrame()
      syncMediaClock(
        video,
        startRef.current,
        sourceInRef.current,
        currentTimeRef.current,
        isPlayingRef.current,
        true,
        rate,
      )
    }

    video.addEventListener('loadedmetadata', onReady)
    video.addEventListener('loadeddata', reportFrame)
    video.addEventListener('resize', reportFrame)
    video.addEventListener('canplay', onReady)
    if (video.readyState >= HTMLMediaElement.HAVE_METADATA) onReady()

    return () => {
      cancelled = true
      video.removeEventListener('loadedmetadata', onReady)
      video.removeEventListener('loadeddata', reportFrame)
      video.removeEventListener('resize', reportFrame)
      video.removeEventListener('canplay', onReady)
    }
  }, [src, rate])

  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    syncMediaClock(video, start, sourceIn, currentTime, isPlaying, true, rate)
  }, [currentTime, isPlaying, start, sourceIn, rate])

  return (
    <motion.div
      initial={reduce ? false : { opacity: 0 }}
      animate={{ opacity: 1, scale: isPlaying ? 1.018 : 1.006 }}
      exit={reduce ? undefined : { opacity: 0 }}
      transition={{ opacity: { duration: 0.12 }, scale: { duration: 1.4, ease: 'linear' } }}
      className="preview-plate absolute inset-0"
      style={visualStyle}
    >
      <video
        ref={videoRef}
        src={src}
        muted={muted}
        playsInline
        preload="auto"
        className="size-full object-contain"
        style={{ filter }}
      />
    </motion.div>
  )
}

function clipVisualStyle(clip: Clip, time: number): CSSProperties {
  const transform = clip.transform
  const x = propertyAt(clip, 'transform.x', time, transform?.x ?? 960)
  const y = propertyAt(clip, 'transform.y', time, transform?.y ?? 540)
  const scaleX = propertyAt(clip, 'transform.scale_x', time, transform?.scaleX ?? 1)
  const scaleY = propertyAt(clip, 'transform.scale_y', time, transform?.scaleY ?? 1)
  const rotation = propertyAt(clip, 'transform.rotation', time, transform?.rotation ?? 0)
  const opacity = propertyAt(clip, 'transform.opacity', time, transform?.opacity ?? 1)
  const top = propertyAt(clip, 'transform.crop_top', time, transform?.cropTop ?? 0) * 100
  const right = propertyAt(clip, 'transform.crop_right', time, transform?.cropRight ?? 0) * 100
  const bottom = propertyAt(clip, 'transform.crop_bottom', time, transform?.cropBottom ?? 0) * 100
  const left = propertyAt(clip, 'transform.crop_left', time, transform?.cropLeft ?? 0) * 100
  return {
    opacity,
    transformOrigin: `${(transform?.anchorX ?? .5) * 100}% ${(transform?.anchorY ?? .5) * 100}%`,
    transform: `translate(${(x - 960) / 19.2}%, ${(y - 540) / 10.8}%) scale(${scaleX}, ${scaleY}) rotate(${rotation}deg)`,
    clipPath: `inset(${top}% ${right}% ${bottom}% ${left}%)`,
  }
}

function clipFilter(clip: Clip, base: string) {
  const grade = clip.grade
  if (!grade) return base
  return [base, `brightness(${Math.pow(2, grade.exposure ?? 0)})`, `contrast(${1 + (grade.contrast ?? 0)})`, `saturate(${1 + (grade.saturation ?? 0)})`, `sepia(${Math.max(0, grade.temperature ?? 0) * .25})`, `hue-rotate(${(grade.tint ?? 0) * 20}deg)`].join(' ')
}

function captionVisualStyle(clip: Clip, time: number, plateHeight: number): CSSProperties {
  const transform = clip.transform
  const x = propertyAt(clip, 'transform.x', time, transform?.x ?? 960)
  const y = propertyAt(clip, 'transform.y', time, transform?.y ?? 1000)
  const scaleX = propertyAt(clip, 'transform.scale_x', time, transform?.scaleX ?? 1)
  const scaleY = propertyAt(clip, 'transform.scale_y', time, transform?.scaleY ?? 1)
  const opacity = propertyAt(clip, 'transform.opacity', time, transform?.opacity ?? 1)
  const fontSize = propertyAt(clip, 'title.font_size', time, clip.title?.fontSize ?? DEFAULT_CAPTION_FONT)
  const ax = transform?.anchorX ?? 0.5
  const ay = transform?.anchorY ?? 1
  return {
    left: `${x / 19.2}%`,
    top: `${y / 10.8}%`,
    transform: `translate(${-ax * 100}%, ${-ay * 100}%)`,
    opacity,
    fontSize: `${captionFontPx(fontSize, (scaleX + scaleY) / 2, plateHeight)}px`,
    fontWeight: clip.title?.fontWeight ?? 600,
    color: clip.title?.fill ?? '#fff',
    background: clip.title?.background ?? 'rgba(0,0,0,0.55)',
    WebkitTextStroke: clip.title?.stroke ? `${clip.title.strokeWidth ?? 1}px ${clip.title.stroke}` : undefined,
    fontFamily: clip.title?.fontFamily || `'Noto Sans Devanagari', 'Noto Sans', system-ui, sans-serif`,
    textAlign: (clip.title?.align as CSSProperties['textAlign']) ?? 'center',
  }
}

function titleVisualStyle(clip: Clip, time: number): CSSProperties {
  const transform = clip.transform
  const x = propertyAt(clip, 'transform.x', time, transform?.x ?? 960)
  const y = propertyAt(clip, 'transform.y', time, transform?.y ?? 96)
  const opacity = propertyAt(clip, 'transform.opacity', time, transform?.opacity ?? 1)
  const fontSize = propertyAt(clip, 'title.font_size', time, clip.title?.fontSize ?? 64)
  return {
    left: `${x / 19.2}%`, top: `${y / 10.8}%`, opacity,
    transform: `translate(${-(transform?.anchorX ?? .5) * 100}%, ${-(transform?.anchorY ?? 0) * 100}%) scale(${transform?.scaleX ?? 1}, ${transform?.scaleY ?? 1}) rotate(${transform?.rotation ?? 0}deg)`,
    transformOrigin: 'center', color: clip.title?.fill ?? '#fff', background: clip.title?.background,
    WebkitTextStroke: clip.title?.stroke ? `${clip.title.strokeWidth ?? 1}px ${clip.title.stroke}` : undefined,
    fontFamily: clip.title?.fontFamily, fontSize: `${fontSize / 19.2}vw`, fontWeight: clip.title?.fontWeight ?? 600,
    textAlign: (clip.title?.align as CSSProperties['textAlign']) ?? 'center',
  }
}

function renderTitleOverlay(clip: Clip, time: number) {
  const title = clip.title
  if (!title) return clip.name || null
  if (!title.words || title.words.length === 0) return title.text || clip.name || null

  // Highlight the active word based on timeline time (time is timeline seconds)
  return (
    <div>
      {title.words.map((w, i) => {
        const active = time >= (w.startSec ?? 0) && time < (w.endSec ?? Infinity)
        return (
          <span key={i} style={{ marginRight: 6, color: active ? (title.highlightColor ?? '#ffe600') : title.fill ?? '#fff', transform: active ? `scale(${title.activeScale ?? 1})` : undefined, display: 'inline-block' }}>
            {w.word}
          </span>
        )
      })}
    </div>
  )
}

function ProgramAudio({
  src,
  mediaType,
  start,
  sourceIn,
  currentTime,
  isPlaying,
  muted,
  active,
  rate,
  volumeDb,
  clipMuted,
}: {
  src: string
  mediaType?: Clip['mediaType']
  start: number
  sourceIn: number
  currentTime: number
  isPlaying: boolean
  muted: boolean
  active: boolean
  rate: number
  volumeDb: number
  clipMuted: boolean
}) {
  const mediaRef = useRef<HTMLVideoElement>(null)
  const startRef = useRef(start)
  const sourceInRef = useRef(sourceIn)
  const currentTimeRef = useRef(currentTime)
  const isPlayingRef = useRef(isPlaying)
  const activeRef = useRef(active)
  startRef.current = start
  sourceInRef.current = sourceIn
  currentTimeRef.current = currentTime
  isPlayingRef.current = isPlaying
  activeRef.current = active

  useEffect(() => {
    const media = mediaRef.current
    if (!media) return
    let cancelled = false

    const onReady = () => {
      if (cancelled) return
      syncMediaClock(
        media,
        startRef.current,
        sourceInRef.current,
        currentTimeRef.current,
        isPlayingRef.current,
        activeRef.current,
        rate,
      )
    }

    media.addEventListener('loadedmetadata', onReady)
    media.addEventListener('canplay', onReady)
    if (media.readyState >= HTMLMediaElement.HAVE_METADATA) onReady()

    return () => {
      cancelled = true
      media.removeEventListener('loadedmetadata', onReady)
      media.removeEventListener('canplay', onReady)
    }
  }, [src, rate, mediaType])

  useEffect(() => {
    const media = mediaRef.current
    if (!media) return
    media.volume = clipMuted ? 0 : Math.min(1, Math.max(0, Math.pow(10, volumeDb / 20)))
  }, [clipMuted, volumeDb])

  useEffect(() => {
    const media = mediaRef.current
    if (!media) return
    syncMediaClock(media, start, sourceIn, currentTime, isPlaying, active, rate)
  }, [currentTime, isPlaying, start, sourceIn, active, rate])

  return (
    <video
      ref={mediaRef}
      src={src}
      muted={muted}
      playsInline
      preload="auto"
      className="hidden"
    />
  )
}

function ClipInspector({ program, frameLabel }: { program: ProgramFrame; frameLabel: string }) {
  const clip = program.video?.clip ?? program.overlay?.clip ?? program.audio[0]?.clip
  return (
    <div className="chrome flex h-9 shrink-0 items-center gap-5 border-t border-line px-4 text-[11px]">
      <span className="w-28 truncate text-mute">{program.gap && !clip ? 'Gap' : programLabel(program)}</span>
      {clip && (
        <>
          <span className="font-mono text-dim">{formatRange(clip.start, clip.duration)}</span>
          <span className="text-dim">
            Start <span className="font-mono text-mute">{formatTimecode(clip.start)}</span>
          </span>
          <span className="text-dim">
            In <span className="font-mono text-mute">{formatTimecode(clip.sourceIn ?? 0)}</span>
          </span>
          <span className="text-dim">
            Dur <span className="font-mono text-mute">{formatTimecode(clip.duration)}</span>
          </span>
          {frameLabel && program.video && (
            <span className="text-dim">
              Frame <span className="font-mono text-mute">{frameLabel}</span>
            </span>
          )}
        </>
      )}
    </div>
  )
}
