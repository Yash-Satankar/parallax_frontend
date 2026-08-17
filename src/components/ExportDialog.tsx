import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { motion, useReducedMotion } from 'framer-motion'
import type { Clip, MediaAsset } from '../types'
import type { ExportFormat, ExportQuality, ExportRequest, ExportResolution } from '../lib/api'
import { SEQUENCE_SOURCE } from '../lib/program'
import { fade } from '../lib/motion'
import { cn } from '../lib/cn'

import { exportAndDownload, type ExportFormat as ClientExportFormat, type ExportQuality as ClientExportQuality } from '../lib/webcodecs/exportPipeline'
import { detectGPUCapabilities } from '../lib/webgpu/capabilities'

type SourceOption = {
  id: string
  label: string
  path: string
  duration: number
}

type Props = {
  projectName: string
  assets: MediaAsset[]
  selected?: Clip
  playhead?: Clip
  sequenceDuration?: number
  hasSequence?: boolean
  busy: boolean
  onClose: () => void
  onExport: (body: ExportRequest) => void
  clips?: Clip[]
}

const formats: { id: ExportFormat; label: string; hint: string }[] = [
  { id: 'mp4', label: 'MP4', hint: 'H.264 · widely compatible' },
  { id: 'mov', label: 'MOV', hint: 'H.264 in QuickTime' },
  { id: 'webm', label: 'WebM', hint: 'VP9 for the web' },
  { id: 'gif', label: 'GIF', hint: 'Silent looped animation' },
  { id: 'mp3', label: 'MP3', hint: 'Audio only' },
]

const qualities: { id: ExportQuality; label: string }[] = [
  { id: 'draft', label: 'Draft' },
  { id: 'standard', label: 'Standard' },
  { id: 'high', label: 'High' },
  { id: 'original', label: 'Original' },
]

const resolutions: { id: ExportResolution; label: string }[] = [
  { id: 'source', label: 'Match source' },
  { id: '3840x2160', label: '4K · 3840×2160' },
  { id: '1920x1080', label: '1080p' },
  { id: '1280x720', label: '720p' },
  { id: '854x480', label: '480p' },
]

const rates = [
  { id: 0, label: 'Match source' },
  { id: 24, label: '24 fps' },
  { id: 25, label: '25 fps' },
  { id: 30, label: '30 fps' },
  { id: 60, label: '60 fps' },
]

