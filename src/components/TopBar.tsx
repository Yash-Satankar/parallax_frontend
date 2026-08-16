import { Download, Plus, Redo2, Share, Undo2, Upload } from 'lucide-react'
import { motion, useReducedMotion } from 'framer-motion'
import { PROJECT_FPS, PROJECT_RES } from '../data/project'
import type { ProjectRecord } from '../lib/api'
import type { RemotePeer } from '../lib/useCollab'
import { softSpring } from '../lib/motion'
import { ThemeToggle } from './ThemeToggle'
import { IconButton, Logo, Pill } from './ui'
import { Select, SelectContent, SelectItem, SelectTrigger } from './Select'

type Props = {
  onExport: () => void
  projects: ProjectRecord[]
  projectId: string
  projectName: string
  uploading: boolean
  exporting?: boolean
  onProject: (id: string) => void
  onCreateProject: () => void
  onUpload: () => void
  canUndo?: boolean
  canRedo?: boolean
  onUndo?: () => void
  onRedo?: () => void
  peers?: RemotePeer[]
}

export function TopBar({
  onExport,
  projects,
  projectId,
  projectName,
  uploading,
  exporting,
  onProject,
  onCreateProject,
  onUpload,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  peers = [],
}: Props) {
  const reduce = useReducedMotion()
  return (
    <header className="chrome flex h-12 shrink-0 items-center justify-between border-b border-line bg-panel px-3">
      <div className="flex min-w-0 items-center gap-5">
        <Logo />
        <div className="hidden h-4 w-px bg-line-strong sm:block" />
        <div className="hidden min-w-0 items-center gap-2 sm:flex">
          {projects.length ? (
            <Select value={projectId} onValueChange={onProject}>
              <SelectTrigger
                className="h-8 w-[132px] border-line bg-well px-2.5 text-[12px]"
                aria-label="Current project"
              >
                <span className="truncate">
                  {projects.find((project) => project.id === projectId)?.name ?? projectName}
                </span>
              </SelectTrigger>
              <SelectContent side="bottom" align="start">
                {projects.map((project) => (
                  <SelectItem key={project.id} value={project.id} textValue={project.name}>
                    <span className="truncate">{project.name}</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <span className="truncate text-[13px] font-medium text-mute">{projectName}</span>
          )}
          <IconButton label="New project" onClick={onCreateProject}>
            <Plus size={14} />
          </IconButton>
          <Pill>Draft</Pill>
        </div>
      </div>

      <div className="flex items-center gap-1">
        <IconButton label="Undo" disabled={!canUndo} onClick={onUndo}>
          <Undo2 size={15} />
        </IconButton>
        <IconButton label="Redo" disabled={!canRedo} onClick={onRedo}>
          <Redo2 size={15} />
        </IconButton>
      </div>

      <div className="flex items-center gap-2">
        <motion.button
          type="button"
          onClick={onUpload}
          disabled={!projectId || uploading}
          whileHover={reduce ? undefined : { y: -1 }}
          whileTap={reduce ? undefined : { scale: 0.97 }}
          transition={softSpring}
          className="inline-flex h-8 items-center gap-1.5 rounded-md border border-line px-2.5 text-[12px] text-mute transition-colors hover:border-line-strong hover:text-cream disabled:opacity-40"
        >
          <Upload size={13} />
          {uploading ? 'Uploading…' : 'Upload'}
        </motion.button>
        <ThemeToggle />
        <div className="mr-1 hidden items-center gap-2 text-[11px] text-mute md:flex">
          <span className="font-mono">{PROJECT_FPS} fps</span>
          <span className="text-dim">/</span>
          <span className="font-mono">{PROJECT_RES}</span>
        </div>
        {peers.length > 0 && (
          <div className="flex items-center -space-x-1.5 mr-1" title={`${peers.length} collaborator${peers.length > 1 ? 's' : ''} active`}>
            {peers.slice(0, 4).map((peer) => (
              <div
                key={peer.client_id}
                className="grid size-6 place-items-center rounded-full border border-panel text-[10px] font-bold text-white shadow-sm"
                style={{ backgroundColor: peer.color || '#3b82f6' }}
                title={peer.name || 'Collaborator'}
              >
                {(peer.name || 'C').charAt(0).toUpperCase()}
              </div>
            ))}
            {peers.length > 4 && (
              <div className="grid size-6 place-items-center rounded-full border border-panel bg-well text-[10px] font-medium text-mute">
                +{peers.length - 4}
              </div>
            )}
          </div>
        )}
        <motion.button
          type="button"
          whileHover={reduce ? undefined : { y: -1 }}
          whileTap={reduce ? undefined : { scale: 0.97 }}
          transition={softSpring}
          className="hidden h-8 items-center gap-1.5 rounded-md px-2.5 text-[12px] text-mute transition-colors hover:bg-wash hover:text-cream sm:inline-flex"
        >
          <Share size={13} />
          Share
        </motion.button>
        <motion.button
          type="button"
          onClick={onExport}
          disabled={!projectId || exporting}
          whileHover={reduce || !projectId || exporting ? undefined : { y: -1 }}
          whileTap={reduce || !projectId || exporting ? undefined : { scale: 0.97 }}
          transition={softSpring}
          className="inline-flex h-8 items-center gap-1.5 rounded-md bg-cream px-3 text-[12px] font-medium text-ink disabled:opacity-40"
        >
          <Download size={13} />
          {exporting ? 'Exporting…' : 'Export'}
        </motion.button>
      </div>
    </header>
  )
}
