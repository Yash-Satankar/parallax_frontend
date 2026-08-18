import type { TimelineDocument } from './timeline'

export const API_BASE = (import.meta.env.VITE_API_URL ?? 'http://localhost:8080').replace(/\/$/, '')

export type ProjectRecord = {
  id: string
  name: string
  created_at: string
  updated_at: string
  media_count: number
}

export type TranscriptIndexState =
  | 'queued'
  | 'transcribing'
  | 'translating'
  | 'describing'
  | 'indexing'
  | 'ready'
  | 'index_failed'
  | 'failed'
  | 'skipped'

export type TranscriptIndexStatus = {
  path: string
  state: TranscriptIndexState
  hash?: string
  error?: string
  progress?: string
  at?: number
  duration?: number
  updated_at: string
}

export type ProjectMedia = {
  id: string
  name: string
  path: string
  kind: 'video' | 'audio' | 'image' | 'subtitle' | 'file'
  content_type: string
  content_url: string
  bytes: number
  duration?: number
  width?: number
  height?: number
  modified_at: string
  transcript?: TranscriptIndexStatus
}

export type ChatRecord = {
  id: string
  title: string
  created_at: string
  updated_at: string
}

export type ChatImageRecord = {
  name?: string
  mime?: string
  path?: string
  url?: string
}

export type SavedChatMessage = {
  role: 'user' | 'assistant'
  content: string
  images?: ChatImageRecord[]
  worked_ms?: number
  trace_events?: AgentEvent[]
}

export type AgentEvent = {
  type: string
  data: Record<string, unknown>
}

export type ThinkingEffort = 'low' | 'medium' | 'high'

export const DEFAULT_THINKING_EFFORT: ThinkingEffort = 'medium'

export function normalizeThinkingEffort(value: string | null | undefined): ThinkingEffort {
  return value === 'low' || value === 'high' ? value : DEFAULT_THINKING_EFFORT
}

export type LLMProfile = {
  id: string
  label?: string
  base_url: string
  model: string
  api_key_set: boolean
}

export type LLMSettings = {
  active_id: string
  base_url: string
  model: string
  api_key_set: boolean
  profiles: LLMProfile[]
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(API_BASE + path, init)
  if (!response.ok) {
    const body = await response.json().catch(() => ({})) as { error?: string }
    throw new Error(body.error || `Request failed (${response.status})`)
  }
  return response.json() as Promise<T>
}

export async function listProjects() {
  const result = await request<{ projects: ProjectRecord[] }>('/v1/projects')
  return result.projects ?? []
}

export function createProject(name: string) {
  return request<ProjectRecord>('/v1/projects', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  })
}

export async function deleteProject(projectID: string) {
  const response = await fetch(`${API_BASE}/v1/projects/${projectID}`, { method: 'DELETE' })
  if (!response.ok && response.status !== 204) {
    const body = await response.json().catch(() => ({})) as { error?: string }
    throw new Error(body.error || `Request failed (${response.status})`)
  }
}

export type MediaSearchHit = {
  path?: string
  name?: string
  kind?: string
  score?: number
  text_en?: string
  spoken_en?: string
  start?: number
  end?: number
  scene_id?: string
}

export async function searchProjectMedia(projectID: string, query: string, limit = 24) {
  const q = query.trim()
  if (!q) return [] as MediaSearchHit[]
  const result = await request<{ results?: MediaSearchHit[] }>(
    `/v1/projects/${projectID}/media/search?q=${encodeURIComponent(q)}&limit=${limit}`,
  )
  return result.results ?? []
}

export async function listProjectMedia(projectID: string) {
  const result = await request<{ media: ProjectMedia[] }>(`/v1/projects/${projectID}/media`)
  return result.media ?? []
}

export async function uploadProjectMedia(projectID: string, files: File[]) {
  const form = new FormData()
  files.forEach((file) => form.append('files', file))
  const result = await request<{ media: ProjectMedia[] }>(`/v1/projects/${projectID}/media`, {
    method: 'POST',
    body: form,
  })
  return result.media
}

export function mediaURL(item: ProjectMedia) {
  return API_BASE + item.content_url
}

