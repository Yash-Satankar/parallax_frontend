import { useState } from 'react'
import { Disc, Mic, Scissors, Sparkles, Volume2 } from 'lucide-react'
import { motion, useReducedMotion } from 'framer-motion'
import { fade } from '../lib/motion'
import type { Clip } from '../types'

type Props = {
  selectedClip?: Clip | null
  onRunAction: (prompt: string) => void
}

export function AudioToolbar({ selectedClip, onRunAction }: Props) {
  const reduce = useReducedMotion()
  const [runningAction, setRunningAction] = useState<string | null>(null)

  const isAudioOrVideo = selectedClip && (selectedClip.kind === 'audio' || selectedClip.kind === 'video' || selectedClip.mediaType === 'video' || selectedClip.mediaType === 'audio')
  const clipPath = selectedClip?.mediaPath || selectedClip?.name || ''

  const handleAction = async (actionId: string, prompt: string) => {
    setRunningAction(actionId)
    try {
      await onRunAction(prompt)
    } finally {
      setTimeout(() => setRunningAction(null), 1000)
    }
  }

  if (!isAudioOrVideo || !selectedClip) {
    return null
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
        <Mic size={12} className="text-amber-400" />
        <span>Audio Polish</span>
      </div>

      {/* Remove dead air */}
      <button
        type="button"
        disabled={runningAction !== null}
        onClick={() => handleAction('dead_air', `Remove the dead air and pauses from ${clipPath}`)}
        className="flex items-center gap-1 rounded-md bg-lift px-2 py-1 text-[11px] font-medium text-cream transition-colors hover:bg-wash-strong hover:text-amber-200 disabled:opacity-50"
        title="Automatically cut awkward pauses and silence"
      >
        <Scissors size={11} className="text-amber-400" />
        <span>Cut Dead Air</span>
      </button>

      {/* Noise reduction */}
      <button
        type="button"
        disabled={runningAction !== null}
        onClick={() => handleAction('cleanup', `Clean up the background noise on ${clipPath}`)}
        className="flex items-center gap-1 rounded-md bg-lift px-2 py-1 text-[11px] font-medium text-cream transition-colors hover:bg-wash-strong hover:text-sky-200 disabled:opacity-50"
        title="Reduce hiss, hum, and background noise via FFT denoiser"
      >
        <Disc size={11} className="text-sky-400" />
        <span>Clean Noise</span>
      </button>

      {/* Volume Leveling */}
      <button
        type="button"
        disabled={runningAction !== null}
        onClick={() => handleAction('normalize', `Normalize loudness of ${clipPath} to -14 LUFS`)}
        className="flex items-center gap-1 rounded-md bg-lift px-2 py-1 text-[11px] font-medium text-cream transition-colors hover:bg-wash-strong hover:text-emerald-200 disabled:opacity-50"
        title="EBU R128 standard loudness leveling (-14 LUFS)"
      >
        <Volume2 size={11} className="text-emerald-400" />
        <span>Level Volume</span>
      </button>

      {/* All-in-one Polish */}
      <button
        type="button"
        disabled={runningAction !== null}
        onClick={() => handleAction('polish_all', `Run full audio polish suite on ${clipPath}: noise cleanup, remove dead air, and loudness normalize`)}
        className="flex items-center gap-1 rounded-md bg-amber-500/20 px-2 py-1 text-[11px] font-medium text-amber-200 transition-colors hover:bg-amber-500/30 disabled:opacity-50"
        title="Execute all polish steps: denoise → cut silence → normalize loudness"
      >
        <Sparkles size={11} />
        <span>Full Polish</span>
      </button>
    </motion.div>
  )
}
