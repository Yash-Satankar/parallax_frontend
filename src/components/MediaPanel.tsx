import { useMemo, useState } from 'react'
import { Film, MessageSquare, Music2, Search, Sparkles, Trash2, Type, X } from 'lucide-react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { formatClock } from '../lib/time'
import { cn } from '../lib/cn'
import { fade } from '../lib/motion'
import { ASSET_MIME, setDraggingAsset } from '../lib/edit'
import { useFootageSearch } from '../lib/useFootageSearch'
import { SearchResultCard } from './SearchResultCard'
import type { MediaAsset, MediaKind, SearchResult, ToolId } from '../types'

const tabs: { id: MediaKind | 'all'; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'video', label: 'Video' },
  { id: 'audio', label: 'Audio' },
  { id: 'title', label: 'Titles' },
]

const toolFilter: Partial<Record<ToolId, MediaKind | 'all'>> = {
  media: 'all',
  titles: 'title',
  audio: 'audio',
}

type Props = {
  width: number
  tool: ToolId
  assets: MediaAsset[]
  loading: boolean
  hasProject: boolean
  projectId?: string | null
  onDuration: (id: string, duration: number) => void
  onFrame?: (id: string, width: number, height: number) => void
  onAdd: (asset: MediaAsset) => void
  onAddSearchResult?: (result: SearchResult) => void
  onDelete?: (asset: MediaAsset) => void
}

