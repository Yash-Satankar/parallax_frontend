import { useState } from 'react'
import { CornerDownRight } from 'lucide-react'
import { motion, useReducedMotion } from 'framer-motion'
import { fade } from '../lib/motion'
import type { Clip } from '../types'

type Props = {
  selectedClip?: Clip | null
  onRunAction: (prompt: string) => void
}

const RATIOS = ['16:9', '9:16', '4:5', '1:1', '4:3']

export function ReframeToolbar({ selectedClip, onRunAction }: Props) {
  const reduce = useReducedMotion()
  const [running, setRunning] = useState<string | null>(null)
  if (!selectedClip || selectedClip.kind !== 'video') return null

  const handle = async (ratio: string) => {
    setRunning(ratio)
    try {
      await onRunAction(`Reframe ${selectedClip.mediaPath || selectedClip.name} to ${ratio}`)
    } finally {
      setTimeout(() => setRunning(null), 800)
    }
  }

  return (
    <motion.div initial={reduce ? false : { opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={reduce ? undefined : { opacity: 0, y: -4 }} transition={fade} className="flex items-center gap-1.5 rounded-lg border border-line bg-well/95 px-2.5 py-1.5 shadow-lg backdrop-blur-md">
      <div className="flex items-center gap-1 border-r border-line pr-2 text-[10px] font-medium tracking-wide text-dim uppercase">
        <CornerDownRight size={12} className="text-amber-400" />
        <span>Reframe</span>
      </div>
      {RATIOS.map((r) => (
        <button key={r} disabled={running !== null} onClick={() => void handle(r)} className="rounded-md bg-lift px-2 py-1 text-[11px] font-medium text-cream hover:bg-wash-strong disabled:opacity-50">{r}</button>
      ))}
    </motion.div>
  )
}