export type ExportFormat = 'mp4' | 'mov' | 'webm' | 'gif' | 'mp3'
export type ExportQuality = 'draft' | 'standard' | 'high' | 'original'
export type ExportResolution = 'source' | '3840x2160' | '1920x1080' | '1280x720' | '854x480'
export type ExportCaptions = 'soft' | 'burn' | 'none'

export type ExportRequest = {
  source: string
  format: ExportFormat
  quality: ExportQuality
  resolution: ExportResolution
  fps: number
  audio: boolean
  start?: number
  duration?: number
  filename: string
  captions?: ExportCaptions
}

export type ExportResult = {
  media: ProjectMedia
  download_url: string
}

export function exportProjectMedia(projectID: string, body: ExportRequest) {
  return request<ExportResult>(`/v1/projects/${projectID}/export`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

export async function downloadProjectFile(contentURL: string, filename: string) {
  const response = await fetch(API_BASE + contentURL)
  if (!response.ok) {
    const body = await response.json().catch(() => ({})) as { error?: string }
    throw new Error(body.error || `Download failed (${response.status})`)
  }
  const blob = await response.blob()
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.append(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export async function deleteProjectMedia(projectID: string, path: string) {
  const encoded = path.split('/').filter(Boolean).map(encodeURIComponent).join('/')
  const response = await fetch(`${API_BASE}/v1/projects/${projectID}/files/${encoded}`, { method: 'DELETE' })
  if (!response.ok && response.status !== 204) {
    const body = await response.json().catch(() => ({})) as { error?: string }
    throw new Error(body.error || `Request failed (${response.status})`)
  }
}

export async function listProjectChats(projectID: string) {
  const result = await request<{ chats: ChatRecord[] }>(`/v1/projects/${projectID}/chats`)
  return result.chats ?? []
}

export function createProjectChat(projectID: string, title = '') {
  return request<ChatRecord>(`/v1/projects/${projectID}/chats`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title }),
  })
}

export async function getProjectChat(projectID: string, chatID: string) {
  const chat = await request<ChatRecord & { messages?: SavedChatMessage[] }>(`/v1/projects/${projectID}/chats/${chatID}`)
  return { ...chat, messages: chat.messages ?? [] }
}

export function renameProjectChat(projectID: string, chatID: string, title: string) {
  return request<ChatRecord>(`/v1/projects/${projectID}/chats/${chatID}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title }),
  })
}

export async function deleteProjectChat(projectID: string, chatID: string) {
  const response = await fetch(`${API_BASE}/v1/projects/${projectID}/chats/${chatID}`, { method: 'DELETE' })
  if (!response.ok && response.status !== 204) {
    const body = await response.json().catch(() => ({})) as { error?: string }
    throw new Error(body.error || `Request failed (${response.status})`)
  }
}

export type { TimelineDocument, TimelineClipRecord, TimelineTransition } from './timeline'

export function getProjectTimeline(projectID: string) {
  return request<TimelineDocument>(`/v1/projects/${projectID}/timeline`)
}

export function putProjectTimeline(
  projectID: string,
  body: TimelineDocument,
  opts?: { keepalive?: boolean; expectedRevision?: number; summary?: string },
) {
  const query = new URLSearchParams()
  if (opts?.expectedRevision != null) query.set('expected_revision', String(opts.expectedRevision))
  if (opts?.summary) query.set('summary', opts.summary)
  const suffix = query.size ? `?${query.toString()}` : ''
  return request<TimelineDocument>(`/v1/projects/${projectID}/timeline${suffix}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    keepalive: opts?.keepalive,
  })
}

export type ProjectRevision = { id:number; parent_id?:number; actor:'human'|'agent'|'system'; summary:string; chat_id?:string; created_at:string; children?:number[]; checkpoints?:string[] }
export type ProjectHistory = { head:number; can_undo:boolean; redo_candidates:number[]; revisions:ProjectRevision[] }

