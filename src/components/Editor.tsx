import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { AnimatePresence, LayoutGroup, motion, useReducedMotion } from 'framer-motion'
import type { ChatMessage, Clip, DirectorActivity, Grade, MediaAsset, ToolId } from '../types'
import {
  PROJECT_FPS,
} from '../data/project'
import { programAtTime, sequenceAudioClips } from '../lib/program'
import {
  clipContainsTime,
  clipsFromAsset,
  commitMove,
  commitTrim,
  linkedClips,
  linkedIds,
  placeClips,
  removeClips,
  sequenceDuration,
  splitClipsAtTime,
  unlinkClips,
  type EditMode,
} from '../lib/edit'
import {
  applySourceDuration,
  buildTimelineDocument,
  clampClip,
  clipsFromDocument,
  emptyTimelineDocument,
  findClipAsset,
  hydrateClip,
  snapTime,
  timelineFingerprint,
} from '../lib/timeline'
import {
  createProject as createRemoteProject,
  createProjectChat,
  deleteProjectChat,
  deleteProjectMedia,
  downloadProjectFile,
  exportProjectMedia,
  getProjectChat,
  getProjectTimeline,
  getProjectHistory,
  undoProject,
  redoProject,
  restoreProjectRevision,
  createProjectCheckpoint,
  getSettings,
  listProjectChats,
  listProjectMedia,
  listProjects,
  mediaURL,
  normalizeSettings,
  normalizeThinkingEffort,
  putProjectTimeline,
  putSettings,
  streamAgent,
  uploadProjectMedia,
  type ChatRecord,
  type AgentEvent,
  type LLMSettings,
  type ThinkingEffort,
  type ProjectMedia,
  type ProjectRecord,
  type ProjectHistory,
  type ExportRequest,
  type SavedChatMessage,
  type TimelineTransition,
} from '../lib/api'
import { TopBar } from './TopBar'
import { ToolRail } from './ToolRail'
import { MediaPanel } from './MediaPanel'
import { PreviewStage } from './PreviewStage'
import { Timeline } from './Timeline'
import { ChatPanel, ChatRail } from './ChatPanel'
import { ExportDialog } from './ExportDialog'
import { HistoryPanel } from './HistoryPanel'
import { fade, panelTransition } from '../lib/motion'
import { cn } from '../lib/cn'
import { useCollab } from '../lib/useCollab'

