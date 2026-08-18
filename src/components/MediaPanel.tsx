import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { Music2, Search, Trash2, Type } from 'lucide-react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { formatClock } from '../lib/time'
import { cn } from '../lib/cn'
import { fade, softSpring } from '../lib/motion'
import { ASSET_MIME, setDraggingAsset } from '../lib/edit'
import { searchProjectMedia, type MediaSearchHit } from '../lib/api'
import type { MediaAsset, MediaIndexState, MediaKind, ToolId } from '../types'

type BinTab = MediaKind | 'all' | 'image'

const tabs: { id: BinTab; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'video', label: 'Video' },
  { id: 'image', label: 'Stills' },
  { id: 'audio', label: 'Audio' },
]

const toolFilter: Partial<Record<ToolId, MediaKind | 'all'>> = {
  titles: 'title',
  audio: 'audio',
}

type Props = {
  width: number
  tool: ToolId
  projectId?: string | null
  assets: MediaAsset[]
  loading: boolean
  hasProject: boolean
  onDuration: (id: string, duration: number) => void
  onFrame?: (id: string, width: number, height: number) => void
  onAdd: (asset: MediaAsset) => void
  onDelete?: (asset: MediaAsset) => void
}

export function MediaPanel({ width, tool, projectId, assets, loading, hasProject, onDuration, onFrame, onAdd, onDelete }: Props) {
  const reduce = useReducedMotion()
  const [query, setQuery] = useState('')
  const [tab, setTab] = useState<BinTab>('all')
  const [previewId, setPreviewId] = useState<string | null>(null)
  const [hits, setHits] = useState<MediaSearchHit[]>([])
  const [searching, setSearching] = useState(false)

  const forced = toolFilter[tool]
  const resolvedTab = tabs.some((item) => item.id === tab) ? tab : 'all'
  const activeTab = forced ?? resolvedTab

  useEffect(() => {
    const needle = query.trim()
    if (!projectId || !needle) {
      setHits([])
      setSearching(false)
      return
    }
    let live = true
    const timer = window.setTimeout(() => {
      setSearching(true)
      void searchProjectMedia(projectId, needle)
        .then((results) => {
          if (live) setHits(results)
        })
        .catch(() => {
          if (live) setHits([])
        })
        .finally(() => {
          if (live) setSearching(false)
        })
    }, 250)
    return () => {
      live = false
      window.clearTimeout(timer)
    }
  }, [projectId, query])

  const hitByPath = useMemo(() => {
    const map = new Map<string, MediaSearchHit>()
    for (const hit of hits) {
      const path = hit.path?.trim()
      if (!path) continue
      const prev = map.get(path)
      if (!prev || (hit.score ?? 0) > (prev.score ?? 0)) map.set(path, hit)
    }
    return map
  }, [hits])

  const items = useMemo(() => {
    const needle = query.trim().toLowerCase()
    const filtered = assets.filter((asset) => {
      const matchesTab =
        activeTab === 'all' ||
        (activeTab === 'image' && asset.mediaType === 'image') ||
        (activeTab === 'video' && asset.kind === 'video' && asset.mediaType !== 'image') ||
        (activeTab !== 'image' && activeTab !== 'video' && asset.kind === activeTab)
      if (!matchesTab) return false
      if (!needle) return true
      const nameHit = asset.name.toLowerCase().includes(needle)
      const indexHit = Boolean(asset.path && hitByPath.has(asset.path))
      return nameHit || indexHit
    })
    if (!needle) return filtered
    return filtered.slice().sort((a, b) => {
      const scoreA = a.path ? hitByPath.get(a.path)?.score ?? -1 : -1
      const scoreB = b.path ? hitByPath.get(b.path)?.score ?? -1 : -1
      if (scoreA !== scoreB) return scoreB - scoreA
      return a.name.localeCompare(b.name)
    })
  }, [activeTab, assets, hitByPath, query])

  const heading =
    tool === 'titles'
      ? 'Titles'
      : tool === 'audio'
        ? 'Audio'
        : tool === 'effects'
          ? 'Effects'
          : tool === 'transitions'
            ? 'Transitions'
            : 'Media'

  return (
    <aside className="chrome flex h-full w-full shrink-0 flex-col border-r border-line bg-well" style={{ width }}>
      <div className="flex h-11 items-center justify-between px-3">
        <h2 className="text-[11px] font-medium tracking-[0.16em] text-mute uppercase">
          <AnimatePresence mode="wait" initial={false}>
            <motion.span
              key={heading}
              initial={reduce ? false : { opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={reduce ? undefined : { opacity: 0, y: -3 }}
              transition={fade}
              className="inline-block"
            >
              {heading}
            </motion.span>
          </AnimatePresence>
        </h2>
        <span className="font-mono text-[10px] text-dim">
          {tool === 'effects' || tool === 'transitions' ? 4 : items.length}
        </span>
      </div>

      {tool === 'effects' || tool === 'transitions' ? (
        <EmptyTool tool={tool} />
      ) : (
        <>
          <div className="px-3 pb-3">
            <label className="flex h-8 items-center gap-2 rounded-md border border-line bg-lift px-2.5">
              <Search size={13} className="text-dim" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search stills, shots, speech"
                className="w-full bg-transparent text-[12px] text-cream outline-none placeholder:text-dim"
              />
              {searching && <span className="shrink-0 text-[10px] text-dim">Searching</span>}
            </label>
          </div>

          {!forced && (
            <BinTabs
              value={resolvedTab}
              reduce={!!reduce}
              onChange={setTab}
            />
          )}

          <div className="grid grid-cols-1 content-start gap-3 overflow-y-auto px-3 pb-4 scroll-thin">
            {!loading && items.length === 0 && (
              <div className="rounded-lg border border-dashed border-line px-3 py-8 text-center text-[11px] leading-relaxed text-dim">
                {hasProject ? 'No matching media. Upload files or ask Director to generate a still.' : 'Create a project to start uploading media.'}
              </div>
            )}
            {loading && (
              <div className="px-2 py-8 text-center text-[11px] text-dim">Loading project media…</div>
            )}
            {items.map((asset, i) => (
              <motion.div
                key={asset.id}
                initial={reduce ? false : { opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ ...fade, delay: reduce ? 0 : i * 0.03 }}
                whileHover={reduce ? undefined : { y: -2 }}
              >
                <div
                  className="group relative"
                  onPointerEnter={() => {
                    if (asset.mediaType === 'video' && asset.src) setPreviewId(asset.id)
                  }}
                  onPointerLeave={() => {
                    setPreviewId((current) => (current === asset.id ? null : current))
                  }}
                >
                  <button
                    type="button"
                    draggable
                    onClick={() => onAdd(asset)}
                    onDragStart={(e) => {
                      setPreviewId(null)
                      setDraggingAsset(asset)
                      e.dataTransfer.setData(ASSET_MIME, JSON.stringify(asset))
                      e.dataTransfer.effectAllowed = 'copy'
                    }}
                    onDragEnd={() => setDraggingAsset(null)}
                    className="w-full cursor-grab text-left active:cursor-grabbing"
                  >
                    <div className="relative aspect-video overflow-hidden rounded-md border border-line bg-lift">
                      {asset.mediaType === 'video' && asset.src ? (
                        <HoverVideo
                          src={asset.src}
                          assetId={asset.id}
                          playing={previewId === asset.id}
                          onDuration={onDuration}
                          onFrame={onFrame}
                        />
                      ) : asset.thumb ? (
                        <img
                          src={asset.thumb}
                          alt=""
                          draggable={false}
                          onLoad={(event) => {
                            const el = event.currentTarget
                            if (el.naturalWidth > 0 && el.naturalHeight > 0) {
                              onFrame?.(asset.id, el.naturalWidth, el.naturalHeight)
                            }
                          }}
                          className="size-full object-contain transition-transform duration-500 group-hover:scale-[1.04]"
                        />
                      ) : (
                        <div className="flex size-full items-center justify-center text-dim">
                          {asset.kind === 'audio' ? <Music2 size={16} /> : <Type size={16} />}
                        </div>
                      )}
                      <span className="absolute top-1 left-1 rounded bg-black/70 px-1 text-[9px] text-plate/0 transition-colors group-hover:text-plate">
                        Add
                      </span>
                      <span className="absolute right-1 bottom-1 rounded bg-black/70 px-1 font-mono text-[9px] text-plate">
                        {formatClock(asset.duration)}
                      </span>
                      <IndexBadge state={asset.indexState} error={asset.indexError} progress={asset.indexProgress} />
                    </div>
                    <div className="mt-1.5 truncate text-[11px] text-mute transition-colors group-hover:text-cream">
                      {asset.name}
                    </div>
                    {asset.path && hitByPath.get(asset.path) && (
                      <div className="mt-0.5 line-clamp-2 text-[10px] leading-snug text-dim">
                        {searchSnippet(hitByPath.get(asset.path))}
                      </div>
                    )}
                  </button>
                  {onDelete && asset.path && (
                    <button
                      type="button"
                      aria-label={`Delete ${asset.name}`}
                      onClick={(event) => {
                        event.preventDefault()
                        event.stopPropagation()
                        onDelete(asset)
                      }}
                      className="absolute top-1 right-1 z-10 grid size-6 place-items-center rounded-md bg-black/70 text-plate/80 opacity-0 transition-opacity group-hover:opacity-100 hover:bg-mark hover:text-plate focus-visible:opacity-100"
                    >
                      <Trash2 size={11} />
                    </button>
                  )}
                </div>
              </motion.div>
            ))}
          </div>
        </>
      )}
    </aside>
  )
}

function searchSnippet(hit?: MediaSearchHit) {
  if (!hit) return ''
  const text = (hit.text_en || hit.spoken_en || '').replace(/\s+/g, ' ').trim()
  if (!text) {
    if (hit.kind === 'video_scene' && typeof hit.start === 'number') {
      return `Shot at ${formatClock(hit.start)}`
    }
    return hit.kind === 'transcript' ? 'Matched speech' : hit.kind === 'image' ? 'Matched still' : 'Matched'
  }
  return text
}

function BinTabs({
  value,
  reduce,
  onChange,
}: {
  value: BinTab
  reduce: boolean
  onChange: (id: BinTab) => void
}) {
  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return
    event.preventDefault()
    const index = tabs.findIndex((item) => item.id === value)
    const next = event.key === 'ArrowRight'
      ? (index + 1) % tabs.length
      : (index - 1 + tabs.length) % tabs.length
    onChange(tabs[next].id)
  }

  return (
    <div className="px-3 pb-3">
      <div
        role="tablist"
        aria-label="Filter bin"
        onKeyDown={onKeyDown}
        className="flex gap-3.5 border-b border-line"
      >
        {tabs.map((item) => {
          const selected = value === item.id
          return (
            <motion.button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={selected}
              tabIndex={selected ? 0 : -1}
              onClick={() => onChange(item.id)}
              whileTap={reduce ? undefined : { scale: 0.96 }}
              transition={softSpring}
              className={cn(
                'relative pb-2 text-[11px] font-medium transition-colors duration-200',
                selected ? 'text-cream' : 'text-dim hover:text-mute',
              )}
            >
              {item.label}
              {selected && (
                <motion.span
                  layoutId="bin-tab"
                  className="absolute inset-x-0 -bottom-px h-px bg-cream/80"
                  transition={reduce ? { duration: 0 } : softSpring}
                />
              )}
            </motion.button>
          )
        })}
      </div>
    </div>
  )
}

function HoverVideo({
  src,
  assetId,
  playing,
  onDuration,
  onFrame,
}: {
  src: string
  assetId: string
  playing: boolean
  onDuration: (id: string, duration: number) => void
  onFrame?: (id: string, width: number, height: number) => void
}) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const playingRef = useRef(playing)
  playingRef.current = playing

  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    if (playing) {
      video.muted = true
      video.defaultMuted = true
      video.loop = true
      video.playsInline = true
      const play = video.play()
      if (play) void play.catch(() => undefined)
      return
    }
    video.pause()
    if (video.readyState > 0) video.currentTime = 0
  }, [playing])

  useEffect(() => {
    const video = videoRef.current
    return () => {
      video?.pause()
    }
  }, [])

  return (
    <video
      ref={videoRef}
      key={src}
      src={src}
      muted
      loop
      playsInline
      preload="auto"
      disablePictureInPicture
      onLoadedMetadata={(event) => {
        const el = event.currentTarget
        const duration = el.duration
        if (Number.isFinite(duration) && duration > 0) onDuration(assetId, duration)
        if (el.videoWidth > 0 && el.videoHeight > 0) onFrame?.(assetId, el.videoWidth, el.videoHeight)
      }}
      onCanPlay={(event) => {
        if (!playingRef.current) return
        const play = event.currentTarget.play()
        if (play) void play.catch(() => undefined)
      }}
      className="pointer-events-none size-full object-contain"
    />
  )
}

