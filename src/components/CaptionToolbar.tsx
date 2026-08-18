import { useState } from 'react'
import { Subscript, AlignCenter, Type, Italic } from 'lucide-react'
import { motion, useReducedMotion } from 'framer-motion'
import { fade } from '../lib/motion'
import type { Clip } from '../types'

type Props = {
  selectedClip?: Clip | null
  onRunAction: (prompt: string) => void
}

export function CaptionToolbar({ selectedClip, onRunAction }: Props) {
  const reduce = useReducedMotion()
  const [running, setRunning] = useState<string | null>(null)

  if (!selectedClip || !(selectedClip.kind === 'video' || selectedClip.kind === 'audio')) return null

  const clipPath = selectedClip.mediaPath || selectedClip.name || ''

  const handleApply = async (style: string) => {
    setRunning(style)
    try {
      await onRunAction(`Generate animated captions in the ${style} style for ${clipPath}`)
    } finally {
      setTimeout(() => setRunning(null), 800)
    }
  }

  return (
    <motion.div
      initial={reduce ? false : { opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      exit={reduce ? undefined : { opacity: 0, y: -4 }}
      transition={fade}
      className="flex items-center gap-1.5 rounded-lg border border-line bg-well/95 px-2.5 py-1.5 shadow-lg backdrop-blur-md"
    >
      <div className="flex items-center gap-1 border-r border-line pr-2 text-[10px] font-medium tracking-wide text-dim uppercase">
        <Type size={12} className="text-amber-400" />
        <span>Captions</span>
      </div>

      <button disabled={running !== null} onClick={() => void handleApply('subtitle')} className="flex items-center gap-1 rounded-md bg-lift px-2 py-1 text-[11px] font-medium text-cream transition-colors hover:bg-wash-strong disabled:opacity-50">
        <AlignCenter size={12} />
        <span>Subtitle</span>
      </button>

      <button disabled={running !== null} onClick={() => void handleApply('stacked')} className="flex items-center gap-1 rounded-md bg-lift px-2 py-1 text-[11px] font-medium text-cream transition-colors hover:bg-wash-strong disabled:opacity-50">
        <Subscript size={12} />
        <span>Stacked</span>
      </button>

      <button disabled={running !== null} onClick={() => void handleApply('minimal')} className="flex items-center gap-1 rounded-md bg-lift px-2 py-1 text-[11px] font-medium text-cream transition-colors hover:bg-wash-strong disabled:opacity-50">
        <Italic size={12} />
        <span>Minimal</span>
      </button>

      <button disabled={running !== null} onClick={() => void handleApply('serif')} className="flex items-center gap-1 rounded-md bg-lift px-2 py-1 text-[11px] font-medium text-cream transition-colors hover:bg-wash-strong disabled:opacity-50">
        <AlignCenter size={12} />
        <span>Serif</span>
      </button>
    </motion.div>
  )
}