export function MediaPanel({
  width,
  tool,
  assets,
  loading,
  hasProject,
  projectId = null,
  onDuration,
  onFrame,
  onAdd,
  onAddSearchResult,
  onDelete,
}: Props) {
  const reduce = useReducedMotion()
  const [query, setQuery] = useState('')
  const [tab, setTab] = useState<MediaKind | 'all'>('all')
  const [searchKind, setSearchKind] = useState<'all' | 'frame' | 'transcript'>('all')

  const forced = toolFilter[tool]
  const activeTab = forced ?? tab

  // Semantic footage search hook
  const { results: searchResults, loading: searchLoading, totalIndexed } = useFootageSearch({
    projectId,
    query,
    kind: searchKind,
  })

  const isSearching = query.trim().length >= 2

  const items = useMemo(() => {
    return assets.filter((asset) => {
      const matchesTab = activeTab === 'all' || asset.kind === activeTab
      const matchesQuery = asset.name.toLowerCase().includes(query.toLowerCase())
      return matchesTab && matchesQuery
    })
  }, [activeTab, query, assets])

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

  const handleAddSearchClip = (res: SearchResult) => {
    if (onAddSearchResult) {
      onAddSearchResult(res)
      return
    }
    // Fallback: create asset from result
    const duration = Math.max(0.1, res.end_sec - res.start_sec)
    onAdd({
      id: res.file_id,
      name: `${res.media_path.split('/').pop() || 'Clip'} (${formatClock(res.start_sec)})`,
      kind: res.kind === 'transcript' ? 'audio' : 'video',
      duration: duration,
      src: res.content_url,
      path: res.media_path,
      thumb: res.thumbnail_url,
    })
  }

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
        <div className="flex items-center gap-1.5 font-mono text-[10px] text-dim">
          {isSearching ? (
            <span className="flex items-center gap-1 text-amber-300">
              <Sparkles size={10} />
              {searchResults.length} {searchResults.length === 1 ? 'match' : 'matches'}
            </span>
          ) : (
            <span>{tool === 'effects' || tool === 'transitions' ? 4 : items.length}</span>
          )}
        </div>
      </div>

      {tool === 'effects' || tool === 'transitions' ? (
        <EmptyTool tool={tool} />
      ) : (
        <>
          {/* Search bar */}
          <div className="px-3 pb-2.5">
            <label className="relative flex h-8 items-center gap-2 rounded-md border border-line bg-lift px-2.5 transition-colors focus-within:border-line-strong focus-within:bg-wash-strong">
              <Search size={13} className={cn('shrink-0 transition-colors', isSearching ? 'text-amber-400' : 'text-dim')} />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search footage, quotes, scenes…"
                className="w-full bg-transparent text-[12px] text-cream outline-none placeholder:text-dim"
              />
              {query && (
                <button
                  type="button"
                  onClick={() => setQuery('')}
                  className="grid size-4 place-items-center rounded text-dim hover:text-cream"
                >
                  <X size={11} />
                </button>
              )}
            </label>
          </div>

          {/* Search mode filters (when search active) vs Category tabs (when browsing bin) */}
          {isSearching ? (
            <div className="flex items-center justify-between px-3 pb-2.5">
              <div className="flex gap-1">
                {(['all', 'frame', 'transcript'] as const).map((k) => (
                  <button
                    key={k}
                    type="button"
                    onClick={() => setSearchKind(k)}
                    className={cn(
                      'flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium tracking-wide uppercase transition-colors',
                      searchKind === k ? 'bg-amber-400/20 text-amber-200' : 'text-dim hover:text-mute',
                    )}
                  >
                    {k === 'frame' ? <Film size={9} /> : k === 'transcript' ? <MessageSquare size={9} /> : null}
                    {k === 'all' ? 'All' : k === 'frame' ? 'Visual' : 'Quotes'}
                  </button>
                ))}
              </div>
              {totalIndexed > 0 && (
                <span className="text-[9px] text-dim">{totalIndexed} indexed</span>
              )}
            </div>
          ) : (
            !forced && (
              <div className="flex gap-1 px-3 pb-3">
                {tabs.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setTab(t.id)}
                    className={cn(
                      'rounded-full px-2 py-0.5 text-[10px] font-medium tracking-wide uppercase',
                      tab === t.id ? 'bg-wash-strong text-cream' : 'text-dim hover:text-mute',
                    )}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            )
          )}

          {/* Search Results View */}
          {isSearching ? (
            <div className="flex flex-1 flex-col gap-2 overflow-y-auto px-3 pb-4 scroll-thin">
              {searchLoading && (
                <div className="flex flex-col items-center justify-center gap-2 py-8 text-dim">
                  <div className="size-4 animate-spin rounded-full border border-amber-400/30 border-t-amber-400" />
                  <span className="text-[11px]">Searching footage & transcripts…</span>
                </div>
              )}

              {!searchLoading && searchResults.length === 0 && (
                <div className="rounded-lg border border-dashed border-line px-3 py-8 text-center text-[11px] leading-relaxed text-dim">
                  No matching moments found for &quot;{query}&quot;.
                  <br />
                  <span className="text-[10px] text-dim/70">
                    Try different keywords, quotes, or describe actions/objects.
                  </span>
                </div>
              )}

              {!searchLoading &&
                searchResults.map((res) => (
                  <SearchResultCard
                    key={`${res.file_id}-${res.start_sec}`}
                    result={res}
                    query={query}
                    onAddToTimeline={handleAddSearchClip}
                  />
                ))}
            </div>
          ) : (
            /* Normal Media Bin View */
            <div className="grid grid-cols-2 content-start gap-2 overflow-y-auto px-3 pb-4 scroll-thin">
              {!loading && items.length === 0 && (
                <div className="col-span-2 rounded-lg border border-dashed border-line px-3 py-8 text-center text-[11px] leading-relaxed text-dim">
                  {hasProject
                    ? 'No matching media. Upload files to this project.'
                    : 'Create a project to start uploading media.'}
                </div>
              )}
              {loading && (
                <div className="col-span-2 px-2 py-8 text-center text-[11px] text-dim">
                  Loading project media…
                </div>
              )}
              {items.map((asset, i) => (
                <motion.div
                  key={asset.id}
                  initial={reduce ? false : { opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ ...fade, delay: reduce ? 0 : i * 0.03 }}
                  whileHover={reduce ? undefined : { y: -2 }}
                >
                  <div className="group relative">
                    <button
                      type="button"
                      draggable
                      onClick={() => onAdd(asset)}
                      onDragStart={(e) => {
                        setDraggingAsset(asset)
                        e.dataTransfer.setData(ASSET_MIME, JSON.stringify(asset))
                        e.dataTransfer.effectAllowed = 'copy'
                      }}
                      onDragEnd={() => setDraggingAsset(null)}
                      className="w-full cursor-grab text-left active:cursor-grabbing"
                    >
                      <div className="relative aspect-video overflow-hidden rounded-md border border-line bg-lift">
                        {asset.mediaType === 'video' && asset.src ? (
                          <video
                            key={asset.src}
                            src={asset.src}
                            muted
                            preload="metadata"
                            onLoadedMetadata={(event) => {
                              const el = event.currentTarget
                              const duration = el.duration
                              if (Number.isFinite(duration) && duration > 0)
                                onDuration(asset.id, duration)
                              if (el.videoWidth > 0 && el.videoHeight > 0)
                                onFrame?.(asset.id, el.videoWidth, el.videoHeight)
                            }}
                            className="size-full object-contain transition-transform duration-500 group-hover:scale-[1.04]"
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
                      </div>
                      <div className="mt-1.5 truncate pr-6 text-[11px] text-mute transition-colors group-hover:text-cream">
                        {asset.name}
                      </div>
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
          )}
        </>
      )}
    </aside>
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