export async function getProjectHistory(projectID: string) {
  return normalizeProjectHistory(await request<Partial<ProjectHistory>>(`/v1/projects/${projectID}/history`))
}
export function undoProject(projectID: string, expectedRevision: number) {
  return request<TimelineDocument>(`/v1/projects/${projectID}/history/undo`, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({expected_revision:expectedRevision, target_revision:-1}) })
}
export function redoProject(projectID: string, expectedRevision: number, targetRevision = -1) {
  return request<TimelineDocument>(`/v1/projects/${projectID}/history/redo`, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({expected_revision:expectedRevision, target_revision:targetRevision}) })
}
export function restoreProjectRevision(projectID: string, expectedRevision: number, targetRevision: number) {
  return request<TimelineDocument>(`/v1/projects/${projectID}/history/restore`, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({expected_revision:expectedRevision, target_revision:targetRevision}) })
}
export async function createProjectCheckpoint(projectID: string, name: string, revision: number) {
  const result = await request<Partial<ProjectHistory>>(`/v1/projects/${projectID}/checkpoints`, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({name, revision}) })
  return normalizeProjectHistory(result)
}

function normalizeProjectHistory(raw: Partial<ProjectHistory> | null | undefined): ProjectHistory {
  return {
    head: Number.isInteger(raw?.head) ? raw?.head ?? 0 : 0,
    can_undo: raw?.can_undo === true,
    redo_candidates: Array.isArray(raw?.redo_candidates) ? raw.redo_candidates : [],
    revisions: Array.isArray(raw?.revisions) ? raw.revisions : [],
  }
}

export function getSettings() {
  return request<LLMSettings>('/v1/settings')
}

export function putSettings(body: { active_id: string }) {
  return request<LLMSettings>('/v1/settings', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

export function normalizeSettings(raw: Partial<LLMSettings> | null | undefined): LLMSettings {
  const baseURL = raw?.base_url ?? ''
  const model = raw?.model ?? ''
  const apiKeySet = !!raw?.api_key_set
  if (raw?.profiles?.length) {
    return {
      active_id: raw.active_id || raw.profiles[0].id,
      base_url: baseURL || raw.profiles[0].base_url,
      model: model || raw.profiles[0].model,
      api_key_set: apiKeySet || raw.profiles[0].api_key_set,
      profiles: raw.profiles,
    }
  }
  const fallback: LLMProfile = {
    id: raw?.active_id || 'default',
    base_url: baseURL,
    model,
    api_key_set: apiKeySet,
  }
  return {
    active_id: fallback.id,
    base_url: fallback.base_url,
    model: fallback.model,
    api_key_set: fallback.api_key_set,
    profiles: fallback.model || fallback.base_url ? [fallback] : [],
  }
}

export function profileLabel(profile: Pick<LLMProfile, 'label' | 'model' | 'base_url'>) {
  if (profile.label?.trim()) return profile.label.trim()
  if (profile.model?.trim()) return profile.model.trim()
  try {
    return new URL(profile.base_url).host
  } catch {
    return 'Untitled model'
  }
}

export type HistoryMessage = {
  role: 'user' | 'assistant'
  content: string
  images?: { name?: string; mime?: string; path?: string }[]
}

export async function streamAgent(
  input: {
    projectID: string
    sessionID?: string
    profileID?: string
    message: string
    images?: { name: string; mime: string; data: string }[]
    messages?: HistoryMessage[]
    thinkingEffort?: ThinkingEffort
  },
  onEvent: (event: AgentEvent) => void,
) {
  const response = await fetch(API_BASE + '/v1/agent/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
    body: JSON.stringify({
      project_id: input.projectID,
      session_id: input.sessionID || undefined,
      profile_id: input.profileID || undefined,
      message: input.message,
      images: input.images?.length ? input.images : undefined,
      messages: input.messages?.length ? input.messages : undefined,
      thinking_effort: input.thinkingEffort || DEFAULT_THINKING_EFFORT,
    }),
  })
  if (!response.ok) {
    const body = await response.json().catch(() => ({})) as { error?: string }
    throw new Error(body.error || `Director request failed (${response.status})`)
  }
  if (!response.body) throw new Error('Director stream is unavailable')

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  while (true) {
    const { value, done } = await reader.read()
    buffer += decoder.decode(value, { stream: !done })
    const blocks = buffer.split(/\r?\n\r?\n/)
    buffer = blocks.pop() ?? ''
    for (const block of blocks) {
      let type = 'message'
      const data: string[] = []
      for (const line of block.split(/\r?\n/)) {
        if (line.startsWith('event:')) type = line.slice(6).trim()
        if (line.startsWith('data:')) data.push(line.slice(5).trim())
      }
      if (!data.length) continue
      onEvent({ type, data: JSON.parse(data.join('\n')) as Record<string, unknown> })
    }
    if (done) break
  }
}
