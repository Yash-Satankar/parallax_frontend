import { useMemo } from 'react'
import { Film, MessageSquare, Plus, Sparkles } from 'lucide-react'
import { motion, useReducedMotion } from 'framer-motion'
import { formatClock } from '../lib/time'
import { cn } from '../lib/cn'
import { fade } from '../lib/motion'
import { ASSET_MIME, setDraggingAsset } from '../lib/edit'
import type { MediaAsset, SearchResult } from '../types'

type Props = {
  result: SearchResult
  query: string
  onAddToTimeline: (result: SearchResult) => void
}

export function SearchResultCard({ result, query, onAddToTimeline }: Props) {
  const reduce = useReducedMotion()

  const highlightedText = useMemo(() => {
    if (!query.trim()) return result.text
    const parts = query.trim().split(/\s+/).filter(Boolean)
    if (parts.length === 0) return result.text
    const pattern = new RegExp(`(${parts.map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'gi')
    const chunks = result.text.split(pattern)
    return chunks.map((chunk, i) =>
      pattern.test(chunk) ? (
        <mark key={i} className="rounded bg-amber-400/20 px-0.5 font-medium text-amber-200">
          {chunk}
        </mark>
      ) : (
        <span key={i}>{chunk}</span>
      ),
    )
  }, [result.text, query])

  const duration = Math.max(0.1, result.end_sec - result.start_sec)
  const scorePercent = Math.min(100, Math.round(result.relevance_score * 100))

  // Create a drag-compatible MediaAsset representation for the sub-clip
  const dragAsset: MediaAsset = {
    id: result.file_id,
    name: `${result.media_path.split('/').pop() || 'Clip'} (${formatClock(result.start_sec)})`,
    kind: result.kind === 'transcript' ? 'audio' : 'video',
    duration: duration,
    src: result.content_url,
    path: result.media_path,
    thumb: result.thumbnail_url,
  }

  return (
    <motion.div
      initial={reduce ? false : { opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      exit={reduce ? undefined : { opacity: 0, y: -3 }}
      transition={fade}
      className="group relative flex flex-col overflow-hidden rounded-lg border border-line bg-lift p-2.5 transition-all hover:border-line-strong hover:bg-wash-strong"
    >
      {/* Thumbnail + Timecode */}
      <div className="relative aspect-video w-full overflow-hidden rounded-md border border-line bg-black/40">
        {result.thumbnail_url ? (
          <img
            src={result.thumbnail_url}
            alt=""
            draggable={false}
            className="size-full object-cover transition-transform duration-300 group-hover:scale-105"
          />
        ) : result.kind === 'frame' ? (
          <div className="flex size-full flex-col items-center justify-center gap-1 text-dim">
            <Film size={20} />
            <span className="text-[9px]">Frame match</span>
          </div>
        ) : (
          <div className="flex size-full flex-col items-center justify-center gap-1 text-dim">
            <MessageSquare size={20} />
            <span className="text-[9px]">Spoken transcript</span>
          </div>
        )}

        {/* Kind badge */}
        <span className="absolute top-1.5 left-1.5 flex items-center gap-1 rounded bg-black/80 px-1.5 py-0.5 text-[9px] font-medium text-cream backdrop-blur-xs">
          {result.kind === 'frame' ? <Film size={10} className="text-sky-400" /> : <MessageSquare size={10} className="text-amber-400" />}
          <span className="capitalize">{result.kind}</span>
        </span>

        {/* Relevance score */}
        <span
          className={cn(
            'absolute top-1.5 right-1.5 flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[9px] font-medium backdrop-blur-xs',
            scorePercent >= 80 ? 'bg-emerald-500/80 text-white' : scorePercent >= 50 ? 'bg-amber-500/80 text-white' : 'bg-black/70 text-cream',
          )}
        >
          <Sparkles size={8} />
          {scorePercent}%
        </span>

        {/* Timecode badge */}
        <span className="absolute right-1.5 bottom-1.5 rounded bg-black/80 px-1.5 py-0.5 font-mono text-[9px] text-cream backdrop-blur-xs">
          {formatClock(result.start_sec)} – {formatClock(result.end_sec)}
        </span>
      </div>

      {/* Snippet / Description */}
      <div className="mt-2 text-[11px] leading-relaxed text-mute">
        <p className="line-clamp-2">{highlightedText}</p>
      </div>

      {/* File name */}
      <div className="mt-1 flex items-center justify-between text-[10px] text-dim">
        <span className="truncate max-w-[140px]">{result.media_path.split('/').pop()}</span>
        <span className="font-mono">{formatClock(duration)}</span>
      </div>

      {/* Action Button: Add to timeline */}
      <div className="mt-2.5 flex items-center gap-2">
        <button
          type="button"
          draggable
          onDragStart={(e) => {
            setDraggingAsset(dragAsset)
            e.dataTransfer.setData(ASSET_MIME, JSON.stringify(dragAsset))
            e.dataTransfer.effectAllowed = 'copy'
          }}
          onDragEnd={() => setDraggingAsset(null)}
          onClick={() => onAddToTimeline(result)}
          className="flex flex-1 cursor-grab items-center justify-center gap-1.5 rounded-md bg-wash px-2.5 py-1.5 text-[11px] font-medium text-cream transition-colors hover:bg-amber-500/20 hover:text-amber-200 active:cursor-grabbing"
        >
          <Plus size={12} />
          Add to timeline
        </button>
      </div>
    </motion.div>
  )
}
