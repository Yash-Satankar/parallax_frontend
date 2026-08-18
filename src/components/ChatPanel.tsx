import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from 'react'
import { ArrowUp, Brain, Check, ChevronDown, ChevronRight, CircleAlert, Copy, ImagePlus, LoaderCircle, Pencil, Plus, PanelRightClose, RotateCcw, Trash2, Wrench, X } from 'lucide-react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import type { ChatMessage, Clip, DirectorActivity } from '../types'
import type { ChatRecord, LLMProfile, ThinkingEffort } from '../lib/api'
import { profileLabel } from '../lib/api'
import { filesToChatImages, type ChatImagePayload } from '../lib/chatImage'
import { formatRange } from '../lib/time'
import { cn } from '../lib/cn'
import { fade, softSpring } from '../lib/motion'
import { stripThoughtMarkup, thoughtPreview } from '../lib/thought'
import { MarkdownText } from './MarkdownText'
import { Select, SelectContent, SelectItem, SelectTrigger } from './Select'

type Props = {
  width: number
  messages: ChatMessage[]
  chats: ChatRecord[]
  chatId: string
  emptyHint: string
  draft: string
  pending: boolean
  activity: DirectorActivity[]
  activityStartedAt: number | null
  selected: Clip | undefined
  onDraft: (value: string) => void
  onSend: (text: string, images?: ChatImagePayload[]) => void
  onRetry?: (index: number) => void
  onEdit?: (index: number, text: string) => void
  onCollapse: () => void
  onNewChat: () => void
  onSelectChat: (id: string) => void
  onDeleteChat: (id: string) => void
  models?: LLMProfile[]
  modelId?: string
  onModel?: (id: string) => void
  thinkingEffort: ThinkingEffort
  onThinkingEffort: (value: ThinkingEffort) => void
}