export function Editor() {
  const reduce = useReducedMotion()
  const [tool, setTool] = useState<ToolId>('media')
  const [panelOpen, setPanelOpen] = useState(true)
  const [chatOpen, setChatOpen] = useState(true)
  const [mediaWidth, setMediaWidth] = useState(() => readNumberPref('parallax.mediaWidth', 268, 220, 420))
  const [chatWidth, setChatWidth] = useState(() => readNumberPref('parallax.chatWidth', 360, 300, 520))
  const [currentTime, setCurrentTime] = useState(0)
  const [isPlaying, setIsPlaying] = useState(false)
  const [muted, setMuted] = useState(false)
  const [safeArea, setSafeArea] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [clips, setClips] = useState<Clip[]>([])
  const [pxPerSecond, setPxPerSecond] = useState(24)
  const [snapEnabled, setSnapEnabled] = useState(() => readPref('parallax.snap', '1') !== '0')
  const [editMode, setEditMode] = useState<EditMode>(() => (
    readPref('parallax.editMode', 'overwrite') === 'ripple' ? 'ripple' : 'overwrite'
  ))
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [activity, setActivity] = useState<DirectorActivity[]>([])
  const [activityStartedAt, setActivityStartedAt] = useState<number | null>(null)
  const activityRef = useRef<DirectorActivity[]>([])
  const [draft, setDraft] = useState('')
  const [pending, setPending] = useState(false)
  const [grade] = useState<Grade>({ warmth: 0, contrast: 0.15, saturation: 0.1 })
  const [toast, setToast] = useState<string | null>(null)
  const [projects, setProjects] = useState<ProjectRecord[]>([])
  const [projectId, setProjectId] = useState('')
  const [assets, setAssets] = useState<MediaAsset[]>([])
  const [mediaLoading, setMediaLoading] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [sessionId, setSessionId] = useState('')
  const [chats, setChats] = useState<ChatRecord[]>([])
  const [createOpen, setCreateOpen] = useState(false)
  const [exportOpen, setExportOpen] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [settings, setSettings] = useState<LLMSettings | null>(null)
  const [thinkingEffort, setThinkingEffort] = useState<ThinkingEffort>(() => (
    normalizeThinkingEffort(readPref('parallax.thinkingEffort', 'medium'))
  ))
  const settingsRef = useRef(settings)
  settingsRef.current = settings
  useEffect(() => {
    activityRef.current = activity
  }, [activity])
  const [projectNameDraft, setProjectNameDraft] = useState('')
  const [creatingProject, setCreatingProject] = useState(false)
  const [history, setHistory] = useState<ProjectHistory | null>(null)
  const [historyLoading, setHistoryLoading] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)
  const resizeRef = useRef<{ side: 'media' | 'chat'; startX: number; startWidth: number } | null>(null)
  const [resizing, setResizing] = useState<'media' | 'chat' | null>(null)

  useEffect(() => {
    function onPointerMove(event: globalThis.PointerEvent) {
      const active = resizeRef.current
      if (!active) return
      const delta = event.clientX - active.startX
      const next = active.side === 'media'
        ? clampNumber(active.startWidth + delta, 220, 420)
        : clampNumber(active.startWidth - delta, 300, 520)
      if (active.side === 'media') setMediaWidth(next)
      else setChatWidth(next)
    }

    function onPointerUp(event: globalThis.PointerEvent) {
      const active = resizeRef.current
      if (!active) return
      const delta = event.clientX - active.startX
      const next = active.side === 'media'
        ? clampNumber(active.startWidth + delta, 220, 420)
        : clampNumber(active.startWidth - delta, 300, 520)
      writePref(active.side === 'media' ? 'parallax.mediaWidth' : 'parallax.chatWidth', String(next))
      resizeRef.current = null
      setResizing(null)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }

    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', onPointerUp)
    return () => {
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', onPointerUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
  }, [])

  function startResize(side: 'media' | 'chat', event: ReactPointerEvent<HTMLDivElement>) {
    event.preventDefault()
    resizeRef.current = {
      side,
      startX: event.clientX,
      startWidth: side === 'media' ? mediaWidth : chatWidth,
    }
    setResizing(side)
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
  }

  function nudgeResize(side: 'media' | 'chat', direction: -1 | 1) {
    const next = side === 'media'
      ? clampNumber(mediaWidth + direction * 16, 220, 420)
      : clampNumber(chatWidth - direction * 16, 300, 520)
    if (side === 'media') {
      setMediaWidth(next)
      writePref('parallax.mediaWidth', String(next))
    } else {
      setChatWidth(next)
      writePref('parallax.chatWidth', String(next))
    }
  }

  const duration = useMemo(() => sequenceDuration(clips, assets), [clips, assets])
  const durationRef = useRef(duration)
  durationRef.current = duration
  const selectedIdRef = useRef(selectedId)
  selectedIdRef.current = selectedId
  const clipsRef = useRef(clips)
  clipsRef.current = clips
  const assetsRef = useRef(assets)
  assetsRef.current = assets
  const projectIdRef = useRef(projectId)
  projectIdRef.current = projectId
  const pxPerSecondRef = useRef(pxPerSecond)
  pxPerSecondRef.current = pxPerSecond
  const currentTimeRef = useRef(currentTime)
  currentTimeRef.current = currentTime
  const revisionRef = useRef(0)
  const timelineMetaRef = useRef<{ canvas: { width: number; height: number }; transitions: TimelineTransition[] }>({ canvas: { width: 1920, height: 1080 }, transitions: [] })
  const lastSavedRef = useRef('')
  const timelineReadyRef = useRef(false)
  const saveTimerRef = useRef(0)
  const saveGenRef = useRef(0)
  const savingRef = useRef(false)
  const dirtyRef = useRef(false)
  const editModeRef = useRef(editMode)
  const undoLastRef = useRef<() => Promise<void>>(async () => undefined)
  const redoLastRef = useRef<(target?: number) => Promise<void>>(async () => undefined)
  editModeRef.current = editMode
  const editSessionRef = useRef<{
    type: 'move' | 'trim'
    ids: Set<string>
    originStart: number
    originDuration: number
  } | null>(null)

  const collab = useCollab(projectId, {
    onClipInsert: (newClip) => {
      setClips((current) => {
        if (current.some((c) => c.id === newClip.id)) return current
        return [...current, newClip]
      })
    },
    onClipDelete: (clipId) => {
      setClips((current) => current.filter((c) => c.id !== clipId))
      setSelectedId((current) => (current === clipId ? null : current))
    },
    onClipFieldUpdate: (clipId, fields) => {
      setClips((current) =>
        current.map((clip) => {
          if (clip.id !== clipId) return clip
          return { ...clip, ...fields }
        }),
      )
    },
    onRemoteSync: () => {
      if (projectId) {
        void refreshHistory(projectId)
      }
    },
  })

  useEffect(() => {
    collab.sendPresence(Math.round(currentTime * PROJECT_FPS), selectedId)
  }, [currentTime, selectedId, collab])


  const refreshMedia = useCallback(async (id: string) => {
    setMediaLoading(true)
    try {
      const items = await listProjectMedia(id)
      if (projectIdRef.current !== id) return
      const previous = new Map(
        assetsRef.current.filter((asset) => asset.path).map((asset) => [asset.path as string, asset]),
      )
      const next = items.map((item) => {
        const asset = toMediaAsset(item)
        if (asset.duration > 0 || !asset.path) return asset
        const known = previous.get(asset.path)
        return known?.duration ? { ...asset, duration: known.duration } : asset
      })
      setAssets(next)
      setClips((current) => syncClipMedia(current, next))
      return next
    } catch (error) {
      setToast(errorMessage(error))
      return undefined
    } finally {
      setMediaLoading(false)
    }
  }, [])

  const refreshHistory = useCallback(async (id: string) => {
    setHistoryLoading(true)
    try {
      const next = await getProjectHistory(id)
      if (projectIdRef.current === id) setHistory(next)
    } catch (error) {
      if (projectIdRef.current === id) setToast(errorMessage(error))
    } finally {
      if (projectIdRef.current === id) setHistoryLoading(false)
    }
  }, [])

  const loadChats = useCallback(async (id: string, preferredId?: string) => {
    let items = await listProjectChats(id)
    if (items.length === 0) {
      items = [await createProjectChat(id, '')]
    }
    const wanted = preferredId || readActiveChat(id)
    const active = items.find((chat) => chat.id === wanted) ?? items[0]
    setChats(items)
    setSessionId(active.id)
    writeActiveChat(id, active.id)
    const detail = await getProjectChat(id, active.id)
    setMessages(toUiMessages(detail.messages))
  }, [])

  const flushTimeline = useCallback(async (opts?: { keepalive?: boolean }) => {
    if (!timelineReadyRef.current) return
    const id = projectIdRef.current
    if (!id) return
    window.clearTimeout(saveTimerRef.current)
    const doc = buildTimelineDocument({
      clips: clipsRef.current,
      fps: PROJECT_FPS,
      revision: revisionRef.current,
      playhead: currentTimeRef.current,
      selectedId: selectedIdRef.current,
      pxPerSecond: pxPerSecondRef.current,
      canvas: timelineMetaRef.current.canvas,
      transitions: timelineMetaRef.current.transitions,
    })
    const fingerprint = timelineFingerprint(doc)
    if (fingerprint === lastSavedRef.current) {
      dirtyRef.current = false
      return
    }
    dirtyRef.current = false
    const gen = saveGenRef.current
    savingRef.current = true
    setSaveStatus('saving')
    try {
      const saved = await putProjectTimeline(id, doc, { ...opts, expectedRevision: revisionRef.current })
      if (gen !== saveGenRef.current || projectIdRef.current !== id) return
      revisionRef.current = saved.revision
      lastSavedRef.current = fingerprint
      setSaveStatus('saved')
      void refreshHistory(id)
    } catch (error) {
      if (gen !== saveGenRef.current || projectIdRef.current !== id) return
      dirtyRef.current = true
      setSaveStatus('error')
      if (!opts?.keepalive) setToast(errorMessage(error))
    } finally {
      if (gen === saveGenRef.current) savingRef.current = false
    }
  }, [refreshHistory])

  const scheduleSave = useCallback(() => {
    if (!timelineReadyRef.current || !projectIdRef.current) return
    dirtyRef.current = true
    setSaveStatus((status) => (status === 'saving' ? status : 'idle'))
    window.clearTimeout(saveTimerRef.current)
    saveTimerRef.current = window.setTimeout(() => {
      void flushTimeline()
    }, 400)
  }, [flushTimeline])

  const loadTimeline = useCallback(async (id: string, assets: MediaAsset[]) => {
    const timeline = await getProjectTimeline(id)
    if (projectIdRef.current !== id) return
    const nextClips = clipsFromDocument({
      ...emptyTimelineDocument(),
      ...timeline,
      clips: timeline.clips ?? [],
    }, assets)
    const fps = timeline.fps > 0 ? timeline.fps : PROJECT_FPS
    const playhead = Math.max(0, (timeline.playhead_frame ?? 0) / fps)
    const selected = timeline.selected_id && nextClips.some((clip) => clip.id === timeline.selected_id)
      ? timeline.selected_id
      : null
    const zoom = timeline.px_per_second && timeline.px_per_second >= 18 && timeline.px_per_second <= 72
      ? timeline.px_per_second
      : pxPerSecondRef.current
    setClips(nextClips)
    setSelectedId(selected)
    setCurrentTime(playhead)
    setPxPerSecond(zoom)
    timelineMetaRef.current = { canvas: timeline.canvas ?? { width: 1920, height: 1080 }, transitions: timeline.transitions ?? [] }
    revisionRef.current = timeline.revision ?? 0
    lastSavedRef.current = timelineFingerprint(buildTimelineDocument({
      clips: nextClips,
      fps: PROJECT_FPS,
      revision: timeline.revision ?? 0,
      playhead,
      selectedId: selected,
      pxPerSecond: zoom,
      canvas: timelineMetaRef.current.canvas,
      transitions: timelineMetaRef.current.transitions,
    }))
    timelineReadyRef.current = true
    setSaveStatus(nextClips.length ? 'saved' : 'idle')
  }, [])

  const bootProject = useCallback(async (id: string) => {
    projectIdRef.current = id
    setProjectId(id)
    timelineReadyRef.current = false
    lastSavedRef.current = ''
    revisionRef.current = 0
    setSaveStatus('idle')
    setClips([])
    setSelectedId(null)
    setCurrentTime(0)
    setMediaLoading(true)
    try {
      const items = await listProjectMedia(id)
      if (projectIdRef.current !== id) return
      const previous = new Map(
        assetsRef.current.filter((asset) => asset.path).map((asset) => [asset.path as string, asset]),
      )
      const next = items.map((item) => {
        const asset = toMediaAsset(item)
        if (asset.duration > 0 || !asset.path) return asset
        const known = previous.get(asset.path)
        return known?.duration ? { ...asset, duration: known.duration } : asset
      })
      setAssets(next)
      await loadTimeline(id, next)
      await refreshHistory(id)
    } catch (error) {
      if (projectIdRef.current === id) {
        setToast(errorMessage(error))
        timelineReadyRef.current = false
      }
    } finally {
      if (projectIdRef.current === id) setMediaLoading(false)
    }
  }, [loadTimeline, refreshHistory])

  useEffect(() => {
    let live = true
    listProjects()
      .then(async (items) => {
        if (!live) return
        setProjects(items)
        if (!items[0]) return
        await bootProject(items[0].id)
        if (!live) return
        try {
          await loadChats(items[0].id)
        } catch (error) {
          if (live) setToast(errorMessage(error))
        }
      })
      .catch((error) => {
        if (live) setToast(`Backend unavailable: ${errorMessage(error)}`)
      })
    return () => { live = false }
  }, [bootProject, loadChats])

  useEffect(() => {
    let live = true
    getSettings()
      .then((raw) => {
        if (live) setSettings(normalizeSettings(raw))
      })
      .catch(() => {
        if (live) setSettings(null)
      })
    return () => { live = false }
  }, [])

  useEffect(() => {
    scheduleSave()
  }, [clips, selectedId, pxPerSecond, scheduleSave])

  useEffect(() => {
    if (isPlaying || !timelineReadyRef.current) return
    scheduleSave()
  }, [isPlaying, scheduleSave])

  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === 'hidden') void flushTimeline({ keepalive: true })
    }
    const onPageHide = () => {
      void flushTimeline({ keepalive: true })
    }
    document.addEventListener('visibilitychange', onHide)
    window.addEventListener('pagehide', onPageHide)
    return () => {
      document.removeEventListener('visibilitychange', onHide)
      window.removeEventListener('pagehide', onPageHide)
      window.clearTimeout(saveTimerRef.current)
      void flushTimeline({ keepalive: true })
    }
  }, [flushTimeline])

  const seek = useCallback((time: number) => {
    setCurrentTime(Math.min(durationRef.current, Math.max(0, time)))
  }, [])

  const removeClip = useCallback((id: string) => {
    const clip = clipsRef.current.find((item) => item.id === id)
    if (!clip) return
    setClips((prev) => removeClips(prev, [id], editModeRef.current, PROJECT_FPS))
    setSelectedId((cur) => (cur === id ? null : cur))
    setToast(`Removed ${clip.name}`)
  }, [])

  const splitAtPlayhead = useCallback(() => {
    const time = currentTimeRef.current
    const hits = clipsRef.current.filter((clip) => clipContainsTime(clip, time, PROJECT_FPS))
    if (hits.length === 0) return
    const { clips: next } = splitClipsAtTime(clipsRef.current, time, PROJECT_FPS)
    if (next.length === clipsRef.current.length) return
    setClips(next)
    setToast('Split at playhead')
  }, [])

  const unlinkSelected = useCallback(() => {
    const id = selectedIdRef.current
    if (!id) return
    const group = linkedClips(clipsRef.current, id)
    if (group.length < 2) return
    setClips((prev) => unlinkClips(prev, id))
    setToast('Unlinked')
  }, [])

  const beginEdit = useCallback((id: string, type: 'move' | 'trim') => {
    if (editSessionRef.current) return
    const group = linkedClips(clipsRef.current, id)
    const primary = group.find((clip) => clip.id === id) ?? group[0]
    if (!primary) return
    editSessionRef.current = {
      type,
      ids: new Set(group.map((clip) => clip.id)),
      originStart: primary.start,
      originDuration: primary.duration,
    }
  }, [])

  const commitEdit = useCallback(() => {
    const session = editSessionRef.current
    editSessionRef.current = null
    if (!session) return
    setClips((prev) => {
      const incoming = prev.filter((clip) => session.ids.has(clip.id))
      if (incoming.length === 0) return prev
      if (session.type === 'move') {
        return commitMove(
          prev,
          session.ids,
          incoming[0].start,
          session.originStart,
          session.originDuration,
          editModeRef.current,
          PROJECT_FPS,
        )
      }
      return commitTrim(
        prev,
        incoming,
        session.originStart,
        session.originDuration,
        editModeRef.current,
        PROJECT_FPS,
      )
    })
  }, [])

  useEffect(() => {
    if (!isPlaying) return
    let raf = 0
    let last = performance.now()
    const tick = (now: number) => {
      const dt = (now - last) / 1000
      last = now
      setCurrentTime((t) => {
        const next = t + dt
        if (next >= durationRef.current) {
          queueMicrotask(() => setIsPlaying(false))
          return durationRef.current
        }
        return next
      })
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [isPlaying])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement
      if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable) return

      if (e.code === 'Space' || e.key === 'k' || e.key === 'K') {
        e.preventDefault()
        setIsPlaying((p) => !p)
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        if (e.shiftKey) void redoLastRef.current()
        else void undoLastRef.current()
        return
      }
      if (e.key === 'j' || e.key === 'J') seek(currentTime - 2)
      if (e.key === 'l' || e.key === 'L') seek(currentTime + 2)
      if (e.key === 'ArrowLeft') seek(currentTime - (e.shiftKey ? 1 : 1 / PROJECT_FPS))
      if (e.key === 'ArrowRight') seek(currentTime + (e.shiftKey ? 1 : 1 / PROJECT_FPS))
      if (e.key === 'Home') seek(0)
      if (e.key === 'Escape') setSelectedId(null)
      if (e.key === 'c' || e.key === 'C' || e.key === 'b' || e.key === 'B' || ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K'))) {
        e.preventDefault()
        splitAtPlayhead()
      }
      if ((e.key === 's' || e.key === 'S') && !e.metaKey && !e.ctrlKey) {
        e.preventDefault()
        setSnapEnabled((value) => {
          const next = !value
          writePref('parallax.snap', next ? '1' : '0')
          return next
        })
      }
      if ((e.key === 'r' || e.key === 'R') && !e.metaKey && !e.ctrlKey) {
        e.preventDefault()
        setEditMode((mode) => {
          const next = mode === 'overwrite' ? 'ripple' : 'overwrite'
          writePref('parallax.editMode', next)
          return next
        })
      }
      if ((e.key === 'u' || e.key === 'U') && !e.metaKey && !e.ctrlKey) {
        e.preventDefault()
        unlinkSelected()
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        const id = selectedIdRef.current
        if (!id) return
        e.preventDefault()
        removeClip(id)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [currentTime, seek, removeClip, splitAtPlayhead, unlinkSelected])

  const adoptTimeline = useCallback((timeline: Awaited<ReturnType<typeof getProjectTimeline>>, availableAssets = assetsRef.current) => {
    const nextClips = clipsFromDocument({ ...emptyTimelineDocument(), ...timeline, clips: timeline.clips ?? [] }, availableAssets)
    setClips(nextClips)
    setSelectedId(null)
    revisionRef.current = timeline.revision
    timelineMetaRef.current = { canvas: timeline.canvas ?? { width: 1920, height: 1080 }, transitions: timeline.transitions ?? [] }
    lastSavedRef.current = timelineFingerprint(buildTimelineDocument({ clips: nextClips, fps: timeline.fps, revision: timeline.revision, playhead: currentTimeRef.current, selectedId: null, pxPerSecond: pxPerSecondRef.current, canvas: timelineMetaRef.current.canvas, transitions: timelineMetaRef.current.transitions }))
    dirtyRef.current = false
    setSaveStatus('saved')
  }, [])

  async function undoLast() {
    if (!projectIdRef.current || !history?.can_undo || pending) return
    try {
      await flushTimeline()
      const timeline = await undoProject(projectIdRef.current, revisionRef.current)
      const restoredAssets = await refreshMedia(projectIdRef.current)
      adoptTimeline(timeline, restoredAssets)
      await refreshHistory(projectIdRef.current)
      setToast('Undid last change')
    } catch (error) { setToast(errorMessage(error)) }
  }

  async function redoLast(target = -1) {
    if (!projectIdRef.current || !history?.redo_candidates?.length || pending) return
    try {
      await flushTimeline()
      const timeline = await redoProject(projectIdRef.current, revisionRef.current, target)
      const restoredAssets = await refreshMedia(projectIdRef.current)
      adoptTimeline(timeline, restoredAssets)
      await refreshHistory(projectIdRef.current)
      setToast('Redid change')
    } catch (error) { setToast(errorMessage(error)) }
  }

  undoLastRef.current = undoLast
  redoLastRef.current = redoLast

  async function restoreRevision(target: number) {
    if (!projectIdRef.current || target === revisionRef.current || pending) return
    try {
      await flushTimeline()
      const timeline = await restoreProjectRevision(projectIdRef.current, revisionRef.current, target)
      const restoredAssets = await refreshMedia(projectIdRef.current)
      adoptTimeline(timeline, restoredAssets)
      await refreshHistory(projectIdRef.current)
      setToast(`Restored revision ${target}`)
    } catch (error) { setToast(errorMessage(error)) }
  }

  async function checkpoint() {
    const name = window.prompt('Checkpoint name')?.trim()
    if (!name || !projectIdRef.current) return
    try {
      setHistory(await createProjectCheckpoint(projectIdRef.current, name, revisionRef.current))
      setToast(`Checkpoint “${name}” created`)
    } catch (error) { setToast(errorMessage(error)) }
  }

  useEffect(() => {
    if (!toast) return
    const id = window.setTimeout(() => setToast(null), 2800)
    return () => window.clearTimeout(id)
  }, [toast])

  useEffect(() => {
    if (currentTime > duration) setCurrentTime(duration)
  }, [currentTime, duration])

  const program = useMemo(() => programAtTime(clips, currentTime), [clips, currentTime])
  const audioClips = useMemo(() => sequenceAudioClips(clips), [clips])
  const selected = clips.find((c) => c.id === selectedId)
  const selectedIds = useMemo(() => new Set(selectedId ? linkedIds(clips, selectedId) : []), [clips, selectedId])
  const canUnlink = selectedIds.size > 1

  function setToolAndPanel(id: ToolId) {
    if (id === tool && panelOpen) {
      setPanelOpen(false)
      return
    }
    setTool(id)
    setPanelOpen(true)
  }

  function trimClip(id: string, start: number, nextDuration: number, sourceIn: number) {
    beginEdit(id, 'trim')
    const ids = editSessionRef.current?.ids ?? new Set(linkedIds(clipsRef.current, id))
    setClips((prev) => prev.map((c) => {
      if (!ids.has(c.id)) return c
      return clampClip({
        ...c,
        start,
        duration: nextDuration,
        sourceIn,
        autoFit: false,
      }, PROJECT_FPS)
    }))
  }

  function moveClip(id: string, start: number, _track: string) {
    beginEdit(id, 'move')
    const ids = editSessionRef.current?.ids ?? new Set(linkedIds(clipsRef.current, id))
    const nextStart = snapTime(Math.max(0, start), PROJECT_FPS)
    setClips((prev) => prev.map((c) => (
      ids.has(c.id) ? { ...c, start: nextStart } : c
    )))
  }

  async function deleteAsset(asset: MediaAsset) {
    if (!projectId || !asset.path) return
    try {
      await deleteProjectMedia(projectId, asset.path)
      const nextAssets = assetsRef.current.filter((item) => item.id !== asset.id)
      setAssets(nextAssets)
      setClips((current) => current.filter((clip) => !clipUsesAsset(clip, asset)))
      setSelectedId((cur) => {
        const selected = clipsRef.current.find((clip) => clip.id === cur)
        return selected && clipUsesAsset(selected, asset) ? null : cur
      })
      adoptTimeline(await getProjectTimeline(projectId), nextAssets)
      const latest = await listProjects()
      setProjects(latest)
      await refreshHistory(projectId)
      setToast(`Deleted ${asset.name}`)
    } catch (error) {
      setToast(errorMessage(error))
    }
  }

  function applyMediaDuration(assetId: string, nextDuration: number) {
    if (!Number.isFinite(nextDuration) || nextDuration <= 0) return
    setAssets((current) => current.map((asset) =>
      asset.id === assetId ? { ...asset, duration: nextDuration } : asset,
    ))
    const asset = assetsRef.current.find((item) => item.id === assetId)
    if (!asset) return
    const linked = { ...asset, duration: nextDuration }
    setClips((current) => current.map((clip) => {
      if (!clipUsesAsset(clip, linked)) return clip
      return applySourceDuration(clip, nextDuration, PROJECT_FPS)
    }))
  }

  function applyMediaFrame(assetId: string, width: number, height: number) {
    if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1) return
    const w = Math.round(width)
    const h = Math.round(height)
    setAssets((current) => current.map((asset) =>
      asset.id === assetId && (asset.width !== w || asset.height !== h)
        ? { ...asset, width: w, height: h }
        : asset,
    ))
    const asset = assetsRef.current.find((item) => item.id === assetId)
    if (!asset) return
    setClips((current) => current.map((clip) => {
      if (!clipUsesAsset(clip, asset)) return clip
      if (clip.width === w && clip.height === h) return clip
      return { ...clip, width: w, height: h }
    }))
  }

  function addAsset(asset: MediaAsset, start = currentTime, track?: string) {
    const incoming = clipsFromAsset(asset, snapTime(start, PROJECT_FPS), track)
      .map((clip) => clampClip(clip, PROJECT_FPS))
    if (incoming.length === 0) return
    setClips((prev) => placeClips(prev, incoming, editModeRef.current, PROJECT_FPS))
    setSelectedId(incoming[0].id)
    seek(incoming[0].start)
    const lanes = incoming.map((clip) => clip.track).join(' + ')
    setToast(`${incoming[0].name} added to ${lanes}`)
  }

  function clock() {
    return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  }

  async function openProject(id: string) {
    if (id === projectIdRef.current) return
    await flushTimeline()
    saveGenRef.current += 1
    setDraft('')
    setMessages([])
    setActivity([])
    setActivityStartedAt(null)
    setChats([])
    setSessionId('')
    try {
      await bootProject(id)
      await loadChats(id)
    } catch (error) {
      setToast(errorMessage(error))
    }
  }

  async function openChat(id: string, chatID: string) {
    if (!id || chatID === sessionId) return
    try {
      const detail = await getProjectChat(id, chatID)
      setSessionId(chatID)
      writeActiveChat(id, chatID)
      setMessages(toUiMessages(detail.messages))
      setActivity([])
      setActivityStartedAt(null)
    } catch (error) {
      setToast(errorMessage(error))
    }
  }

  async function newChat() {
    if (!projectId) return
    try {
      const chat = await createProjectChat(projectId)
      setChats((current) => [chat, ...current])
      setSessionId(chat.id)
      writeActiveChat(projectId, chat.id)
      setMessages([])
      setActivity([])
      setActivityStartedAt(null)
      setDraft('')
    } catch (error) {
      setToast(errorMessage(error))
    }
  }

  async function removeChat(chatID: string) {
    if (!projectId) return
    try {
      await deleteProjectChat(projectId, chatID)
      const remaining = chats.filter((chat) => chat.id !== chatID)
      if (remaining.length === 0) {
        const chat = await createProjectChat(projectId)
        setChats([chat])
        setSessionId(chat.id)
        writeActiveChat(projectId, chat.id)
        setMessages([])
        setActivity([])
        setActivityStartedAt(null)
        return
      }
      setChats(remaining)
      if (sessionId === chatID) {
        const next = remaining[0]
        setSessionId(next.id)
        writeActiveChat(projectId, next.id)
        const detail = await getProjectChat(projectId, next.id)
        setMessages(toUiMessages(detail.messages))
        setActivity([])
        setActivityStartedAt(null)
      }
    } catch (error) {
      setToast(errorMessage(error))
    }
  }

  async function newProject(name: string) {
    name = name.trim()
    if (!name) return
    setCreatingProject(true)
    try {
      const project = await createRemoteProject(name)
      setProjects((current) => [project, ...current])
      await openProject(project.id)
      setCreateOpen(false)
      setProjectNameDraft('')
      setToast(`${project.name} created`)
    } catch (error) {
      setToast(errorMessage(error))
    } finally {
      setCreatingProject(false)
    }
  }

  async function runExport(body: ExportRequest) {
    if (!projectId) return
    setExporting(true)
    try {
      await flushTimeline()
      const result = await exportProjectMedia(projectId, body)
      await downloadProjectFile(result.download_url, result.media.name)
      setExportOpen(false)
      setToast(`Exported ${result.media.name}`)
    } catch (error) {
      setToast(errorMessage(error))
    } finally {
      setExporting(false)
    }
  }

  async function upload(files: File[]) {
    if (!projectId || files.length === 0) return
    setUploading(true)
    try {
      await uploadProjectMedia(projectId, files)
      const nextAssets = await refreshMedia(projectId)
      adoptTimeline(await getProjectTimeline(projectId), nextAssets)
      await refreshHistory(projectId)
      const latest = await listProjects()
      setProjects(latest)
      setToast(`${files.length} ${files.length === 1 ? 'file' : 'files'} uploaded`)
    } catch (error) {
      setToast(errorMessage(error))
    } finally {
      setUploading(false)
      if (fileInput.current) fileInput.current.value = ''
    }
  }

  async function send(text: string) {
    const value = text.trim()
    if (!value || pending) return
    if (!projectId) {
      setToast('Create a project before using Director')
      return
    }
    await flushTimeline()
    if (dirtyRef.current) {
      setToast('Save the timeline before running Director')
      return
    }
    const userMsg: ChatMessage = { id: uid(), role: 'user', text: value, time: clock() }
    const responseID = uid()
    const startedAt = Date.now()
    setMessages((m) => [
      ...m,
      userMsg,
      { id: responseID, role: 'assistant', text: '', time: clock() },
    ])
    setActivity([])
    setActivityStartedAt(startedAt)
    setDraft('')
    setPending(true)
    let streamError = ''
    try {
      await streamAgent({
        projectID: projectId,
        sessionID: sessionId,
        profileID: settingsRef.current?.active_id,
        message: value,
        thinkingEffort,
      }, (event) => {
        if (event.type === 'session' && typeof event.data.session_id === 'string') {
          setSessionId(event.data.session_id)
          writeActiveChat(projectId, event.data.session_id)
        }
        if (event.type === 'text' && typeof event.data.delta === 'string') {
          setMessages((current) => current.map((message) =>
            message.id === responseID ? { ...message, text: message.text + event.data.delta } : message,
          ))
        }
        if (event.type === 'step' && event.data.phase === 'think') {
          const iteration = numberValue(event.data.iteration)
          setActivity((current) => [
            ...current,
            {
              id: `think-${iteration ?? current.length}`,
              kind: 'thinking',
              status: 'active',
              title: iteration === 1 ? 'Planning the request' : 'Planning the next step',
              detail: 'Director is deciding what to inspect or change next.',
              iteration: iteration ?? undefined,
            },
          ])
          setMessages((current) => current.map((message) =>
            message.id === responseID && message.text.trim()
              ? { ...message, text: message.text.trimEnd() + '\n\n' }
              : message,
          ))
        }
        if (event.type === 'step' && event.data.phase === 'act') {
          const iteration = numberValue(event.data.iteration)
          setActivity((current) => [
            ...current,
            {
              id: `act-${iteration ?? current.length}`,
              kind: 'thinking',
              status: 'active',
              title: 'Executing the next action',
              detail: 'Director is applying the plan through its tools.',
              iteration: iteration ?? undefined,
            },
          ])
        }
        if (event.type === 'tool_call' && typeof event.data.name === 'string') {
          const toolID = typeof event.data.id === 'string' ? event.data.id : uid()
          const name = event.data.name
          setActivity((current) => [
            ...current,
            {
              id: `tool-${toolID}`,
              kind: 'tool',
              status: 'active',
              title: toolLabel(name),
              name,
              arguments: event.data.arguments,
              iteration: numberValue(event.data.iteration) ?? undefined,
            },
          ])
          setToast(`Director is running ${name.replaceAll('_', ' ')}`)
        }
        if (event.type === 'tool_result') {
          const toolID = typeof event.data.id === 'string' ? event.data.id : ''
          const ok = event.data.ok === true
          const elapsedMs = numberValue(event.data.elapsed_ms) ?? undefined
          const error = typeof event.data.error === 'string' ? event.data.error : ''
          setActivity((current) => {
            const index = current.findIndex((item) => item.id === `tool-${toolID}`)
            if (index < 0) {
              return [
                ...current,
                {
                  id: `tool-${toolID || uid()}`,
                  kind: 'tool',
                  status: ok ? 'success' : 'error',
                  title: typeof event.data.name === 'string' ? toolLabel(event.data.name) : 'Tool call',
                  detail: error || (ok ? 'Completed.' : 'The tool returned an error.'),
                  elapsedMs,
                },
              ]
            }
            const next = [...current]
            next[index] = {
              ...next[index],
              status: ok ? 'success' : 'error',
              detail: error || (ok ? 'Completed.' : 'The tool returned an error.'),
              elapsedMs,
            }
            return next
          })
        }
        if (event.type === 'error' && typeof event.data.message === 'string') {
          const message = event.data.message
          streamError = message
          setActivity((current) => [
            ...current,
            { id: `error-${uid()}`, kind: 'tool', status: 'error', title: 'Director stopped with an error', detail: message },
          ])
        }
        if (event.type === 'done') {
          setActivity((current) => current.map((item) => (
            item.status === 'active' ? { ...item, status: 'success' } : item
          )))
        }
      })
      if (streamError) throw new Error(streamError)
      setMessages((current) => current.map((message) =>
        message.id !== responseID
          ? message
          : {
              ...message,
              workedMs: Date.now() - startedAt,
              trace: activityRef.current,
              ...(!message.text ? { text: 'The operation completed without a written summary.' } : {}),
            },
      ))
      const nextAssets = await refreshMedia(projectId)
      await loadTimeline(projectId, nextAssets ?? assetsRef.current)
      await refreshHistory(projectId)
      try {
        const items = await listProjectChats(projectId)
        setChats(items)
      } catch {
        // keep the in-memory chat list if the refresh fails
      }
    } catch (error) {
      setMessages((current) => current.map((message) =>
        message.id === responseID ? { ...message, text: `I couldn't complete that: ${errorMessage(error)}` } : message,
      ))
    } finally {
      setPending(false)
    }
  }

  async function selectModel(id: string) {
    const previous = settingsRef.current
    setSettings((current) => current ? { ...current, active_id: id } : current)
    try {
      setSettings(normalizeSettings(await putSettings({ active_id: id })))
    } catch (error) {
      setSettings(previous)
      setToast(errorMessage(error))
    }
  }

  function selectThinkingEffort(value: ThinkingEffort) {
    setThinkingEffort(value)
    writePref('parallax.thinkingEffort', value)
  }

  return (
    <LayoutGroup>
    <div className="chrome relative flex h-full min-w-[1100px] flex-col bg-ink text-cream">
      <TopBar
        projects={projects}
        projectId={projectId}
        projectName="No project"
        uploading={uploading}
        onProject={(id) => openProject(id)}
        onCreateProject={() => setCreateOpen(true)}
        onUpload={() => fileInput.current?.click()}
        canUndo={!!history?.can_undo && !pending}
        canRedo={!!history?.redo_candidates?.length && !pending}
        onUndo={() => void undoLast()}
        onRedo={() => void redoLast()}
        exporting={exporting}
        peers={collab.peers}
        onExport={() => {
          if (!projectId) {
            setToast('Create a project before exporting')
            return
          }
          setExportOpen(true)
        }}
      />
      <input
        ref={fileInput}
        type="file"
        multiple
        accept="video/*,audio/*,image/*,.srt,.ass,.vtt,.lrc"
        className="hidden"
        onChange={(event) => void upload(Array.from(event.target.files ?? []))}
      />

      <div className="flex min-h-0 flex-1">
        <ToolRail tool={tool} onChange={setToolAndPanel} />
        <AnimatePresence initial={false}>
          {panelOpen && (
            <motion.div
              key="bin"
              initial={reduce ? false : { width: 0, opacity: 0 }}
              animate={{ width: mediaWidth, opacity: 1 }}
              exit={reduce ? undefined : { width: 0, opacity: 0 }}
              transition={reduce || resizing ? { duration: 0 } : panelTransition}
              className="h-full shrink-0 overflow-hidden"
            >
              {tool === 'history' ? (
                <HistoryPanel width={mediaWidth} history={history} loading={historyLoading} onRestore={(revision) => void restoreRevision(revision)} onCheckpoint={() => void checkpoint()} />
              ) : (
                <MediaPanel
                  width={mediaWidth}
                  tool={tool}
                  assets={assets}
                  loading={mediaLoading}
                  hasProject={!!projectId}
                  onDuration={(id, nextDuration) => applyMediaDuration(id, nextDuration)}
                  onFrame={(id, width, height) => applyMediaFrame(id, width, height)}
                  onAdd={(asset) => addAsset(asset)}
                  onDelete={(asset) => void deleteAsset(asset)}
                />
              )}
            </motion.div>
          )}
        </AnimatePresence>
        {panelOpen && (
          <ResizeHandle
            side="media"
            resizing={resizing === 'media'}
            onPointerDown={startResize}
            onNudge={nudgeResize}
          />
        )}

        <div className="flex min-w-0 flex-1 flex-col">
          <PreviewStage
            currentTime={currentTime}
            isPlaying={isPlaying}
            muted={muted}
            safeArea={safeArea}
            program={program}
            audioClips={audioClips}
            grade={grade}
            duration={duration}
            onTogglePlay={() => setIsPlaying((p) => !p)}
            onSeek={seek}
            onToggleMute={() => setMuted((m) => !m)}
            onToggleSafe={() => setSafeArea((s) => !s)}
          />
          <Timeline
            clips={clips}
            selectedId={selectedId}
            linkedIds={selectedIds}
            currentTime={currentTime}
            duration={duration}
            pxPerSecond={pxPerSecond}
            snapEnabled={snapEnabled}
            editMode={editMode}
            canUnlink={canUnlink}
            onSelect={setSelectedId}
            onSeek={seek}
            onZoom={setPxPerSecond}
            onTrim={trimClip}
            onMove={moveClip}
            onCommit={commitEdit}
            onRemove={removeClip}
            onSplit={splitAtPlayhead}
            onDropAsset={(asset, start, track) => addAsset(asset, start, track)}
            onToggleSnap={() => {
              setSnapEnabled((value) => {
                const next = !value
                writePref('parallax.snap', next ? '1' : '0')
                return next
              })
            }}
            onEditMode={(mode) => {
              setEditMode(mode)
              writePref('parallax.editMode', mode)
            }}
            onUnlink={unlinkSelected}
            saveStatus={saveStatus}
          />
        </div>

        {chatOpen && (
          <ResizeHandle
            side="chat"
            resizing={resizing === 'chat'}
            onPointerDown={startResize}
            onNudge={nudgeResize}
          />
        )}
        <AnimatePresence initial={false} mode="popLayout">
          {chatOpen ? (
            <motion.div
              key="chat"
              initial={reduce ? false : { width: 0, opacity: 0 }}
              animate={{ width: chatWidth, opacity: 1 }}
              exit={reduce ? undefined : { width: 0, opacity: 0 }}
              transition={reduce || resizing ? { duration: 0 } : panelTransition}
              className="h-full shrink-0 overflow-hidden"
            >
              <ChatPanel
                width={chatWidth}
                messages={messages}
                chats={chats}
                chatId={sessionId}
                emptyHint={`${projects.find((item) => item.id === projectId)?.name ?? 'This project'} is ready. Upload media, add it to the timeline, or ask me to inspect and transform project files.`}
                draft={draft}
                pending={pending}
                activity={activity}
                activityStartedAt={activityStartedAt}
                selected={selected}
                onDraft={setDraft}
                onSend={send}
                onCollapse={() => setChatOpen(false)}
                onNewChat={() => void newChat()}
                onSelectChat={(id) => void openChat(projectId, id)}
                onDeleteChat={(id) => void removeChat(id)}
                models={settings?.profiles ?? []}
                modelId={settings?.active_id ?? ''}
                onModel={(id) => void selectModel(id)}
                thinkingEffort={thinkingEffort}
                onThinkingEffort={selectThinkingEffort}
              />
            </motion.div>
          ) : (
            <motion.div
              key="rail"
              initial={reduce ? false : { opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={reduce ? undefined : { opacity: 0 }}
              transition={fade}
            >
              <ChatRail onOpen={() => setChatOpen(true)} />
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <AnimatePresence>
        {exportOpen && (
          <ExportDialog
            projectName={projects.find((item) => item.id === projectId)?.name ?? 'Project'}
            assets={assets}
            selected={selected}
            playhead={program.video?.clip}
            sequenceDuration={duration}
            hasSequence={clips.length > 0}
            busy={exporting}
            clips={clips}
            onClose={() => {
              if (!exporting) setExportOpen(false)
            }}
            onExport={(body) => void runExport(body)}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {createOpen && (
          <motion.div
            initial={reduce ? false : { opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={reduce ? undefined : { opacity: 0 }}
            className="absolute inset-0 z-[70] grid place-items-center bg-black/65 backdrop-blur-sm"
            role="dialog"
            aria-modal="true"
            aria-labelledby="create-project-title"
            onPointerDown={(event) => {
              if (event.target === event.currentTarget && !creatingProject) setCreateOpen(false)
            }}
          >
            <motion.form
              initial={reduce ? false : { opacity: 0, y: 10, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={reduce ? undefined : { opacity: 0, y: 8, scale: 0.98 }}
              onSubmit={(event) => {
                event.preventDefault()
                void newProject(projectNameDraft)
              }}
              className="w-[380px] rounded-xl border border-line bg-panel p-5 shadow-2xl"
            >
              <h2 id="create-project-title" className="text-[16px] font-medium text-cream">Create a project</h2>
              <p className="mt-1 text-[12px] text-mute">Uploads and Director operations stay isolated inside this project.</p>
              <label className="mt-5 block text-[10px] tracking-[0.14em] text-dim uppercase">
                Project name
                <input
                  autoFocus
                  value={projectNameDraft}
                  onChange={(event) => setProjectNameDraft(event.target.value)}
                  maxLength={120}
                  placeholder="Campaign cut"
                  className="mt-2 h-10 w-full rounded-lg border border-line bg-well px-3 text-[13px] normal-case tracking-normal text-cream outline-none placeholder:text-dim focus:border-line-strong"
                />
              </label>
              <div className="mt-5 flex justify-end gap-2">
                <button
                  type="button"
                  disabled={creatingProject}
                  onClick={() => setCreateOpen(false)}
                  className="h-9 rounded-md px-3 text-[12px] text-mute hover:bg-wash hover:text-cream"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={!projectNameDraft.trim() || creatingProject}
                  className="h-9 rounded-md bg-cream px-4 text-[12px] font-medium text-ink disabled:opacity-40"
                >
                  {creatingProject ? 'Creating…' : 'Create project'}
                </button>
              </div>
            </motion.form>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {toast && (
          <motion.div
            key={toast}
            initial={reduce ? false : { opacity: 0, y: 10, x: '-50%' }}
            animate={{ opacity: 1, y: 0, x: '-50%' }}
            exit={reduce ? undefined : { opacity: 0, y: 8, x: '-50%' }}
            transition={fade}
            className="pointer-events-none absolute bottom-6 left-1/2 z-50 rounded-full border border-line bg-lift px-4 py-2 text-[12px] text-cream shadow-[var(--toast-shadow)]"
          >
            {toast}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
    </LayoutGroup>
  )
}

function uid() {
  return Math.random().toString(36).slice(2, 9)
}

function numberValue(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function toolLabel(name: string) {
  const labels: Record<string, string> = {
    search_web: 'Searching the web',
    list_workspace: 'Inspecting workspace files',
    inspect_file: 'Inspecting file metadata',
    probe_media: 'Probing media streams',
    run_ffmpeg: 'Running media transform',
    get_timeline: 'Reading the timeline',
    place_media: 'Placing media on the timeline',
    edit_timeline: 'Editing the timeline',
    get_project_history: 'Reading project history',
    undo_project_change: 'Staging undo',
    redo_project_change: 'Staging redo',
    restore_project_revision: 'Restoring project revision',
    create_project_checkpoint: 'Creating project checkpoint',
  }
  return labels[name] ?? name.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function toMediaAsset(item: ProjectMedia): MediaAsset {
  const url = mediaURL(item)
  const kind = item.kind === 'audio' ? 'audio' : item.kind === 'subtitle' ? 'title' : 'video'
  const mediaType = item.kind === 'image' ? 'image' : item.kind === 'audio' ? 'audio' : 'video'
  const measured = item.duration && item.duration > 0 ? item.duration : 0
  return {
    id: `project-${item.id}`,
    name: item.name,
    kind,
    duration: measured || (item.kind === 'image' ? 5 : item.kind === 'subtitle' ? 4 : 0),
    thumb: item.kind === 'image' ? url : undefined,
    src: url,
    path: item.path,
    mediaType,
    width: item.width && item.width > 0 ? item.width : undefined,
    height: item.height && item.height > 0 ? item.height : undefined,
  }
}

function toUiMessages(messages: SavedChatMessage[]): ChatMessage[] {
  const visible: SavedChatMessage[] = []
  for (const message of messages) {
    if (message.role !== 'user' && message.role !== 'assistant') continue
    const previous = visible[visible.length - 1]
    if (message.role === 'assistant' && previous?.role === 'assistant') {
      // One Director request can contain several assistant/tool iterations.
      // Keep the final assistant turn visible without losing the stored
      // intermediate turns used to continue the model conversation.
      visible[visible.length - 1] = message
    } else {
      visible.push(message)
    }
  }
  return visible
    .filter((message) => message.content.trim())
    .map((message) => ({
      id: uid(),
      role: message.role,
      text: message.content,
      time: '',
      workedMs: message.worked_ms,
      trace: activityFromTrace(message.trace_events),
    }))
}

function activityFromTrace(events?: AgentEvent[]): DirectorActivity[] {
  if (!events?.length) return []
  const items: DirectorActivity[] = []
  for (const event of events) {
    const data = event.data
    if (event.type === 'step') {
      const iteration = numberValue(data.iteration) ?? undefined
      const phase = data.phase
      items.push({
        id: `${phase}-${iteration ?? items.length}`,
        kind: 'thinking',
        status: 'success',
        title: phase === 'think'
          ? (iteration === 1 ? 'Planning the request' : 'Planning the next step')
          : 'Executing the next action',
        detail: phase === 'think'
          ? 'Director decided what to inspect or change next.'
          : 'Director applied the plan through its tools.',
        iteration,
      })
      continue
    }
    if (event.type === 'tool_call' && typeof data.name === 'string') {
      items.push({
        id: `tool-${typeof data.id === 'string' ? data.id : items.length}`,
        kind: 'tool',
        status: 'success',
        title: toolLabel(data.name),
        name: data.name,
        arguments: data.arguments,
        iteration: numberValue(data.iteration) ?? undefined,
      })
      continue
    }
    if (event.type === 'tool_result') {
      const id = typeof data.id === 'string' ? `tool-${data.id}` : ''
      const index = items.findIndex((item) => item.id === id)
      const ok = data.ok === true
      const detail = typeof data.error === 'string'
        ? data.error
        : ok ? 'Completed.' : 'The tool returned an error.'
      const elapsedMs = numberValue(data.elapsed_ms) ?? undefined
      if (index >= 0) {
        items[index] = { ...items[index], status: ok ? 'success' : 'error', detail, elapsedMs }
      } else {
        items.push({
          id: id || `tool-${items.length}`,
          kind: 'tool',
          status: ok ? 'success' : 'error',
          title: typeof data.name === 'string' ? toolLabel(data.name) : 'Tool call',
          detail,
          elapsedMs,
        })
      }
      continue
    }
    if (event.type === 'error' && typeof data.message === 'string') {
      items.push({ id: `error-${items.length}`, kind: 'tool', status: 'error', title: 'Director stopped with an error', detail: data.message })
    }
  }
  return items
}

function clipUsesAsset(clip: Clip, asset: MediaAsset) {
  return findClipAsset(clip, [asset]) != null
}

function syncClipMedia(clips: Clip[], assets: MediaAsset[]) {
  return clips.map((clip) => {
    const next = hydrateClip(clip, assets)
    if (
      next.src === clip.src
      && next.thumb === clip.thumb
      && next.name === clip.name
      && next.mediaPath === clip.mediaPath
      && next.sourceDuration === clip.sourceDuration
      && next.duration === clip.duration
      && next.sourceIn === clip.sourceIn
      && next.width === clip.width
      && next.height === clip.height
    ) {
      return clip
    }
    return next
  })
}

function activeChatKey(projectID: string) {
  return `parallax.activeChat.${projectID}`
}

function readActiveChat(projectID: string) {
  try {
    return localStorage.getItem(activeChatKey(projectID)) || ''
  } catch {
    return ''
  }
}

function writeActiveChat(projectID: string, chatID: string) {
  writePref(activeChatKey(projectID), chatID)
}

function readPref(key: string, fallback = '') {
  try {
    return localStorage.getItem(key) ?? fallback
  } catch {
    return fallback
  }
}

function writePref(key: string, value: string) {
  try {
    localStorage.setItem(key, value)
  } catch {
    // ignore quota / private mode
  }
}

function readNumberPref(key: string, fallback: number, min: number, max: number) {
  const stored = readPref(key)
  if (!stored.trim()) return fallback
  const value = Number(stored)
  return Number.isFinite(value) ? clampNumber(value, min, max) : fallback
}

function clampNumber(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, Math.round(value)))
}

function ResizeHandle({
  side,
  resizing,
  onPointerDown,
  onNudge,
}: {
  side: 'media' | 'chat'
  resizing: boolean
  onPointerDown: (side: 'media' | 'chat', event: ReactPointerEvent<HTMLDivElement>) => void
  onNudge: (side: 'media' | 'chat', direction: -1 | 1) => void
}) {
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={`Resize ${side === 'media' ? 'media' : 'Director'} sidebar`}
      tabIndex={0}
      onPointerDown={(event) => onPointerDown(side, event)}
      onKeyDown={(event) => {
        if (event.key === 'ArrowLeft') {
          event.preventDefault()
          onNudge(side, -1)
        }
        if (event.key === 'ArrowRight') {
          event.preventDefault()
          onNudge(side, 1)
        }
      }}
      className={cn(
        'group relative z-20 h-full w-1 shrink-0 cursor-col-resize outline-none transition-colors',
        resizing ? 'bg-wash-strong' : 'hover:bg-wash',
        'focus-visible:bg-wash-strong',
      )}
    >
      <span className="absolute inset-y-0 -left-1 -right-1" />
      <span className={cn(
        'absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-transparent transition-colors group-hover:bg-line-strong group-focus-visible:bg-line-strong',
        resizing && 'bg-line-strong',
      )} />
    </div>
  )
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Unexpected error'
}
