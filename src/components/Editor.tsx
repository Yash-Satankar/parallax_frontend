import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { AnimatePresence, LayoutGroup, motion, useReducedMotion } from 'framer-motion'
import type { ChatMessage, ChatPart, ClarifyingQuestion, Clip, DirectorActivity, Grade, MediaAsset, MediaIndexState, QuestionAnswer, QuestionSheet, ToolId } from '../types'
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
  deleteProject,
  deleteProjectChat,
  deleteProjectMedia,
  downloadProjectFile,
  API_BASE,
  exportProjectMedia,
  getProjectChat,
  getProjectTimeline,
	getVisualReview,
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
	requestVisualReview,
  putSettings,
  streamAgent,
  uploadProjectMedia,
  describeProjectMedia,
  formatBytes,
  type ChatRecord,
  type AgentEvent,
  type LLMSettings,
  type ThinkingEffort,
  type ProjectMedia,
  type ProjectRecord,
  type ProjectHistory,
  type ExportRequest,
  type SavedChatMessage,
  type HistoryMessage,
  type TimelineTransition,
	type ProjectMediaUploadTask,
	type VisualReview,
  normalizeVisualReview,
} from '../lib/api'
import { TopBar } from './TopBar'
import { UploadProgressBar, type UploadStatus } from './UploadProgressBar'
import { ToolRail } from './ToolRail'
import { MediaPanel } from './MediaPanel'
import { PreviewStage } from './PreviewStage'
import { Timeline } from './Timeline'
import { ChatPanel, ChatRail } from './ChatPanel'
import { ExportDialog } from './ExportDialog'
import { HistoryPanel } from './HistoryPanel'
import { fade, panelTransition } from '../lib/motion'
import { cn } from '../lib/cn'
import { createStreamTextQueue, type StreamTextQueue } from '../lib/streamText'
import { stripThoughtMarkup, stripThoughtTags } from '../lib/thought'

const MEDIA_GENERATION_TOOLS = new Set([
  'blender_render',
  'import_gif',
  'run_ffmpeg',
  'download_youtube_video',
  'generate_image',
  'generate_video',
  'generate_voiceover',
  'generate_music',
  'generate_sound_effect',
  'polish_audio',
  'remove_dead_air',
  'audio_duck',
  'audio_cleanup',
  'volume_leveling',
])

type EditorProps = {
  initialProjectID: string
  onBackToProjects: () => void
}