export function ExportDialog({
  projectName,
  assets,
  selected,
  playhead,
  sequenceDuration = 0,
  hasSequence = false,
  busy,
  onClose,
  onExport,
  clips = [],
}: Props) {
  const reduce = useReducedMotion()
  const sources = useMemo(
    () => collectSources(assets, selected, playhead, hasSequence, sequenceDuration),
    [assets, selected, playhead, hasSequence, sequenceDuration],
  )
  const [sourceId, setSourceId] = useState(sources[0]?.id ?? '')
  const [format, setFormat] = useState<ExportFormat>('mp4')
  const [quality, setQuality] = useState<ExportQuality>('standard')
  const [resolution, setResolution] = useState<ExportResolution>('source')
  const [fps, setFps] = useState(0)
  const [audio, setAudio] = useState(true)
  const [rangeMode, setRangeMode] = useState<'full' | 'custom'>('full')
  const [start, setStart] = useState('0')
  const [duration, setDuration] = useState('')
  const [filename, setFilename] = useState(defaultFilename(projectName, sources[0]))
  const [engine, setEngine] = useState<'server' | 'client'>('server')
  const [clientProgress, setClientProgress] = useState<number | null>(null)
  const [clientError, setClientError] = useState<string | null>(null)
  const [hasWebCodecs, setHasWebCodecs] = useState(false)

  useEffect(() => {
    detectGPUCapabilities().then((c) => setHasWebCodecs(c.webcodecs)).catch(() => {})
  }, [])

  const source = sources.find((item) => item.id === sourceId) ?? sources[0]
  const videoLike = format !== 'mp3'
  const encodeLike = format !== 'mp3' && format !== 'gif'

  useEffect(() => {
    if (!sources.some((item) => item.id === sourceId) && sources[0]) {
      setSourceId(sources[0].id)
    }
  }, [sourceId, sources])

  async function submit() {
    if (!source) return
    const startSec = rangeMode === 'custom' ? Math.max(0, Number(start) || 0) : 0
    const durationSec = rangeMode === 'custom' ? Math.max(0, Number(duration) || 0) : 0
    const outName = filename.trim() || defaultFilename(projectName, source)

    if (engine === 'client' && (format === 'mp4' || format === 'webm') && clips.length > 0) {
      setClientProgress(0)
      setClientError(null)
      try {
        const assetMap = new Map<string, File>()
        for (const a of assets) {
          if (a.path) assetMap.set(a.path, a as unknown as File)
        }
        await exportAndDownload(
          clips,
          assetMap,
          {
            format: format as ClientExportFormat,
            quality: quality as ClientExportQuality,
            fps: fps || 30,
            width: resolution === '3840x2160' ? 3840 : resolution === '1280x720' ? 1280 : 1920,
            height: resolution === '3840x2160' ? 2160 : resolution === '1280x720' ? 720 : 1080,
            grade: {},
          },
          `${outName}.${format}`,
          (pct) => setClientProgress(pct),
        )
        setClientProgress(null)
        onClose()
      } catch (err) {
        setClientError(err instanceof Error ? err.message : String(err))
        setClientProgress(null)
      }
      return
    }

    onExport({
      source: source.path,
      format,
      quality: format === 'gif' ? 'standard' : quality,
      resolution: videoLike ? resolution : 'source',
      fps: format === 'gif' && fps === 0 ? 12 : fps,
      audio: format === 'mp3' ? true : format === 'gif' ? false : audio,
      start: startSec || undefined,
      duration: durationSec || undefined,
      filename: outName,
    })
  }

  return (
    <motion.div
      initial={reduce ? false : { opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={reduce ? undefined : { opacity: 0 }}
      className="absolute inset-0 z-[70] grid place-items-center bg-black/65 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="export-title"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget && !busy) onClose()
      }}
    >
      <motion.form
        initial={reduce ? false : { opacity: 0, y: 10, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={reduce ? undefined : { opacity: 0, y: 8, scale: 0.98 }}
        transition={fade}
        onSubmit={(event) => {
          event.preventDefault()
          submit()
        }}
        className="w-[440px] rounded-xl border border-line bg-panel p-5 shadow-2xl"
      >
        <h2 id="export-title" className="text-[16px] font-medium text-cream">Export</h2>
        <p className="mt-1 text-[12px] text-mute">
          {source?.path === SEQUENCE_SOURCE
            ? 'Renders the timeline — V1, V2, mixed A tracks, and gaps — the same way Program plays it.'
            : 'Render a file from this project and download it.'}
        </p>

        {sources.length === 0 ? (
          <div className="mt-5 rounded-lg border border-dashed border-line px-3 py-8 text-center text-[12px] text-dim">
            Add clips to the timeline or upload a file before exporting.
          </div>
        ) : (
          <div className="mt-5 space-y-3.5">
            <Field label="Source">
              <select
                value={source?.id ?? ''}
                onChange={(event) => {
                  const next = sources.find((item) => item.id === event.target.value)
                  setSourceId(event.target.value)
                  if (next) setFilename(defaultFilename(projectName, next))
                }}
                className={selectClass}
              >
                {sources.map((item) => (
                  <option key={item.id} value={item.id}>{item.label}</option>
                ))}
              </select>
            </Field>

            <Field label="Export Engine">
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setEngine('server')}
                  className={cn(
                    'flex flex-col items-start rounded-lg border p-2.5 text-left transition-colors',
                    engine === 'server'
                      ? 'border-line-strong bg-wash-strong text-cream'
                      : 'border-line text-mute hover:border-line-strong hover:text-cream',
                  )}
                >
                  <span className="text-[12px] font-medium">Server (FFmpeg)</span>
                  <span className="mt-0.5 text-[10px] text-dim">High compatibility & server rendering</span>
                </button>
                <button
                  type="button"
                  onClick={() => setEngine('client')}
                  disabled={!hasWebCodecs}
                  className={cn(
                    'flex flex-col items-start rounded-lg border p-2.5 text-left transition-colors disabled:opacity-30',
                    engine === 'client'
                      ? 'border-emerald-500/50 bg-emerald-500/10 text-emerald-300'
                      : 'border-line text-mute hover:border-line-strong hover:text-cream',
                  )}
                >
                  <span className="flex items-center gap-1 text-[12px] font-medium">
                    <span>Client (GPU)</span>
                    <span className="rounded bg-emerald-500/20 px-1 py-0.2 text-[8px] font-bold text-emerald-400 uppercase">Fast</span>
                  </span>
                  <span className="mt-0.5 text-[10px] text-dim">
                    {hasWebCodecs ? 'Hardware-accelerated on your GPU' : 'WebCodecs not supported in browser'}
                  </span>
                </button>
              </div>
            </Field>

            <div>
              <div className="text-[10px] tracking-[0.14em] text-dim uppercase">Format</div>
              <div className="mt-2 grid grid-cols-5 gap-1.5">
                {formats.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setFormat(item.id)}
                    className={cn(
                      'rounded-md border px-1 py-1.5 text-[11px]',
                      format === item.id
                        ? 'border-line-strong bg-wash-strong text-cream'
                        : 'border-line text-mute hover:border-line-strong hover:text-cream',
                    )}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
              <div className="mt-1.5 text-[11px] text-dim">{formats.find((item) => item.id === format)?.hint}</div>
            </div>

            {encodeLike && (
              <div className="grid grid-cols-2 gap-3">
                <Field label="Quality">
                  <select value={quality} onChange={(event) => setQuality(event.target.value as ExportQuality)} className={selectClass}>
                    {qualities.map((item) => (
                      <option key={item.id} value={item.id}>{item.label}</option>
                    ))}
                  </select>
                </Field>
                <Field label="Resolution">
                  <select value={resolution} onChange={(event) => setResolution(event.target.value as ExportResolution)} className={selectClass}>
                    {resolutions.map((item) => (
                      <option key={item.id} value={item.id}>{item.label}</option>
                    ))}
                  </select>
                </Field>
              </div>
            )}

            {videoLike && (
              <div className="grid grid-cols-2 gap-3">
                <Field label="Frame rate">
                  <select value={fps} onChange={(event) => setFps(Number(event.target.value))} className={selectClass}>
                    {rates.map((item) => (
                      <option key={item.id} value={item.id}>{item.label}</option>
                    ))}
                  </select>
                </Field>
                {format !== 'gif' ? (
                  <Field label="Audio">
                    <select value={audio ? 'on' : 'off'} onChange={(event) => setAudio(event.target.value === 'on')} className={selectClass}>
                      <option value="on">Include</option>
                      <option value="off">Mute</option>
                    </select>
                  </Field>
                ) : (
                  <Field label="Audio">
                    <div className="flex h-9 items-center rounded-lg border border-line bg-well px-3 text-[13px] text-dim">Silent</div>
                  </Field>
                )}
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <Field label="Range">
                <select value={rangeMode} onChange={(event) => setRangeMode(event.target.value as 'full' | 'custom')} className={selectClass}>
                  <option value="full">Entire source</option>
                  <option value="custom">Custom in / out</option>
                </select>
              </Field>
              <Field label="File name">
                <input
                  value={filename}
                  onChange={(event) => setFilename(event.target.value)}
                  maxLength={80}
                  className={selectClass}
                />
              </Field>
            </div>

            {rangeMode === 'custom' && (
              <div className="grid grid-cols-2 gap-3">
                <Field label="Start (sec)">
                  <input
                    value={start}
                    onChange={(event) => setStart(event.target.value)}
                    inputMode="decimal"
                    className={selectClass}
                  />
                </Field>
                <Field label="Duration (sec)">
                  <input
                    value={duration}
                    onChange={(event) => setDuration(event.target.value)}
                    inputMode="decimal"
                    placeholder={source ? String(Math.round(source.duration * 10) / 10) : ''}
                    className={selectClass}
                  />
                </Field>
              </div>
            )}
          </div>
        )}

        {clientError && (
          <div className="mt-3 rounded-lg border border-red-500/30 bg-red-500/10 p-2.5 text-[11px] text-red-300">
            {clientError}
          </div>
        )}

        {clientProgress !== null && (
          <div className="mt-4 space-y-1.5">
            <div className="flex justify-between text-[11px] text-cream">
              <span>Rendering on GPU (WebCodecs)…</span>
              <span>{Math.round(clientProgress * 100)}%</span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-wash-strong">
              <div
                className="h-full rounded-full bg-emerald-400 transition-all duration-150"
                style={{ width: `${clientProgress * 100}%` }}
              />
            </div>
          </div>
        )}

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            disabled={busy || clientProgress !== null}
            onClick={onClose}
            className="h-9 rounded-md px-3 text-[12px] text-mute hover:bg-wash hover:text-cream"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={!source || busy || clientProgress !== null}
            className="h-9 rounded-md bg-cream px-4 text-[12px] font-medium text-ink disabled:opacity-40"
          >
            {busy || clientProgress !== null ? 'Exporting…' : 'Export'}
          </button>
        </div>
      </motion.form>
    </motion.div>
  )
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block text-[10px] tracking-[0.14em] text-dim uppercase">
      {label}
      <div className="mt-1.5 normal-case tracking-normal">{children}</div>
    </label>
  )
}

const selectClass =
  'h-9 w-full rounded-lg border border-line bg-well px-3 text-[13px] text-cream outline-none focus:border-line-strong'

function collectSources(
  assets: MediaAsset[],
  selected: Clip | undefined,
  playhead: Clip | undefined,
  hasSequence: boolean,
  sequenceDuration: number,
): SourceOption[] {
  const out: SourceOption[] = []
  const seen = new Set<string>()
  const push = (id: string, label: string, path: string, duration: number) => {
    if (!path || seen.has(path)) return
    seen.add(path)
    out.push({ id, label, path, duration })
  }
  if (hasSequence) {
    push('sequence', 'Sequence · Program', SEQUENCE_SOURCE, sequenceDuration)
  }
  if (selected?.mediaPath && (selected.kind === 'video' || selected.kind === 'audio')) {
    push(`clip-${selected.id}`, `Selected · ${selected.name}`, selected.mediaPath, selected.duration)
  }
  if (playhead?.mediaPath && playhead.id !== selected?.id) {
    push(`playhead-${playhead.id}`, `Playhead · ${playhead.name}`, playhead.mediaPath, playhead.duration)
  }
  for (const asset of assets) {
    if (!asset.path || (asset.mediaType !== 'video' && asset.mediaType !== 'audio')) continue
    push(asset.id, asset.name, asset.path, asset.duration)
  }
  return out
}

function defaultFilename(projectName: string, source?: SourceOption) {
  const base = source?.path === SEQUENCE_SOURCE
    ? projectName || 'sequence'
    : source?.label.replace(/^(Selected|Playhead) · /, '') || projectName || 'export'
  return `${base} export`.replace(/\s+/g, ' ').trim()
}