export function ChatPanel({
  width,
  messages,
  chats,
  chatId,
  emptyHint,
  draft,
  pending,
  activity,
  activityStartedAt,
  selected,
  onDraft,
  onSend,
  onRetry,
  onEdit,
  onCollapse,
  onNewChat,
  onSelectChat,
  onDeleteChat,
  models = [],
  modelId = '',
  onModel,
  thinkingEffort,
  onThinkingEffort,
}: Props) {
  const reduce = useReducedMotion()
  const scroller = useRef<HTMLDivElement>(null)
  const lastPinnedUserId = useRef<string | undefined>(undefined)
  const lastPinnedChatId = useRef(chatId)
  const wasPending = useRef(pending)
  const fileInput = useRef<HTMLInputElement>(null)
  const [editingIndex, setEditingIndex] = useState<number | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const [attachments, setAttachments] = useState<ChatImagePayload[]>([])
  const [dragOver, setDragOver] = useState(false)
  const [announcement, setAnnouncement] = useState('')
  const menu = useRef<HTMLDivElement>(null)
  const active = chats.find((chat) => chat.id === chatId)
  const activeModel = models.find((model) => model.id === modelId) ?? models[0]
  const canSend = Boolean(draft.trim() || attachments.length) && !pending
  const lastMessage = messages[messages.length - 1]
  const replyStarted = lastMessage?.role === 'assistant' && Boolean(lastMessage.text)
  const showTyping = pending && !replyStarted && activity.length === 0

  useEffect(() => {
    setEditingIndex(null)
  }, [chatId])

  useEffect(() => {
    if (pending) setEditingIndex(null)
  }, [pending])

  useEffect(() => {
    const lastUser = [...messages].reverse().find((message) => message.role === 'user')
    const chatChanged = lastPinnedChatId.current !== chatId
    const userChanged = Boolean(lastUser && lastUser.id !== lastPinnedUserId.current)
    lastPinnedChatId.current = chatId
    lastPinnedUserId.current = lastUser?.id
    if (!chatChanged && !userChanged) return
    const el = scroller.current
    if (!el) return
    el.scrollTop = el.scrollHeight
  }, [chatId, messages])

  useEffect(() => {
    if (wasPending.current && !pending) {
      const last = [...messages].reverse().find((message) => message.role === 'assistant')
      if (last?.text) setAnnouncement(last.text)
    }
    wasPending.current = pending
  }, [pending, messages])

  useEffect(() => {
    if (!menuOpen) return
    const onPointer = (event: MouseEvent) => {
      if (!menu.current?.contains(event.target as Node)) setMenuOpen(false)
    }
    window.addEventListener('mousedown', onPointer)
    return () => window.removeEventListener('mousedown', onPointer)
  }, [menuOpen])

  function submit(e: FormEvent) {
    e.preventDefault()
    send()
  }

  function send() {
    if (!canSend) return
    onSend(draft, attachments)
    setAttachments([])
  }

  function onKey(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      send()
    }
  }

  async function addFiles(files: File[]) {
    if (!files.length) return
    const next = await filesToChatImages(files)
    if (!next.length) return
    setAttachments((current) => [...current, ...next].slice(0, 6))
  }

  return (
    <aside className="chrome flex h-full w-full shrink-0 flex-col border-l border-line bg-panel" style={{ width }}>
      <div className="flex h-12 items-center justify-between border-b border-line px-4">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="relative grid size-6 shrink-0 place-items-center rounded-full border border-live/30">
            <motion.span
              className="size-1.5 rounded-full bg-live"
              animate={reduce ? undefined : { scale: [1, 1.18, 1], opacity: [0.75, 1, 0.75] }}
              transition={{ duration: 2.2, repeat: Infinity, ease: 'easeInOut' }}
            />
          </span>
          <div className="relative min-w-0" ref={menu}>
            <button
              type="button"
              onClick={() => setMenuOpen((open) => !open)}
              className="flex max-w-[190px] items-center gap-1 text-left"
              aria-haspopup="listbox"
              aria-expanded={menuOpen}
            >
              <span className="min-w-0">
                <span className="block text-[13px] font-medium">Director</span>
                <span className="block truncate text-[10px] tracking-wide text-mute uppercase">
                  {active?.title || 'New chat'}
                </span>
              </span>
              <ChevronDown size={12} className={cn('shrink-0 text-dim transition-transform', menuOpen && 'rotate-180')} />
            </button>
            <AnimatePresence>
              {menuOpen && (
                <motion.div
                  initial={reduce ? false : { opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={reduce ? undefined : { opacity: 0, y: -4 }}
                  transition={fade}
                  className="absolute top-full left-0 z-30 mt-2 w-[220px] overflow-hidden rounded-lg border border-line bg-panel shadow-[var(--toast-shadow)]"
                  role="listbox"
                >
                  <div className="max-h-56 overflow-y-auto py-1 scroll-thin">
                    {chats.length === 0 && (
                      <div className="px-3 py-2 text-[11px] text-dim">No saved chats yet</div>
                    )}
                    {chats.map((chat) => (
                      <div
                        key={chat.id}
                        className={cn(
                          'flex items-center gap-1 px-1.5 py-0.5',
                          chat.id === chatId && 'bg-wash',
                        )}
                      >
                        <button
                          type="button"
                          onClick={() => {
                            onSelectChat(chat.id)
                            setMenuOpen(false)
                          }}
                          className="min-w-0 flex-1 truncate rounded-md px-1.5 py-1.5 text-left text-[12px] text-cream hover:bg-wash"
                        >
                          {chat.title || 'New chat'}
                        </button>
                        <button
                          type="button"
                          aria-label={`Delete ${chat.title || 'chat'}`}
                          onClick={() => onDeleteChat(chat.id)}
                          className="grid size-7 shrink-0 place-items-center rounded-md text-dim hover:bg-wash hover:text-cream"
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                    ))}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
        <div className="flex items-center">
          <motion.button
            type="button"
            onClick={() => {
              setMenuOpen(false)
              onNewChat()
            }}
            aria-label="New chat"
            whileHover={reduce ? undefined : { scale: 1.06 }}
            whileTap={reduce ? undefined : { scale: 0.92 }}
            transition={softSpring}
            className="grid size-8 place-items-center rounded-md text-mute hover:bg-wash hover:text-cream"
          >
            <Plus size={15} />
          </motion.button>
          <motion.button
            type="button"
            onClick={onCollapse}
            aria-label="Collapse chat"
            whileHover={reduce ? undefined : { scale: 1.06 }}
            whileTap={reduce ? undefined : { scale: 0.92 }}
            transition={softSpring}
            className="grid size-8 place-items-center rounded-md text-mute hover:bg-wash hover:text-cream"
          >
            <PanelRightClose size={15} />
          </motion.button>
        </div>
      </div>

      <AnimatePresence initial={false}>
        {selected && (
          <motion.div
            key={selected.id}
            initial={reduce ? false : { height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={reduce ? undefined : { height: 0, opacity: 0 }}
            transition={fade}
            className="overflow-hidden border-b border-line"
          >
            <div className="px-4 py-2.5">
              <div className="text-[10px] tracking-[0.14em] text-dim uppercase">Looking at</div>
              <div className="mt-0.5 flex items-baseline justify-between gap-3">
                <span className="text-[12px] text-cream">{selected.name}</span>
                <span className="font-mono text-[10px] text-mute">
                  {formatRange(selected.start, selected.duration)}
                </span>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div
        ref={scroller}
        className="min-h-0 flex-1 space-y-4 overflow-y-auto [overflow-anchor:none] px-4 py-4 scroll-thin"
      >
        <div className="sr-only" aria-live="polite" aria-atomic="true">{announcement}</div>
        {messages.length === 0 && !pending && (
          <div className="text-[13px] leading-relaxed text-mute">{emptyHint}</div>
        )}
        {messages.map((m, index) => {
          const live = index === messages.length - 1 && m.role === 'assistant'
          const visibleText = m.role === 'assistant' ? stripThoughtMarkup(m.text) : m.text
          const replyStarted = Boolean(visibleText)
          const streaming = pending && live && replyStarted
          const beforeResponse = activity.length > 0 && live
          if (beforeResponse) {
            return <Message
              key={m.id}
              message={m}
              index={index}
              reduce={!!reduce}
              streaming={streaming}
              pending={pending}
              editing={editingIndex === index}
              onRetry={onRetry}
              onStartEdit={() => setEditingIndex(index)}
              onCancelEdit={() => setEditingIndex(null)}
              onSubmitEdit={onEdit}
              activity={(
                <ActivityPanel
                  items={activity}
                  pending={pending}
                  replyStarted={replyStarted}
                  startedAt={activityStartedAt}
                  reduce={!!reduce}
                />
              )}
            />
          }
          return (
            <Message
              key={m.id}
              message={m}
              index={index}
              reduce={!!reduce}
              streaming={streaming}
              pending={pending}
              editing={editingIndex === index}
              onRetry={onRetry}
              onStartEdit={() => setEditingIndex(index)}
              onCancelEdit={() => setEditingIndex(null)}
              onSubmitEdit={onEdit}
            />
          )
        })}
        {activity.length > 0 && (messages.length === 0 || messages[messages.length - 1].role !== 'assistant') && (
          <ActivityPanel items={activity} pending={pending} startedAt={activityStartedAt} reduce={!!reduce} />
        )}
        {showTyping && (
          <motion.div
            initial={reduce ? false : { opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex items-center gap-2 text-[12px] text-mute"
          >
            <span className="flex gap-1">
              {[0, 1, 2].map((i) => (
                <motion.i
                  key={i}
                  className="size-1 rounded-full bg-live"
                  animate={reduce ? undefined : { opacity: [0.3, 1, 0.3], y: [0, -2, 0] }}
                  transition={{ duration: 0.9, repeat: Infinity, delay: i * 0.12 }}
                />
              ))}
            </span>
            Cutting…
          </motion.div>
        )}
      </div>

      <div className="border-t border-line bg-panel p-3">
        <form
          onSubmit={submit}
          onDragEnter={(event) => {
            if (event.dataTransfer.types.includes('Files')) setDragOver(true)
          }}
          onDragOver={(event) => {
            if (!event.dataTransfer.types.includes('Files')) return
            event.preventDefault()
            setDragOver(true)
          }}
          onDragLeave={(event) => {
            if (event.currentTarget.contains(event.relatedTarget as Node)) return
            setDragOver(false)
          }}
          onDrop={(event) => {
            event.preventDefault()
            setDragOver(false)
            void addFiles(Array.from(event.dataTransfer.files ?? []))
          }}
          className={cn(
            'overflow-hidden rounded-[18px] border bg-lift shadow-[0_10px_28px_rgb(0_0_0_/_0.07)] transition-colors focus-within:border-line-strong',
            dragOver ? 'border-live/40' : 'border-line-strong',
          )}
        >
          <input
            ref={fileInput}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            multiple
            className="hidden"
            onChange={(event) => {
              void addFiles(Array.from(event.target.files ?? []))
              event.currentTarget.value = ''
            }}
          />
          {attachments.length > 0 && (
            <div className="flex gap-2 overflow-x-auto px-3 pt-3 scroll-thin">
              {attachments.map((image, index) => (
                <div key={`${image.name}-${index}`} className="relative shrink-0">
                  <img
                    src={image.preview}
                    alt={image.name}
                    className="h-14 w-14 rounded-md border border-line object-cover"
                  />
                  <button
                    type="button"
                    aria-label={`Remove ${image.name}`}
                    onClick={() => setAttachments((current) => current.filter((_, i) => i !== index))}
                    className="absolute -top-1.5 -right-1.5 grid size-4 place-items-center rounded-full bg-ink text-cream"
                  >
                    <X size={9} />
                  </button>
                </div>
              ))}
            </div>
          )}
          <textarea
            value={draft}
            onChange={(e) => onDraft(e.target.value)}
            onKeyDown={onKey}
            onPaste={(event) => {
              const files = Array.from(event.clipboardData.items)
                .map((item) => item.getAsFile())
                .filter((file): file is File => Boolean(file && file.type.startsWith('image/')))
              if (!files.length) return
              event.preventDefault()
              void addFiles(files)
            }}
            rows={2}
            placeholder="Ask Director to recut, grade, title, or generate a still…"
            className="block min-h-[78px] w-full resize-none border-0 bg-transparent px-3.5 py-3.5 pr-4 text-[10px] leading-relaxed text-cream outline-none placeholder:text-dim"
          />
          <div className="flex min-w-0 items-center gap-1.5 px-2.5 pb-2.5">
            <div className="flex min-w-0 flex-1 items-center gap-0.5">
              {onModel && activeModel ? (
                <Select value={activeModel.id} onValueChange={onModel}>
                  <SelectTrigger
                    className="!h-7 !w-auto !min-w-[88px] !max-w-[148px] !border-transparent !bg-transparent px-1.5 text-[11px] text-mute shadow-none hover:bg-wash hover:text-cream focus-visible:bg-wash"
                    aria-label="Language model"
                    title={`Language model: ${profileLabel(activeModel)}`}
                  >
                    <span className="truncate">{profileLabel(activeModel)}</span>
                  </SelectTrigger>
                  <SelectContent>
                    {models.map((model) => {
                      const host = profileHost(model.base_url)
                      return (
                        <SelectItem key={model.id} value={model.id} textValue={profileLabel(model)}>
                          <span className="flex min-w-0 flex-col">
                            <span className="truncate">{profileLabel(model)}</span>
                            {host && <span className="truncate text-[10px] text-dim">{host}</span>}
                          </span>
                        </SelectItem>
                      )
                    })}
                  </SelectContent>
                </Select>
              ) : (
                <span
                  className="px-1.5 text-[11px] text-dim"
                  title="The editor could not load models from the backend. Check that the server is running and LLM_MODELS is set in .env."
                >
                  No model
                </span>
              )}
              <span className="px-0.5 text-[10px] text-dim/50" aria-hidden>·</span>
              <ThinkingEffortSelect
                value={thinkingEffort}
                onChange={onThinkingEffort}
                className="!h-7 !w-auto !min-w-[72px] !max-w-[104px] !border-transparent !bg-transparent px-1.5 text-[11px] tracking-wide text-dim shadow-none hover:bg-wash hover:text-cream focus-visible:bg-wash"
              />
            </div>
            <button
              type="button"
              aria-label="Attach image"
              title="Attach image"
              disabled={pending || attachments.length >= 6}
              onClick={() => fileInput.current?.click()}
              className="grid size-7 shrink-0 place-items-center rounded-md text-dim transition-colors hover:bg-wash hover:text-cream disabled:opacity-35"
            >
              <ImagePlus size={14} />
            </button>
            <motion.button
                type="submit"
                disabled={!canSend}
                aria-label="Send"
                whileHover={reduce || !canSend ? undefined : { scale: 1.06, y: -1 }}
                whileTap={reduce || !canSend ? undefined : { scale: 0.9 }}
                transition={softSpring}
                className="grid size-7 shrink-0 place-items-center rounded-full bg-cream text-ink transition-opacity disabled:opacity-25"
              >
                <ArrowUp size={14} />
            </motion.button>
          </div>
        </form>
      </div>
    </aside>
  )
}

function ThinkingEffortSelect({
  value,
  onChange,
  className,
}: {
  value: ThinkingEffort
  onChange: (value: ThinkingEffort) => void
  className?: string
}) {
  return (
    <Select value={value} onValueChange={(next) => onChange(next as ThinkingEffort)}>
      <SelectTrigger
        className={className}
        aria-label="Thinking effort"
        title={`Thinking effort: ${capitalize(value)}`}
      >
        <span className="truncate">{capitalize(value)}</span>
      </SelectTrigger>
      <SelectContent>
        {(['low', 'medium', 'high'] as ThinkingEffort[]).map((effort) => (
          <SelectItem key={effort} value={effort} textValue={capitalize(effort)}>
            {capitalize(effort)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

function capitalize(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1)
}

function Message({
  message,
  index,
  reduce,
  activity,
  streaming = false,
  pending = false,
  editing = false,
  onRetry,
  onStartEdit,
  onCancelEdit,
  onSubmitEdit,
}: {
  message: ChatMessage
  index: number
  reduce: boolean
  activity?: ReactNode
  streaming?: boolean
  pending?: boolean
  editing?: boolean
  onRetry?: (index: number) => void
  onStartEdit?: () => void
  onCancelEdit?: () => void
  onSubmitEdit?: (index: number, text: string) => void
}) {
  const mine = message.role === 'user'
  const reply = mine ? message.text : stripThoughtMarkup(message.text)
  const [draft, setDraft] = useState(message.text)
  const editor = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (!editing) {
      setDraft(message.text)
      return
    }
    setDraft(message.text)
    const node = editor.current
    if (!node) return
    node.focus()
    node.selectionStart = node.value.length
    node.selectionEnd = node.value.length
  }, [editing, message.text])

  function submitEdit() {
    const next = draft.trim()
    if (!next && !message.images?.length) return
    onSubmitEdit?.(index, next)
  }

  return (
    <motion.div
      initial={mine && !reduce ? { opacity: 0, y: 8 } : false}
      animate={{ opacity: 1, y: 0 }}
      transition={fade}
      className={cn('group/message flex flex-col gap-1', mine && 'items-end')}
    >
      <div className="flex items-center gap-2 text-[10px] text-dim">
        <span>{mine ? 'You' : 'Director'}</span>
        {message.time && <span className="font-mono">{message.time}</span>}
      </div>
      {activity ?? (!mine && message.workedMs != null ? (
        message.trace?.length
          ? <ActivityPanel items={message.trace} pending={false} startedAt={null} elapsedOverride={message.workedMs} reduce={reduce} />
          : <WorkedDuration value={message.workedMs} />
      ) : null)}
      <div
        className={cn(
          'max-w-[92%] text-[13px] leading-relaxed',
          mine
            ? 'rounded-lg rounded-tr-sm border border-line bg-lift px-3 py-2 text-cream'
            : 'text-mute',
          editing && 'w-full border-line-strong',
        )}
      >
        {message.images && message.images.length > 0 && (
          <div className={cn('mb-2 grid gap-1.5', message.images.length > 1 ? 'grid-cols-2' : 'grid-cols-1')}>
            {message.images.map((image) => (
              <a
                key={image.url}
                href={image.url}
                target="_blank"
                rel="noreferrer"
                className="block overflow-hidden rounded-md border border-line"
              >
                <img src={image.url} alt={image.name || 'Attached image'} className="max-h-40 w-full object-cover" />
              </a>
            ))}
          </div>
        )}
        {editing ? (
          <div>
            <textarea
              ref={editor}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Escape') {
                  event.preventDefault()
                  onCancelEdit?.()
                }
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault()
                  submitEdit()
                }
              }}
              rows={Math.min(8, Math.max(2, draft.split('\n').length))}
              className="block w-full resize-none bg-transparent text-[13px] leading-relaxed text-cream outline-none"
            />
            <div className="mt-2 flex justify-end gap-1">
              <button
                type="button"
                onClick={onCancelEdit}
                className="rounded-md px-2 py-1 text-[10px] text-dim hover:bg-wash hover:text-cream"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={submitEdit}
                disabled={!draft.trim() && !message.images?.length}
                className="rounded-md bg-cream px-2 py-1 text-[10px] text-ink disabled:opacity-30"
              >
                Save
              </button>
            </div>
          </div>
        ) : reply ? (
          <div className={cn(!mine && !reduce && 'chat-message-enter', streaming && !reduce && 'stream-ink')}>
            {mine ? reply : <MarkdownText fadeTail={streaming && !reduce ? 120 : 0}>{reply}</MarkdownText>}
          </div>
        ) : null}
      </div>
      {!editing && (
        <MessageActions
          text={reply}
          canRetry={!mine && !pending && Boolean(onRetry)}
          canEdit={mine && !pending && Boolean(onStartEdit) && Boolean(reply || message.images?.length)}
          onRetry={onRetry ? () => onRetry(index) : undefined}
          onEdit={onStartEdit}
        />
      )}
    </motion.div>
  )
}

function MessageActions({
  text,
  canRetry,
  canEdit,
  onRetry,
  onEdit,
}: {
  text: string
  canRetry: boolean
  canEdit?: boolean
  onRetry?: () => void
  onEdit?: () => void
}) {
  const [copied, setCopied] = useState(false)
  const canCopy = Boolean(text.trim())

  async function copy() {
    if (!canCopy) return
    const ok = await copyText(text)
    if (!ok) return
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1400)
  }

  if (!canCopy && !canRetry && !canEdit) return null

  return (
    <div className="flex items-center gap-0.5">
      {canCopy && (
        <ActionIcon
          label={copied ? 'Copied' : 'Copy'}
          onClick={() => void copy()}
        >
          {copied ? <Check size={11} /> : <Copy size={11} />}
        </ActionIcon>
      )}
      {canEdit && (
        <ActionIcon label="Edit" onClick={onEdit}>
          <Pencil size={11} />
        </ActionIcon>
      )}
      {canRetry && (
        <ActionIcon
          label="Retry"
          onClick={onRetry}
        >
          <RotateCcw size={11} />
        </ActionIcon>
      )}
    </div>
  )
}

function ActionIcon({
  label,
  onClick,
  children,
}: {
  label: string
  onClick?: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => {
        event.preventDefault()
        event.stopPropagation()
        onClick?.()
      }}
      className="group/action relative grid size-6 place-items-center rounded-md text-dim transition-colors hover:bg-wash hover:text-cream"
    >
      {children}
      <span className="pointer-events-none absolute bottom-full left-1/2 z-20 mb-1 -translate-x-1/2 rounded bg-ink px-1.5 py-0.5 text-[10px] whitespace-nowrap text-cream opacity-0 shadow-[var(--toast-shadow)] transition-opacity group-hover/action:opacity-100">
        {label}
      </span>
    </button>
  )
}

async function copyText(text: string) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    // fall through to the textarea fallback
  }
  try {
    const field = document.createElement('textarea')
    field.value = text
    field.setAttribute('readonly', '')
    field.style.position = 'fixed'
    field.style.left = '-9999px'
    document.body.appendChild(field)
    field.select()
    const ok = document.execCommand('copy')
    field.remove()
    return ok
  } catch {
    return false
  }
}

function WorkedDuration({ value }: { value: number }) {
  return <div className="mt-1 w-full border-t border-dotted border-line/80 px-0 pt-1 text-[9px] text-mute">Worked for {formatWorkDuration(value)}</div>
}

function ActivityPanel({
  items,
  pending,
  replyStarted = false,
  startedAt,
  elapsedOverride,
  reduce,
}: {
  items: DirectorActivity[]
  pending: boolean
  replyStarted?: boolean
  startedAt: number | null
  elapsedOverride?: number
  reduce: boolean
}) {
  const [expanded, setExpanded] = useState(false)
  const [elapsedMs, setElapsedMs] = useState(0)
  const hasThought = items.some((item) => item.kind === 'thinking' && item.detail && !placeholderThought(item.detail))

  useEffect(() => {
    if (!pending || replyStarted) {
      setExpanded(false)
      return
    }
    if (hasThought) setExpanded(true)
  }, [hasThought, pending, replyStarted])

  useEffect(() => {
    if (!startedAt) return
    const update = () => setElapsedMs(Math.max(0, Date.now() - startedAt))
    update()
    if (!pending) return
    const timer = window.setInterval(update, 1000)
    return () => window.clearInterval(timer)
  }, [pending, startedAt])

  const latest = items[items.length - 1]
  const latestThought = [...items].reverse().find((item) => item.kind === 'thinking' && item.detail && !placeholderThought(item.detail))
  const thoughtLine = latestThought?.detail ? thoughtPreview(latestThought.detail) : ''
  const label = !replyStarted && thoughtLine ? thoughtLine : compactActivityLabel(latestThought ? 'Thinking' : latest?.title ?? 'Working')

  return (
    <motion.div
      initial={reduce ? false : { opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      className="mt-1 w-full max-w-full border-t border-dotted border-line/80 pt-1 opacity-70"
    >
      <button
        type="button"
        onClick={() => setExpanded((value) => !value)}
        aria-expanded={expanded}
        aria-label={pending ? `Director is ${label}` : `Show ${items.length} Director steps`}
        className="flex w-full max-w-full items-center gap-1 rounded px-0 py-0 text-left text-[8px] text-dim transition-colors hover:bg-wash"
      >
        {pending ? (
          <>
            <span className="size-1 shrink-0 rounded-full bg-live" />
            <span className="min-w-0 truncate text-dim">{label}</span>
            <span className="ml-auto shrink-0 font-mono text-[7px] text-dim">{formatWorkDuration(elapsedMs)}</span>
          </>
        ) : (
          <span className="shrink-0 text-[9px] text-mute">Worked for {formatWorkDuration(elapsedOverride ?? elapsedMs)}</span>
        )}
        <ChevronRight size={11} className={cn('shrink-0 transition-transform', expanded && 'rotate-90')} />
      </button>
      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            initial={reduce ? false : { height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={reduce ? undefined : { height: 0, opacity: 0 }}
            className="ml-2 space-y-1 border-l border-line/40 py-1 pl-2"
          >
            {items.map((item) => <ActivityRow key={item.id} item={item} reduce={reduce} />)}
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  )
}

function ActivityRow({ item, reduce }: { item: DirectorActivity; reduce: boolean }) {
  const tool = item.kind === 'tool'
  const thought = item.kind === 'thinking' && item.detail && !placeholderThought(item.detail)
  const icon = item.status === 'active'
    ? <LoaderCircle size={12} className={cn('text-live', !reduce && 'animate-spin')} />
    : item.status === 'error'
      ? <CircleAlert size={12} className="text-mark" />
      : tool
        ? <Wrench size={11} className="text-live" />
        : thought
          ? <Brain size={11} className="text-live" />
          : <Check size={12} className="text-dim" />

  return (
    <div className="rounded-md px-1 py-1 text-[10px] text-dim transition-colors hover:bg-wash">
      <div className="flex min-w-0 items-center gap-2">
        <span className="grid size-4 shrink-0 place-items-center text-dim">
          {icon}
        </span>
        <span className={cn('min-w-0 flex-1 truncate', item.status === 'error' ? 'text-mark/90' : 'text-mute')}>
          {item.title}
        </span>
        {item.iteration != null && <span className="shrink-0 font-mono text-[9px] text-dim">#{item.iteration}</span>}
        {item.elapsedMs != null && <span className="shrink-0 font-mono text-[9px] text-dim">{formatElapsed(item.elapsedMs)}</span>}
      </div>
      {(item.detail || item.arguments !== undefined) && (
        <div className="mt-1 ml-6 min-w-0 space-y-1">
          {item.detail && (
            <div
              className={cn(
                'break-words leading-relaxed',
                item.status === 'error' ? 'text-[9px] text-mark/80' : thought
                  ? 'max-h-44 overflow-y-auto whitespace-pre-wrap text-[10px] text-dim/80 scroll-thin'
                  : 'text-[9px] text-dim',
              )}
            >
              {thought ? stripThoughtMarkup(item.detail) : item.detail}
            </div>
          )}
          {item.arguments !== undefined && (
            <details className="group">
              <summary className="cursor-pointer text-[9px] text-dim hover:text-mute">Show arguments</summary>
              <pre className="mt-1 max-h-28 overflow-auto whitespace-pre-wrap break-words rounded bg-wash-strong p-1.5 font-mono text-[9px] leading-relaxed text-dim scroll-thin">
                {formatArguments(item.arguments)}
              </pre>
            </details>
          )}
        </div>
      )}
    </div>
  )
}

function formatArguments(value: unknown) {
  let text = ''
  try {
    text = JSON.stringify(value, null, 2) ?? String(value)
  } catch {
    text = String(value)
  }
  return text.length > 1200 ? `${text.slice(0, 1200)}…` : text
}

function formatElapsed(value: number) {
  if (value < 1000) return `${Math.max(1, Math.round(value))}ms`
  return `${(value / 1000).toFixed(1)}s`
}

function placeholderThought(value: string) {
  return !value.trim() || /^Director (is deciding|decided|is applying)/.test(value)
}

function compactActivityLabel(value: string) {
  if (/^Planning/.test(value)) return 'Planning…'
  if (/^Thinking/.test(value)) return 'Thinking…'
  if (/^Searching/.test(value)) return 'Searching…'
  if (/^Executing/.test(value)) return 'Working…'
  if (/^Inspecting/.test(value)) return 'Inspecting…'
  if (/^Reading/.test(value)) return 'Reading…'
  if (/^Editing/.test(value)) return 'Editing…'
  if (/^Placing/.test(value)) return 'Placing…'
  return value
}

function formatWorkDuration(value: number) {
  const seconds = Math.max(1, Math.round(value / 1000))
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  const remainder = seconds % 60
  return remainder ? `${minutes}m ${remainder}s` : `${minutes}m`
}

export function ChatRail({ onOpen }: { onOpen: () => void }) {
  const reduce = useReducedMotion()
  return (
    <motion.button
      type="button"
      onClick={onOpen}
      className="chrome flex w-11 shrink-0 flex-col items-center gap-3 border-l border-line bg-panel py-4 text-mute transition-colors hover:bg-wash hover:text-cream"
      aria-label="Open Director"
    >
      <motion.span
        className="size-1.5 rounded-full bg-live"
        animate={reduce ? undefined : { scale: [1, 1.18, 1], opacity: [0.75, 1, 0.75] }}
        transition={{ duration: 2.2, repeat: Infinity, ease: 'easeInOut' }}
      />
      <span className="rotate-180 text-[10px] font-medium tracking-[0.18em] uppercase [writing-mode:vertical-rl]">
        Director
      </span>
    </motion.button>
  )
}

function profileHost(url: string) {
  try {
    return new URL(url).host.replace(/^www\./, '')
  } catch {
    return ''
  }
}