export function Editor({ initialProjectID, onBackToProjects }: EditorProps) {
  const reduce = useReducedMotion()
  const [tool, setTool] = useState<ToolId>('media')
  const [panelOpen, setPanelOpen] = useState(true)
  const [chatOpen, setChatOpen] = useState(true)
  const [mediaWidth, setMediaWidth] = useState(() => readNumberPref('parallax.mediaWidth', 268, 220, 420))
  const [chatWidth, setChatWidth] = useState(() => readNumberPref('parallax.chatWidth', 360, 300, 520))
  const [currentTime, setCurrentTime] = useState(0)
  const [seekToken, setSeekToken] = useState(0)
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
  const pendingRef = useRef(false)
  pendingRef.current = pending
  const messagesRef = useRef<ChatMessage[]>([])
  messagesRef.current = messages
  const [grade] = useState<Grade>({ warmth: 0, contrast: 0, saturation: 0 })
  const [visualReview, setVisualReview] = useState<VisualReview | null>(null)
  const [visualReviewLoading, setVisualReviewLoading] = useState(false)
  const [visualReviewError, setVisualReviewError] = useState('')
  const [selectedFindingId, setSelectedFindingId] = useState<string | null>(null)
  const reviewGenRef = useRef(0)
  const [toast, setToast] = useState<string | null>(null)
  const [projects, setProjects] = useState<ProjectRecord[]>([])
  const [projectId, setProjectId] = useState('')
  const [assets, setAssets] = useState<MediaAsset[]>([])
  const [mediaLoading, setMediaLoading] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [uploadStatus, setUploadStatus] = useState<UploadStatus | null>(null)
	const uploadTaskRef = useRef<ProjectMediaUploadTask | null>(null)
	const [uploadPaused, setUploadPaused] = useState(false)
  const [sessionId, setSessionId] = useState('')
  const [chats, setChats] = useState<ChatRecord[]>([])
  const [createOpen, setCreateOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deleteName, setDeleteName] = useState('')
  const [deletingProject, setDeletingProject] = useState(false)
  const [exportOpen, setExportOpen] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [settings, setSettings] = useState<LLMSettings | null>(null)
  const [thinkingEffort, setThinkingEffort] = useState<ThinkingEffort>(() => (
    normalizeThinkingEffort(readPref('parallax.thinkingEffort', 'medium'))
  ))
  const settingsRef = useRef(settings)
  settingsRef.current = settings
  const streamQueueRef = useRef<StreamTextQueue | null>(null)
  const streamAbortRef = useRef<AbortController | null>(null)
  const streamGenRef = useRef(0)
  useEffect(() => {
    activityRef.current = activity
  }, [activity])
  useEffect(() => {
    return () => {
      streamGenRef.current += 1
      streamAbortRef.current?.abort()
      streamAbortRef.current = null
      streamQueueRef.current?.reset()
    }
  }, [])
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
  const [revision, setRevision] = useState(0)
  const revisionRef = useRef(0)
  revisionRef.current = revision
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
    before: Clip[]
    originStart: number
    originDuration: number
    latestStart: number
  } | null>(null)

  const mediaRefreshSequence = useRef(0)
  const refreshMedia = useCallback(async (id: string, opts?: { silent?: boolean }) => {
    const sequence = ++mediaRefreshSequence.current
    if (!opts?.silent) setMediaLoading(true)
    try {
      const items = await listProjectMedia(id)
      if (projectIdRef.current !== id || sequence !== mediaRefreshSequence.current) return
      const previous = new Map(
        assetsRef.current.filter((asset) => asset.path).map((asset) => [asset.path as string, asset]),
      )
      const next = items.flatMap((item) => {
        const asset = toMediaAsset(item)
        if (!asset) return []
        if (asset.duration > 0 || !asset.path) return [asset]
        const known = previous.get(asset.path)
        return [known?.duration ? { ...asset, duration: known.duration } : asset]
      })
      setAssets(next)
      setClips((current) => syncClipMedia(current, next))
      return next
    } catch (error) {
      if (!opts?.silent) setToast(errorMessage(error))
      return undefined
    } finally {
      if (!opts?.silent) setMediaLoading(false)
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

  const runVisualReview = useCallback(async (mode: 'changed' | 'full', targetRevision = revisionRef.current) => {
    const id = projectIdRef.current
    if (!id || targetRevision < 0) return
    const gen = ++reviewGenRef.current
    setVisualReviewLoading(true)
    setVisualReviewError('')
    try {
      const result = await requestVisualReview(id, { revision: targetRevision, mode })
      if (gen !== reviewGenRef.current || projectIdRef.current !== id) return
      setVisualReview(result)
      setSelectedFindingId(result.findings[0]?.id ?? null)
      if (result.error) setVisualReviewError(result.error)
    } catch (error) {
      if (gen !== reviewGenRef.current || projectIdRef.current !== id) return
      setVisualReviewError(errorMessage(error))
    } finally {
      if (gen === reviewGenRef.current) setVisualReviewLoading(false)
    }
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
      setRevision(saved.revision)
      lastSavedRef.current = fingerprint
      setSaveStatus('saved')
      void refreshHistory(id)
      if (!opts?.keepalive) void runVisualReview('changed', saved.revision)
    } catch (error) {
      if (gen !== saveGenRef.current || projectIdRef.current !== id) return
      dirtyRef.current = true
      setSaveStatus('error')
      if (!opts?.keepalive) setToast(errorMessage(error))
    } finally {
      if (gen === saveGenRef.current) savingRef.current = false
    }
  }, [refreshHistory, runVisualReview])

  const reviewFull = useCallback(async () => {
    await flushTimeline()
    await runVisualReview('full', revisionRef.current)
  }, [flushTimeline, runVisualReview])

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
    setRevision(timeline.revision ?? 0)
    setVisualReview(null)
    setSelectedFindingId(null)
    setVisualReviewError('')
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
    if (timeline.revision > 0) {
      void getVisualReview(id, timeline.revision).then((result) => {
        if (projectIdRef.current === id) {
          setVisualReview(result)
          setSelectedFindingId(result.findings[0]?.id ?? null)
        }
      }).catch(() => undefined)
    }
  }, [])

  const bootProject = useCallback(async (id: string) => {
    projectIdRef.current = id
    setProjectId(id)
    timelineReadyRef.current = false
    lastSavedRef.current = ''
    setRevision(0)
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
      const next = items.flatMap((item) => {
        const asset = toMediaAsset(item)
        if (!asset) return []
        if (asset.duration > 0 || !asset.path) return [asset]
        const known = previous.get(asset.path)
        return [known?.duration ? { ...asset, duration: known.duration } : asset]
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
        const initial = items.find((item) => item.id === initialProjectID) ?? items[0]
        if (!initial) return
        await bootProject(initial.id)
        if (!live) return
        try {
          await loadChats(initial.id)
        } catch (error) {
          if (live) setToast(errorMessage(error))
        }
      })
      .catch((error) => {
        if (live) setToast(`Backend unavailable: ${errorMessage(error)}`)
      })
    return () => { live = false }
  }, [bootProject, initialProjectID, loadChats])

  useEffect(() => {
    if (!projectId || !assets.some((asset) => indexBusy(asset.indexState) || previewBusy(asset))) return
    const timer = window.setInterval(() => {
      void refreshMedia(projectId, { silent: true })
    }, 2000)
    return () => window.clearInterval(timer)
  }, [assets, projectId, refreshMedia])

  useEffect(() => {
    if (uploadStatus?.phase !== 'uploading') return
    const timer = window.setInterval(() => {
      setUploadStatus((current) => (current ? { ...current } : current))
    }, 1000)
    return () => window.clearInterval(timer)
  }, [uploadStatus?.phase])

  useEffect(() => {
    let live = true
    getSettings()
      .then((raw) => {
        if (live) {
			const normalized = normalizeSettings(raw)
			setSettings(normalized)
			setThinkingEffort(normalizeThinkingEffort(normalized.thinking_effort))
		}
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
    // Playback intentionally lets native media advance without being
    // re-seeked on every React clock tick. Increment this token for explicit
    // user seeks so playing video and audio jump to the new playhead too.
    setSeekToken((value) => value + 1)
  }, [])

  const removeClip = useCallback((id: string) => {
    const clip = clipsRef.current.find((item) => item.id === id)
    if (!clip) return
    setClips((prev) => removeClips(prev, [id], editModeRef.current, PROJECT_FPS))
    timelineMetaRef.current = {
      ...timelineMetaRef.current,
      transitions: timelineMetaRef.current.transitions.filter((item) => (
        item.from_item_id !== id && item.to_item_id !== id
      )),
    }
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
      before: clipsRef.current,
      originStart: primary.start,
      originDuration: primary.duration,
      latestStart: primary.start,
    }
  }, [])

  const commitEdit = useCallback(() => {
    const session = editSessionRef.current
    editSessionRef.current = null
    if (!session) return
    setClips((prev) => {
      // Dragging updates the live preview on every pointer move. Commit from
      // the drag-start snapshot instead of treating that preview as the
      // source timeline. This is essential for ripple moves: recalculating a
      // ripple from already-moved clips can split or overwrite their siblings.
      const baseline = prev.map((clip) => {
        if (!session.ids.has(clip.id)) return clip
        return session.before.find((item) => item.id === clip.id) ?? clip
      })
      const incoming = baseline.filter((clip) => session.ids.has(clip.id))
      if (incoming.length === 0) return prev
      if (session.type === 'move') {
        return commitMove(
          baseline,
          session.ids,
          session.latestStart,
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
      // The media elements advance independently. Updating the full editor at
      // display refresh rate makes a large timeline compete with decoding, so
      // keep UI clocks at a stable 30 Hz while playback remains full-rate.
      if (now - last < 1000 / 30) {
        raf = requestAnimationFrame(tick)
        return
      }
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
    setRevision(timeline.revision)
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
  const inspectorClip = selected?.kind === 'audio'
    ? selected
    : selected?.linkId
      ? clips.find((clip) => clip.kind === 'audio' && clip.linkId === selected.linkId) ?? selected
      : selected
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
    if (editSessionRef.current?.type === 'move') {
      editSessionRef.current.latestStart = nextStart
    }
    setClips((prev) => prev.map((c) => (
      ids.has(c.id) ? { ...c, start: nextStart } : c
    )))
  }

  function setAudioVolume(id: string, volumeDb: number) {
    const gain = Math.min(12, Math.max(-60, Math.round(volumeDb * 10) / 10))
    setClips((current) => current.map((clip) => (
      clip.id === id && clip.kind === 'audio'
        ? { ...clip, audio: { ...clip.audio, volumeDb: gain } }
        : clip
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

  async function describeAsset(asset: MediaAsset) {
    if (!projectId || !asset.path) return
    try {
      await describeProjectMedia(projectId, asset.path)
      setAssets((current) => current.map((item) =>
        item.id === asset.id
          ? { ...item, canDescribe: false, indexState: 'queued', indexProgress: undefined }
          : item,
      ))
      setToast(`Describing scenes in ${asset.name}`)
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

  function abandonStream() {
    streamGenRef.current += 1
    streamAbortRef.current?.abort()
    streamAbortRef.current = null
    streamQueueRef.current?.reset()
    streamQueueRef.current = null
    setPending(false)
  }

  async function openProject(id: string) {
    if (id === projectIdRef.current) return
    await flushTimeline()
    saveGenRef.current += 1
    abandonStream()
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

  async function returnToProjects() {
    window.clearTimeout(saveTimerRef.current)
    await flushTimeline()
    abandonStream()
    onBackToProjects()
  }

  async function openChat(id: string, chatID: string) {
    if (!id || chatID === sessionId) return
    try {
      const detail = await getProjectChat(id, chatID)
      abandonStream()
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
      abandonStream()
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
        abandonStream()
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
        abandonStream()
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

  function resetWorkspace() {
    saveGenRef.current += 1
    projectIdRef.current = ''
    setProjectId('')
    timelineReadyRef.current = false
    lastSavedRef.current = ''
    setRevision(0)
    setSaveStatus('idle')
    setClips([])
    setSelectedId(null)
    setCurrentTime(0)
    setAssets([])
    setChats([])
    setSessionId('')
    setMessages([])
    setActivity([])
    setActivityStartedAt(null)
    setHistory(null)
    setDraft('')
    setMediaLoading(false)
  }

  async function removeProject() {
    const id = projectId
    const project = projects.find((item) => item.id === id)
    if (!id || !project || deletingProject) return
    if (deleteName.trim() !== project.name) return
    setDeletingProject(true)
    saveGenRef.current += 1
    timelineReadyRef.current = false
    window.clearTimeout(saveTimerRef.current)
    try {
      await deleteProject(id)
      clearActiveChat(id)
      const remaining = projects.filter((item) => item.id !== id)
      setProjects(remaining)
      setDeleteOpen(false)
      setDeleteName('')
      if (remaining[0]) await openProject(remaining[0].id)
      else resetWorkspace()
      setToast(`${project.name} deleted`)
    } catch (error) {
      setToast(errorMessage(error))
    } finally {
      setDeletingProject(false)
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
		setUploadPaused(false)
		const startedAt = Date.now()
    try {
			const total = files.reduce((sum, file) => sum + file.size, 0)
			setUploadStatus({ file: files[0].name, fileIndex: 0, fileCount: files.length, sent: 0, total, phase: 'uploading', startedAt })
			const task = uploadProjectMedia(projectId, files, (progress) => {
				setUploadStatus({
					...progress,
					phase: progress.phase ?? 'uploading',
					startedAt,
				})
			})
			uploadTaskRef.current = task
			await task.result
			const nextAssets = await refreshMedia(projectId)
			adoptTimeline(await getProjectTimeline(projectId), nextAssets)
      await refreshHistory(projectId)
      const latest = await listProjects()
      setProjects(latest)
      const totalBytes = files.reduce((sum, file) => sum + file.size, 0)
      setToast(`${files.length} ${files.length === 1 ? 'file' : 'files'} uploaded (${formatBytes(totalBytes)})`)
    } catch (error) {
			try {
				const nextAssets = await refreshMedia(projectId)
				adoptTimeline(await getProjectTimeline(projectId), nextAssets)
				await refreshHistory(projectId)
				setProjects(await listProjects())
			} catch { /* keep the upload error as the toast */ }
      setToast(errorMessage(error))
    } finally {
			uploadTaskRef.current = null
      setUploading(false)
			setUploadPaused(false)
      setUploadStatus(null)
      if (fileInput.current) fileInput.current.value = ''
    }
  }

	async function toggleUploadPause() {
		const task = uploadTaskRef.current
		if (!task) return
		if (uploadPaused) task.resume()
		else await task.pause()
		setUploadPaused(!uploadPaused)
	}

	async function cancelUpload() {
		await uploadTaskRef.current?.cancel()
	}

  async function retryFrom(index: number) {
    const list = messagesRef.current
    const userIndex = list[index]?.role === 'assistant'
      ? list.findLastIndex((message, i) => i < index && message.role === 'user')
      : index
    await regenerateFromUser(userIndex)
  }

  async function answerQuestions(messageId: string, sheetId: string, answers: QuestionAnswer[]) {
    if (pendingRef.current) {
      setToast('Wait for Director to finish')
      return
    }
    const message = messagesRef.current.find((m) => m.id === messageId)
    const sheet = message?.parts?.find((p): p is Extract<ChatPart, { kind: 'questions' }> => p.kind === 'questions' && p.sheet.id === sheetId)?.sheet
    if (!sheet) {
      setToast('Questions are no longer available')
      return
    }
    const text = formatAnswersMessage(sheet.questions, answers)
    if (!text.trim()) {
      setToast('Answer at least one question')
      return
    }
    const labels: Record<string, string[]> = {}
    for (const q of sheet.questions) {
      const answer = answers.find((a) => a.questionId === q.id)
      const picked = (answer?.selected ?? [])
        .map((id) => q.options.find((o) => o.id === id)?.label ?? id)
      if (answer?.custom?.trim()) picked.push(answer.custom.trim())
      labels[q.id] = picked
    }
    setMessages((current) => markQuestionsAnswered(current, messageId, sheetId, labels))
    await send(text)
  }

  async function skipQuestions(messageId: string, sheetId: string) {
    if (pendingRef.current) {
      setToast('Wait for Director to finish')
      return
    }
    setMessages((current) => markQuestionsAnswered(current, messageId, sheetId, {}))
    await send('Skipping those questions — please proceed with your best judgment.')
  }

  async function regenerateFromUser(userIndex: number, text?: string) {
    if (pendingRef.current) {
      setToast('Wait for Director to finish')
      return
    }
    const list = messagesRef.current
    const original = list[userIndex]
    if (!original || original.role !== 'user') {
      setToast('Nothing to regenerate from that message')
      return
    }
    const nextText = text !== undefined ? text.trim() : original.text
    if (!nextText && !original.images?.length) {
      setToast('Message is empty')
      return
    }
    const target = { ...original, text: nextText }
    const prior = list.slice(0, userIndex)
    const pathImages = (target.images ?? []).filter((image) => image.path)
    const dataImages = (target.images ?? []).flatMap((image) => {
      if (!image.url.startsWith('data:')) return []
      return [{ name: image.name || 'image', mime: image.mime || 'image/jpeg', data: image.url, preview: image.url }]
    })
    const history: HistoryMessage[] = [
      ...prior.map(toHistoryMessage),
      ...(pathImages.length || !dataImages.length ? [toHistoryMessage(target)] : []),
    ]
    await send(target.text, dataImages.length && !pathImages.length ? dataImages : undefined, {
      prior,
      user: target,
      history,
    })
  }

  async function send(
    text: string,
    images?: { name: string; mime: string; data: string; preview?: string }[],
    resume?: { prior: ChatMessage[]; user: ChatMessage; history: HistoryMessage[] },
  ) {
    const value = text.trim()
    const attached = (images ?? []).map(({ name, mime, data }) => ({ name, mime, data }))
    if ((!value && !attached.length && !resume) || pendingRef.current) {
      if (pendingRef.current) setToast('Wait for Director to finish')
      return
    }
    if (!projectId) {
      setToast('Create a project before using Director')
      return
    }
    await flushTimeline()
    if (dirtyRef.current) {
      setToast('Save the timeline before running Director')
      return
    }
    const userMsg: ChatMessage = resume?.user ?? {
      id: uid(),
      role: 'user',
      text: value,
      time: clock(),
      images: attached.map((image) => ({
        name: image.name,
        mime: image.mime,
        url: image.data,
      })),
    }
    const responseID = uid()
    const startedAt = Date.now()
    const replyTime = clock()
    abandonStream()
    const gen = streamGenRef.current
    const live = () => streamGenRef.current === gen
    const abortController = new AbortController()
    streamAbortRef.current = abortController
    const queue = createStreamTextQueue({
      onAppend(chunk) {
        if (!live()) return
        setMessages((current) => appendStreamText(current, responseID, chunk, replyTime))
      },
    })
    streamQueueRef.current = queue
    setMessages((m) => [
      ...(resume ? resume.prior : m),
      userMsg,
      { id: responseID, role: 'assistant', text: '', time: replyTime, parts: [] },
    ])
    activityRef.current = []
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
        images: attached,
        messages: resume?.history,
        thinkingEffort,
        signal: abortController.signal,
      }, (event) => {
        if (!live()) return
        if (event.type === 'session' && typeof event.data.session_id === 'string') {
          setSessionId(event.data.session_id)
          writeActiveChat(projectId, event.data.session_id)
        }
        if (event.type === 'chat_title' && typeof event.data.session_id === 'string' && typeof event.data.title === 'string') {
          const titledSessionID = event.data.session_id
          const generatedTitle = event.data.title
          setChats((current) => current.map((chat) => (
            chat.id === titledSessionID ? { ...chat, title: generatedTitle } : chat
          )))
        }
        if (event.type === 'text' && typeof event.data.delta === 'string') {
          // Preserve leading spaces between streamed tokens; whole-message
          // cleanup may trim once, but trimming every delta joins words.
          const visible = stripThoughtTags(event.data.delta)
          if (visible) queue.push(visible)
        }
        if (event.type === 'step' && event.data.phase === 'think') {
          const iteration = numberValue(event.data.iteration)
          queue.flush()
          const thinking: DirectorActivity = {
            id: `think-${iteration ?? activityRef.current.length}`,
            kind: 'thinking',
            status: 'active',
            title: iteration === 1 ? 'Planning the request' : 'Planning the next step',
            detail: 'Director is deciding what to inspect or change next.',
            iteration: iteration ?? undefined,
          }
          setMessages((current) => appendStreamActivity(current, responseID, thinking))
          setActivity((current) => {
            const next = [...current, thinking]
            activityRef.current = next
            return next
          })
        }
        if (event.type === 'thinking') {
          const next = applyThinkingActivity(activityRef.current, event.data)
          activityRef.current = next
        }
        if (event.type === 'step' && event.data.phase === 'act') {
          const iteration = numberValue(event.data.iteration)
          queue.flush()
          const action: DirectorActivity = {
            id: `act-${iteration ?? activityRef.current.length}`,
            kind: 'thinking',
            status: 'active',
            title: 'Executing the next action',
            detail: 'Director is applying the plan through its tools.',
            iteration: iteration ?? undefined,
          }
          setMessages((current) => appendStreamActivity(current, responseID, action))
          setActivity((current) => {
            const next = [...current, action]
            activityRef.current = next
            return next
          })
        }
        if (event.type === 'tool_call' && typeof event.data.name === 'string') {
          const toolID = typeof event.data.id === 'string' ? event.data.id : uid()
          const name = event.data.name
          queue.flush()
          const tool: DirectorActivity = {
            id: `tool-${toolID}`,
            kind: 'tool',
            status: 'active',
            title: toolLabel(name, event.data.arguments),
            name,
            arguments: event.data.arguments,
            iteration: numberValue(event.data.iteration) ?? undefined,
          }
          setMessages((current) => appendStreamActivity(current, responseID, tool))
          setActivity((current) => {
            const next = [...current, tool]
            activityRef.current = next
            return next
          })
          setToast(`Director is running ${name.replaceAll('_', ' ')}`)
        }
        if (event.type === 'tool_progress') {
          const toolID = typeof event.data.id === 'string' ? event.data.id : ''
          const id = `tool-${toolID}`
          const progress = {
            progressPhase: typeof event.data.phase === 'string' ? event.data.phase : undefined,
            progressPercent: numberValue(event.data.percent) ?? undefined,
            progressCurrent: numberValue(event.data.current) ?? undefined,
            progressTotal: numberValue(event.data.total) ?? undefined,
          }
          setActivity((current) => {
            const index = current.findIndex((item) => item.id === id)
            if (index < 0) return current
            const next = [...current]
            next[index] = { ...next[index], ...progress }
            activityRef.current = next
            return next
          })
          setMessages((current) => updateStreamActivity(current, responseID, {
            id,
            kind: 'tool',
            status: 'active',
            title: typeof event.data.name === 'string' ? toolLabel(event.data.name) : 'Downloading a YouTube video',
            ...progress,
          }))
        }
        if (event.type === 'tool_result') {
          const toolID = typeof event.data.id === 'string' ? event.data.id : ''
          const ok = event.data.ok === true
          const elapsedMs = numberValue(event.data.elapsed_ms) ?? undefined
          const error = typeof event.data.error === 'string' ? event.data.error : ''
          if (ok && typeof event.data.name === 'string' && MEDIA_GENERATION_TOOLS.has(event.data.name)) {
            void refreshMedia(projectId, { silent: true })
          }
          if (ok) {
            const stagedTimeline = timelineFromToolOutput(event.data.output)
            if (stagedTimeline) {
              adoptTimeline(stagedTimeline, assetsRef.current)
              const review = visualReviewFromToolOutput(event.data.output, projectId)
              if (review) {
                setVisualReview(review)
                setSelectedFindingId(review.findings[0]?.id ?? null)
              }
            }
          }
          setActivity((current) => {
            const index = current.findIndex((item) => item.id === `tool-${toolID}`)
            if (index < 0) {
              const next: DirectorActivity[] = [
                ...current,
                {
                  id: `tool-${toolID || uid()}`,
                  kind: 'tool',
                  status: ok ? 'success' : 'error',
                  title: typeof event.data.name === 'string' ? toolLabel(event.data.name, event.data.arguments) : 'Tool call',
                  detail: error || (ok ? 'Completed.' : 'The tool returned an error.'),
                  elapsedMs,
                },
              ]
              activityRef.current = next
              return next
            }
            const next = [...current]
            next[index] = {
              ...next[index],
              status: ok ? 'success' : 'error',
              detail: error || (ok ? 'Completed.' : 'The tool returned an error.'),
              elapsedMs,
            }
            activityRef.current = next
            return next
          })
          setMessages((current) => updateStreamActivity(current, responseID, {
            id: `tool-${toolID}`,
            kind: 'tool',
            status: ok ? 'success' : 'error',
            title: typeof event.data.name === 'string' ? toolLabel(event.data.name, event.data.arguments) : 'Tool call',
            detail: error || (ok ? 'Completed.' : 'The tool returned an error.'),
            elapsedMs,
          }))
        }
        if (event.type === 'questions') {
          queue.flush()
          const sheet = questionsFromEventData(event.data)
          if (sheet) {
            setMessages((current) => appendQuestionsPart(current, responseID, sheet))
            setToast('Director needs a few details')
          }
        }
        if (event.type === 'error' && typeof event.data.message === 'string') {
          const message = event.data.message
          streamError = message
          const errorID = `error-${uid()}`
          setActivity((current) => {
            const next = [
              ...current,
              { id: errorID, kind: 'tool' as const, status: 'error' as const, title: 'Director stopped with an error', detail: message },
            ]
            activityRef.current = next
            return next
          })
          queue.flush()
          setMessages((current) => appendStreamActivity(current, responseID, {
            id: errorID,
            kind: 'tool',
            status: 'error',
            title: 'Director stopped with an error',
            detail: message,
          }))
        }
        if (event.type === 'done') {
          const completed: DirectorActivity[] = activityRef.current.map((item) => (
            item.status === 'active' ? { ...item, status: 'success' } : item
          ))
          activityRef.current = completed
          setActivity(completed)
          setMessages((current) => completeStreamActivities(current, responseID))
        }
      })
      if (streamError) throw new Error(streamError)
      queue.end()
      await queue.idle()
      if (!live()) return
      setMessages((current) => finishStreamMessage(current, responseID, replyTime, {
        workedMs: Date.now() - startedAt,
        trace: activityRef.current,
      }))
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
      queue.fail()
      await queue.idle()
      if (!live()) return
      setMessages((current) => finishStreamMessage(current, responseID, replyTime, {
        text: streamErrorText(current, responseID, errorMessage(error)),
      }))
      void (async () => {
        const nextAssets = await refreshMedia(projectId, { silent: true })
        await loadTimeline(projectId, nextAssets ?? assetsRef.current)
      })()
    } finally {
      if (streamQueueRef.current === queue) streamQueueRef.current = null
      if (live()) {
        if (streamAbortRef.current === abortController) streamAbortRef.current = null
        setPending(false)
      }
    }
  }

  async function selectModel(id: string) {
    const nextID = typeof id === 'string' ? id.trim() : ''
    if (!nextID) return
    const previous = settingsRef.current
    setSettings((current) => current ? { ...current, active_id: nextID } : current)
    try {
      setSettings(normalizeSettings(await putSettings({ active_id: nextID, thinking_effort: thinkingEffort })))
    } catch (error) {
      setSettings(previous)
      setToast(errorMessage(error))
    }
  }

  function selectThinkingEffort(value: ThinkingEffort) {
    setThinkingEffort(value)
    writePref('parallax.thinkingEffort', value)
	const activeID = settingsRef.current?.active_id
	if (activeID) void putSettings({ active_id: activeID, thinking_effort: value }).then((raw) => setSettings(normalizeSettings(raw))).catch((error) => setToast(errorMessage(error)))
  }

  return (
    <LayoutGroup>
    <div className="chrome relative flex h-full min-w-[1100px] flex-col bg-ink text-cream">
      <TopBar
        projects={projects}
        projectId={projectId}
        projectName="No project"
        uploading={uploading}
        uploadLabel={buttonUploadLabel(uploadStatus)}
        uploadPercent={uploadStatus && uploadStatus.total > 0
          ? Math.min(100, Math.round((uploadStatus.sent / uploadStatus.total) * 100))
          : uploading ? 4 : 0}
        onProject={(id) => openProject(id)}
        onCreateProject={() => setCreateOpen(true)}
        onDeleteProject={() => {
          if (!projectId) {
            setToast('Create a project before deleting')
            return
          }
          setDeleteName('')
          setDeleteOpen(true)
        }}
        onUpload={() => fileInput.current?.click()}
        canUndo={!!history?.can_undo && !pending}
        canRedo={!!history?.redo_candidates?.length && !pending}
        onUndo={() => void undoLast()}
        onRedo={() => void redoLast()}
        onProjects={() => void returnToProjects()}
        exporting={exporting}
        onExport={() => {
          if (!projectId) {
            setToast('Create a project before exporting')
            return
          }
          setExportOpen(true)
        }}
      />
		<UploadProgressBar status={uploadStatus} paused={uploadPaused} onTogglePause={() => void toggleUploadPause()} onCancel={() => void cancelUpload()} />
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
                  projectId={projectId}
                  assets={assets}
                  loading={mediaLoading}
                  hasProject={!!projectId}
                  onDuration={(id, nextDuration) => applyMediaDuration(id, nextDuration)}
                  onFrame={(id, width, height) => applyMediaFrame(id, width, height)}
                  onAdd={(asset) => addAsset(asset)}
                  onDelete={(asset) => void deleteAsset(asset)}
                  onDescribe={(asset) => void describeAsset(asset)}
                  onGIFImported={() => {
                    if (projectId) {
                      void refreshMedia(projectId)
                      void refreshHistory(projectId)
                    }
                  }}
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
            seekToken={seekToken}
            isPlaying={isPlaying}
            muted={muted}
            safeArea={safeArea}
            program={program}
            audioClips={audioClips}
            grade={grade}
            duration={duration}
            projectId={projectId}
            timelineRevision={revision}
            inspectorClip={inspectorClip}
            onAudioVolume={setAudioVolume}
            onTogglePlay={() => setIsPlaying((p) => !p)}
            onSeek={seek}
            onToggleMute={() => setMuted((m) => !m)}
            onToggleSafe={() => setSafeArea((s) => !s)}
            visualReview={visualReview}
            visualReviewLoading={visualReviewLoading}
            visualReviewError={visualReviewError}
            selectedFindingId={selectedFindingId}
            onReviewFull={() => void reviewFull()}
            onSelectFinding={(finding) => {
              setSelectedFindingId(finding.id)
              seek(finding.time)
            }}
          />
          <Timeline
            clips={clips}
            selectedId={selectedId}
            linkedIds={selectedIds}
            currentTime={currentTime}
            isPlaying={isPlaying}
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
            reviewFindings={visualReview?.revision === revision ? visualReview.findings : []}
            onReviewFinding={(finding) => {
              setSelectedFindingId(finding.id)
              seek(finding.time)
            }}
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
                emptyHint={`${projects.find((item) => item.id === projectId)?.name ?? 'This project'} is ready. Upload media, ask me to generate a still, add it to the timeline, or inspect and transform project files.`}
                draft={draft}
                pending={pending}
                activity={activity}
                activityStartedAt={activityStartedAt}
                selected={selected}
                onDraft={setDraft}
                onSend={send}
                onRetry={(index) => void retryFrom(index)}
                onEdit={(index, text) => void regenerateFromUser(index, text)}
                onCollapse={() => setChatOpen(false)}
                onNewChat={() => void newChat()}
                onSelectChat={(id) => void openChat(projectId, id)}
                onDeleteChat={(id) => void removeChat(id)}
                models={settings?.profiles?.length ? settings.profiles : settings ? [{
                  id: settings.active_id || 'default',
                  label: settings.model,
                  base_url: settings.base_url,
                  model: settings.model,
                  api_key_set: settings.api_key_set,
                }] : []}
                modelId={settings?.active_id ?? ''}
                onModel={(id) => void selectModel(id)}
                thinkingEffort={thinkingEffort}
                onThinkingEffort={selectThinkingEffort}
                onAnswerQuestions={(messageId, sheetId, answers) => void answerQuestions(messageId, sheetId, answers)}
                onSkipQuestions={(messageId, sheetId) => void skipQuestions(messageId, sheetId)}
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
            hasCaptions={clips.some((clip) => clip.kind === 'caption')}
            busy={exporting}
            onClose={() => {
              if (!exporting) setExportOpen(false)
            }}
            onExport={(body) => void runExport(body)}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {deleteOpen && (
          <motion.div
            initial={reduce ? false : { opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={reduce ? undefined : { opacity: 0 }}
            className="absolute inset-0 z-[70] grid place-items-center bg-black/65 backdrop-blur-sm"
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-project-title"
            onPointerDown={(event) => {
              if (event.target === event.currentTarget && !deletingProject) {
                setDeleteOpen(false)
                setDeleteName('')
              }
            }}
          >
            <motion.form
              initial={reduce ? false : { opacity: 0, y: 10, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={reduce ? undefined : { opacity: 0, y: 8, scale: 0.98 }}
              onSubmit={(event) => {
                event.preventDefault()
                void removeProject()
              }}
              className="w-[420px] rounded-xl border border-line bg-panel p-5 shadow-2xl"
            >
              <h2 id="delete-project-title" className="text-[16px] font-medium text-cream">Delete this project</h2>
              <p className="mt-1 text-[12px] leading-relaxed text-mute">
                This permanently removes{' '}
                <span className="text-cream">
                  {projects.find((item) => item.id === projectId)?.name ?? 'this project'}
                </span>
                {' '}and everything in it: media, transcripts, embeddings, chats, timeline, and history. This cannot be undone.
              </p>
              <label className="mt-5 block text-[10px] tracking-[0.14em] text-dim uppercase">
                Type the project name to confirm
                <input
                  autoFocus
                  value={deleteName}
                  onChange={(event) => setDeleteName(event.target.value)}
                  maxLength={120}
                  placeholder={projects.find((item) => item.id === projectId)?.name ?? 'Project name'}
                  className="mt-2 h-10 w-full rounded-lg border border-line bg-well px-3 text-[13px] normal-case tracking-normal text-cream outline-none placeholder:text-dim focus:border-line-strong"
                />
              </label>
              <div className="mt-5 flex justify-end gap-2">
                <button
                  type="button"
                  disabled={deletingProject}
                  onClick={() => {
                    setDeleteOpen(false)
                    setDeleteName('')
                  }}
                  className="h-9 rounded-md px-3 text-[12px] text-mute hover:bg-wash hover:text-cream"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={
                    deletingProject
                    || deleteName.trim() !== (projects.find((item) => item.id === projectId)?.name ?? '')
                  }
                  className="h-9 rounded-md bg-mark px-4 text-[12px] font-medium text-plate disabled:opacity-40"
                >
                  {deletingProject ? 'Deleting…' : 'Delete forever'}
                </button>
              </div>
            </motion.form>
          </motion.div>
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

function buttonUploadLabel(status: UploadStatus | null) {
  if (!status) return 'Uploading…'
	if (status.phase === 'finalizing') {
		return status.fileCount > 1 ? `${status.completedFiles ?? 0}/${status.fileCount} · Finalizing` : 'Finalizing…'
  }
	if (status.phase === 'paused') return 'Paused'
  const pct = Math.min(100, Math.round((status.sent / Math.max(status.total, 1)) * 100))
	return status.fileCount > 1 ? `${status.completedFiles ?? 0}/${status.fileCount} · ${pct}%` : `${pct}%`
}

function uid() {
  return Math.random().toString(36).slice(2, 9)
}

function numberValue(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function toolLabel(name: string, args?: unknown) {
  if (name === 'generate_image' && imageToolHasSource(args)) return 'Editing an image'
  const labels: Record<string, string> = {
    search_web: 'Searching the web',
    download_youtube_video: 'Downloading a YouTube video',
    generate_image: 'Generating an image',
    search_images: 'Searching stills',
    search_gifs: 'Searching GIFs',
    import_gif: 'Adding GIF to media',
    get_image_caption: 'Reading the still description',
    search_scenes: 'Searching video shots',
    get_video_scenes: 'Reading video scenes',
    search_transcript: 'Searching the transcript',
    get_transcript: 'Reading the transcript',
    add_captions: 'Adding captions',
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
    ask_questions: 'Asking for details',
    polish_audio: 'Polishing audio',
    remove_dead_air: 'Removing dead air',
    audio_duck: 'Ducking music under speech',
    audio_cleanup: 'Reducing background noise',
    volume_leveling: 'Leveling loudness',
    reframe_clip: 'Reframing the clip',
  }
  return labels[name] ?? name.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function imageToolHasSource(args: unknown) {
  let value = args
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value) as unknown
    } catch {
      return false
    }
  }
  if (!value || typeof value !== 'object') return false
  const body = value as Record<string, unknown>
  if (typeof body.source === 'string' && body.source.trim()) return true
  if (typeof body.path === 'string' && body.path.trim()) return true
  if (typeof body.image === 'string' && body.image.trim()) return true
  if (typeof body.images === 'string' && body.images.trim()) return true
  return Array.isArray(body.images) && body.images.some((item) => typeof item === 'string' && item.trim())
}

function toMediaAsset(item: ProjectMedia): MediaAsset | null {
  if (item.kind === 'subtitle') return null
  const url = mediaURL(item)
  const kind = item.kind === 'audio' ? 'audio' : 'video'
  const mediaType = item.kind === 'image' ? 'image' : item.kind === 'audio' ? 'audio' : 'video'
  const measured = item.duration && item.duration > 0 ? item.duration : 0
  return {
    id: `project-${item.id}`,
	assetId: item.id,
    name: item.name,
    kind,
    duration: measured || (item.kind === 'image' ? 5 : 0),
    thumb: item.kind === 'image' ? url : (item.preview?.poster_path ? API_BASE + item.preview.poster_path : undefined),
    src: item.preview?.state === 'ready' && item.preview.url_path ? API_BASE + item.preview.url_path : url,
    path: item.path,
    mediaType,
    width: item.width && item.width > 0 ? item.width : undefined,
    height: item.height && item.height > 0 ? item.height : undefined,
    indexState: item.transcript?.state,
    indexError: item.transcript?.error,
    indexProgress: item.transcript?.progress,
    indexTimings: item.transcript?.timings,
    indexStartedAt: item.transcript?.started_at,
    indexStageStartedAt: item.transcript?.stage_started_at,
    previewState: item.preview?.state,
    previewProgress: item.preview?.progress,
    previewError: item.preview?.error,
    previewReason: item.preview?.reason,
    previewPoster: item.preview?.poster_path ? API_BASE + item.preview.poster_path : undefined,
    timelineFrames: item.preview?.timeline_frames?.map((frame) => API_BASE + frame),
    timelinePending: item.preview?.timeline_pending,
    previewEncoder: item.preview?.encoder,
    previewDevice: item.preview?.device,
    previewHardware: item.preview?.hardware,
    previewPipeline: item.preview?.pipeline,
    previewTimings: item.preview?.timings,
    previewStartedAt: item.preview?.started_at,
    canDescribe: item.transcript?.can_describe === true,
    origin: item.origin === 'gif' || looksLikeGIFImport(item.name) ? 'gif' : undefined,
    hasAudio: item.has_audio,
  }
}

function looksLikeGIFImport(name: string) {
  return /(?:-gif\.(?:mp4|webm)|\.gif(?:\.|$))/i.test(name)
}

const INDEX_BUSY: MediaIndexState[] = ['queued', 'transcribing', 'translating', 'describing', 'indexing']

function indexBusy(state?: MediaIndexState) {
  return Boolean(state && INDEX_BUSY.includes(state))
}

function previewBusy(asset: MediaAsset) {
  return asset.previewState === 'queued' || asset.previewState === 'building' || asset.timelinePending === true
}

function toHistoryMessage(message: ChatMessage): HistoryMessage {
  return {
    role: message.role,
    content: message.role === 'assistant' ? stripThoughtMarkup(message.text) : message.text,
    images: (message.images ?? []).flatMap((image) => {
      if (!image.path) return []
      return [{ name: image.name, mime: image.mime, path: image.path }]
    }),
  }
}

function appendStreamText(messages: ChatMessage[], id: string, chunk: string, time: string): ChatMessage[] {
  const index = messages.findIndex((message) => message.id === id)
  if (index < 0) {
    return [...messages, {
      id,
      role: 'assistant',
      text: chunk,
      time,
      parts: [{ id: `text-${uid()}`, kind: 'text', text: chunk }],
    }]
  }
  const next = [...messages]
  const message = next[index]
  const parts = [...(message.parts ?? [])]
  const last = parts[parts.length - 1]
  if (last?.kind === 'text') {
    parts[parts.length - 1] = { ...last, text: last.text + chunk }
  } else {
    parts.push({ id: `text-${uid()}`, kind: 'text', text: chunk })
  }
  next[index] = { ...message, text: message.text + chunk, parts }
  return next
}

function appendStreamActivity(messages: ChatMessage[], id: string, activity: DirectorActivity): ChatMessage[] {
  const index = messages.findIndex((message) => message.id === id)
  if (index < 0) return messages
  const next = [...messages]
  const message = next[index]
  next[index] = {
    ...message,
    parts: [...(message.parts ?? []), { id: `activity-${activity.id}`, kind: 'activity', activity }],
  }
  return next
}

function updateStreamActivity(messages: ChatMessage[], id: string, activity: DirectorActivity): ChatMessage[] {
  const index = messages.findIndex((message) => message.id === id)
  if (index < 0) return messages
  const next = [...messages]
  const message = next[index]
  const parts = [...(message.parts ?? [])]
  const partIndex = parts.findIndex((part): part is Extract<ChatPart, { kind: 'activity' }> => (
    part.kind === 'activity' && part.activity.id === activity.id
  ))
  if (partIndex < 0) return messages
  const previous = parts[partIndex]
  if (previous.kind !== 'activity') return messages
  parts[partIndex] = { ...previous, activity: { ...previous.activity, ...activity } }
  next[index] = { ...message, parts }
  return next
}

function completeStreamActivities(messages: ChatMessage[], id: string): ChatMessage[] {
  const index = messages.findIndex((message) => message.id === id)
  if (index < 0) return messages
  const next = [...messages]
  const message = next[index]
  const parts = (message.parts ?? []).map((part) => part.kind === 'activity' && part.activity.status === 'active'
    ? { ...part, activity: { ...part.activity, status: 'success' as const } }
    : part)
  next[index] = { ...message, parts }
  return next
}

function appendQuestionsPart(messages: ChatMessage[], id: string, sheet: QuestionSheet): ChatMessage[] {
  const index = messages.findIndex((message) => message.id === id)
  if (index < 0) return messages
  const next = [...messages]
  const message = next[index]
  next[index] = {
    ...message,
    parts: [...(message.parts ?? []), { id: `questions-${sheet.id}`, kind: 'questions', sheet }],
  }
  return next
}

function markQuestionsAnswered(
  messages: ChatMessage[],
  messageId: string,
  sheetId: string,
  answers: Record<string, string[]>,
): ChatMessage[] {
  return messages.map((message) => {
    if (message.id !== messageId || !message.parts) return message
    return {
      ...message,
      parts: message.parts.map((part) => part.kind === 'questions' && part.sheet.id === sheetId
        ? { ...part, sheet: { ...part.sheet, answered: true, answers } }
        : part),
    }
  })
}

function questionsFromEventData(data: Record<string, unknown>): QuestionSheet | null {
  const id = typeof data.id === 'string' && data.id ? data.id : uid()
  const raw = Array.isArray(data.questions) ? data.questions : []
  const questions: ClarifyingQuestion[] = []
  for (let i = 0; i < raw.length && i < 4; i++) {
    const item = raw[i] as Record<string, unknown>
    if (!item || typeof item !== 'object') continue
    const qid = typeof item.id === 'string' && item.id.trim() ? item.id : `q${i + 1}`
    const question = typeof item.question === 'string' ? item.question : ''
    const options = Array.isArray(item.options)
      ? (item.options as unknown[]).flatMap((opt, j) => {
          if (!opt || typeof opt !== 'object') return []
          const o = opt as Record<string, unknown>
          const oid = typeof o.id === 'string' && o.id.trim() ? o.id : `q${i + 1}_o${j + 1}`
          const label = typeof o.label === 'string' ? o.label : ''
          return label.trim() ? [{ id: oid, label }] : []
        })
      : []
    if (!question.trim() || options.length < 2) continue
    questions.push({
      id: qid,
      question,
      options,
      allow_custom: item.allow_custom !== false,
      multi_select: item.multi_select === true,
    })
  }
  if (!questions.length) return null
  return { id, questions, answered: false }
}

function questionsFromTrace(events?: AgentEvent[]): QuestionSheet[] {
  if (!events?.length) return []
  const sheets: QuestionSheet[] = []
  for (const event of events) {
    if (event.type !== 'questions') continue
    const sheet = questionsFromEventData(event.data)
    if (sheet) sheets.push({ ...sheet, answered: true, answers: {} })
  }
  return sheets
}

function formatAnswersMessage(questions: ClarifyingQuestion[], answers: QuestionAnswer[]): string {
  const lines: string[] = []
  for (const q of questions) {
    const answer = answers.find((a) => a.questionId === q.id)
    if (!answer) continue
    const picked = (answer.selected ?? [])
      .map((oid) => q.options.find((o) => o.id === oid)?.label ?? oid)
      .filter(Boolean)
    if (answer.custom?.trim()) picked.push(`"${answer.custom.trim()}"`)
    if (!picked.length) continue
    lines.push(`- ${q.question} [${q.id}]: ${picked.join('; ')}`)
  }
  if (!lines.length) return ''
  return `My answers to your questions:\n${lines.join('\n')}`
}

function finishStreamMessage(
  messages: ChatMessage[],
  id: string,
  time: string,
  patch: Partial<ChatMessage>,
): ChatMessage[] {
  const index = messages.findIndex((message) => message.id === id)
  const fallback = patch.text ?? (index < 0 || !messages[index].text
    ? 'The operation completed without a written summary.'
    : undefined)
  const nextPatch = fallback != null ? { ...patch, text: fallback } : patch
  if (index < 0) {
    const text = nextPatch.text ?? ''
    return [...messages, {
      id,
      role: 'assistant',
      text,
      time,
      ...nextPatch,
      ...(text ? { parts: [{ id: `text-${uid()}`, kind: 'text' as const, text }] } : {}),
    }]
  }
  const next = [...messages]
  const previous = next[index]
  const updated = { ...previous, ...nextPatch }
  if (nextPatch.text != null && nextPatch.text !== previous.text) {
    const parts = [...(previous.parts ?? [])]
    const last = parts[parts.length - 1]
    const appended = previous.text && nextPatch.text.startsWith(previous.text)
      ? nextPatch.text.slice(previous.text.length)
      : nextPatch.text
    if (appended) {
      if (last?.kind === 'text') {
        parts[parts.length - 1] = { ...last, text: last.text + appended }
      } else {
        parts.push({ id: `text-${uid()}`, kind: 'text', text: appended })
      }
      updated.parts = parts
    }
  }
  next[index] = updated
  return next
}

function streamErrorText(messages: ChatMessage[], id: string, detail: string) {
  const existing = messages.find((message) => message.id === id)?.text.trim()
  const note = `I couldn't complete that: ${detail}`
  return existing ? `${existing}\n\n${note}` : note
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
    .filter((message) => message.content.trim() || (message.images && message.images.length > 0))
    .map((message) => {
      const sheets = questionsFromTrace(message.trace_events)
      const parts: ChatPart[] | undefined = sheets.length
        ? [
            ...(message.content.trim() ? [{ id: `text-${uid()}`, kind: 'text' as const, text: message.content }] : []),
            ...sheets.map((sheet) => ({ id: `questions-${sheet.id}`, kind: 'questions' as const, sheet })),
          ]
        : undefined
      return {
        id: uid(),
        role: message.role,
        text: message.content,
        time: '',
        images: (message.images ?? []).flatMap((image) => {
          const url = image.url ? API_BASE + image.url : ''
          return url ? [{ name: image.name, mime: image.mime, path: image.path, url }] : []
        }),
        workedMs: message.worked_ms,
        trace: activityFromTrace(message.trace_events),
        ...(parts ? { parts } : {}),
      }
    })
}

function applyThinkingActivity(items: DirectorActivity[], data: Record<string, unknown>): DirectorActivity[] {
  const iteration = numberValue(data.iteration)
  const delta = typeof data.delta === 'string' ? data.delta : ''
  const text = typeof data.text === 'string' ? data.text : ''
  if (!delta && !text) return items
  const id = `think-${iteration ?? items.length}`
  const index = items.findIndex((item) => item.id === id || (item.kind === 'thinking' && item.iteration === iteration && iteration != null))
  const previous = index >= 0 ? items[index].detail ?? '' : ''
  const detail = stripThoughtMarkup(text || `${placeholderThought(previous) ? '' : previous}${delta}`)
  const next: DirectorActivity = {
    id: index >= 0 ? items[index].id : id,
    kind: 'thinking',
    status: index >= 0 ? items[index].status : 'active',
    title: 'Thinking',
    detail,
    iteration: iteration ?? items[index]?.iteration,
  }
  if (index < 0) return [...items, next]
  const copy = [...items]
  copy[index] = { ...items[index], ...next }
  return copy
}

function placeholderThought(value: string) {
  return !value.trim() || /^Director (is deciding|decided|is applying)/.test(value)
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
    if (event.type === 'thinking') {
      const next = applyThinkingActivity(items, data)
      items.length = 0
      items.push(...next)
      continue
    }
    if (event.type === 'tool_call' && typeof data.name === 'string') {
      items.push({
        id: `tool-${typeof data.id === 'string' ? data.id : items.length}`,
        kind: 'tool',
        status: 'success',
        title: toolLabel(data.name, data.arguments),
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
          title: typeof data.name === 'string' ? toolLabel(data.name, data.arguments) : 'Tool call',
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

function timelineFromToolOutput(value: unknown): Awaited<ReturnType<typeof getProjectTimeline>> | null {
  if (!value || typeof value !== 'object') return null
  const timeline = (value as Record<string, unknown>).timeline
  if (!timeline || typeof timeline !== 'object') return null
  const candidate = timeline as Record<string, unknown>
  if (!Array.isArray(candidate.clips)) return null
  return timeline as Awaited<ReturnType<typeof getProjectTimeline>>
}

function visualReviewFromToolOutput(value: unknown, projectId: string): VisualReview | null {
  if (!value || typeof value !== 'object') return null
  const review = (value as Record<string, unknown>).visual_review
  if (!review || typeof review !== 'object') return null
  const candidate = review as Record<string, unknown>
  if (!Array.isArray(candidate.findings) || !Array.isArray(candidate.frames)) return null
  const frames = candidate.frames.map((frame) => {
    if (!frame || typeof frame !== 'object') return frame
    const item = frame as Record<string, unknown>
    const path = typeof item.path === 'string' ? item.path : ''
    if (!path || path.startsWith('http://') || path.startsWith('https://')) return frame
    const encoded = path.split('/').filter(Boolean).map(encodeURIComponent).join('/')
    return { ...item, path: `${API_BASE}/v1/projects/${encodeURIComponent(projectId)}/files/${encoded}` }
  })
  return normalizeVisualReview({ ...(review as VisualReview), frames })
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
      && next.previewState === clip.previewState
      && next.previewProgress === clip.previewProgress
      && next.previewError === clip.previewError
      && next.previewReason === clip.previewReason
      && next.previewPoster === clip.previewPoster
      && (next.timelineFrames ?? []).join('\n') === (clip.timelineFrames ?? []).join('\n')
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

function clearActiveChat(projectID: string) {
  try {
    localStorage.removeItem(activeChatKey(projectID))
  } catch {
    // ignore quota / private mode
  }
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