function IndexBadge({ state, error, progress }: { state?: MediaIndexState; error?: string; progress?: string }) {
  if (!state || state === 'skipped') return null
  const busy = state === 'queued' || state === 'transcribing' || state === 'translating' || state === 'describing' || state === 'indexing'
  const label =
    state === 'queued' ? 'Queued'
      : state === 'transcribing' ? (progress || 'Transcribing')
        : state === 'translating' ? 'Translating'
          : state === 'describing' ? (progress || 'Describing')
            : state === 'indexing' ? 'Indexing'
              : state === 'index_failed' ? 'Index failed'
                : state === 'failed' ? 'Failed'
                  : ''
  const title =
    state === 'ready' ? 'Search ready'
      : state === 'failed' ? (error || 'Indexing failed')
        : state === 'index_failed' ? (error || 'Saved; search index failed')
          : state === 'describing' ? (progress ? `Describing ${progress}` : 'Describing')
            : progress && state === 'transcribing' ? `Transcribing ${progress}`
              : label
  return (
    <span
      title={title}
      className="absolute bottom-1 left-1 flex max-w-[70%] items-center gap-1 rounded bg-black/70 px-1 py-px text-[9px] leading-none text-plate"
    >
      <span
        className={cn(
          'size-1.5 shrink-0 rounded-full',
          busy && 'animate-pulse bg-live',
          state === 'ready' && 'bg-audio',
          state === 'index_failed' && 'bg-title',
          state === 'failed' && 'bg-mark',
        )}
      />
      {label ? <span className="truncate text-plate/90">{label}</span> : null}
    </span>
  )
}

const effectCards = ['Warm tungsten', 'Cool shadow', '16mm grain', 'Halation']
const cutCards = ['Hard cut', '8f dissolve', 'Smash', 'J-cut']

function EmptyTool({ tool }: { tool: ToolId }) {
  const reduce = useReducedMotion()
  const cards = tool === 'effects' ? effectCards : cutCards
  return (
    <div className="flex flex-1 flex-col gap-3 px-3 pt-1">
      <div className="grid grid-cols-2 gap-2">
        {cards.map((name, i) => (
          <motion.button
            key={name}
            type="button"
            initial={reduce ? false : { opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ ...fade, delay: reduce ? 0 : i * 0.04 }}
            whileHover={reduce ? undefined : { y: -1 }}
            whileTap={reduce ? undefined : { scale: 0.98 }}
            className="rounded-md border border-line bg-lift px-2.5 py-3 text-left text-[11px] text-mute transition-colors hover:border-line-strong hover:text-cream"
          >
            {name}
          </motion.button>
        ))}
      </div>
      <p className="px-0.5 text-[11px] leading-relaxed text-dim">
        Parked until the render graph is live. Director can still grade or recut from the chat.
      </p>
    </div>
  )
}
