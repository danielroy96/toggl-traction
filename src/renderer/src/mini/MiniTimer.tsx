import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type {
  AppSettings,
  TimerState,
  TogglProject,
  TogglTask
} from '../../../shared/types.js'
import { useElapsed } from '../lib/useElapsed.js'
import { useAppearance } from '../lib/useAppearance.js'
import { formatDuration } from '../lib/format.js'
import { ProjectTaskPicker } from '../components/ProjectTaskPicker.js'

const emptyTimer: TimerState = {
  running: null,
  pending: false,
  error: null,
  lastSyncedAt: null
}

/**
 * The always-on-top mini timer.
 *
 * Two states, to stay small yet capable:
 *  - Collapsed: a tight glance view — elapsed time, a one-line description ·
 *    project/task label, and a start/stop button.
 *  - Expanded: click to grow the window (main process animates the resize) and
 *    reveal an editable description and a project/task picker.
 *
 * It is self-contained (talks to window.toggl directly) so it never depends on
 * the main window being open.
 */
export function MiniTimer(): JSX.Element {
  const [timer, setTimer] = useState<TimerState>(emptyTimer)
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [projects, setProjects] = useState<TogglProject[]>([])
  const [tasks, setTasks] = useState<TogglTask[]>([])
  const [projectId, setProjectId] = useState<number | null>(null)
  const [taskId, setTaskId] = useState<number | null>(null)
  const [description, setDescription] = useState('')
  const [expanded, setExpanded] = useState(false)
  const contentRef = useRef<HTMLDivElement>(null)
  const elapsed = useElapsed(timer.running?.start ?? null)

  useAppearance(settings)

  // Auto-fit the window to the exact rendered content height (no empty space),
  // re-measuring whenever the content or font scale changes.
  useLayoutEffect(() => {
    const el = contentRef.current
    if (!el || !window.toggl) return
    const sync = (): void => {
      const width = expanded ? 268 : 232
      // +2 accounts for the .mini 1px top/bottom border (box-sizing: border-box).
      const height = Math.ceil(el.getBoundingClientRect().height) + 2
      void window.toggl.mini.setContentSize(width, height)
    }
    sync()
    const ro = new ResizeObserver(sync)
    ro.observe(el)
    return () => ro.disconnect()
  }, [expanded, settings?.fontScale])

  useEffect(() => {
    const api = window.toggl
    if (!api) return
    void api.timer.getState().then(setTimer)
    void api.settings.get().then(setSettings)
    void api.projects.list().then(setProjects).catch(() => {})
    void api.tasks.list().then(setTasks).catch(() => {})
    const offTimer = api.timer.onChange(setTimer)
    const offSettings = api.settings.onChange(setSettings)
    return () => {
      offTimer()
      offSettings()
    }
  }, [])

  const running = timer.running

  // Mirror the running entry into the local fields.
  useEffect(() => {
    if (running) {
      setProjectId(running.project_id ?? null)
      setTaskId(running.task_id ?? null)
      setDescription(running.description ?? '')
    }
  }, [running?.id])

  // Toggling expanded changes the rendered content; the layout effect above
  // re-measures and resizes the window to fit.
  const toggleExpanded = (): void => setExpanded((v) => !v)

  const onToggleTimer = (): void => {
    if (timer.pending || !window.toggl) return
    if (running) void window.toggl.timer.stop()
    else void window.toggl.timer.start({ description: description.trim(), projectId, taskId })
  }

  const onPick = (pid: number | null, tid: number | null): void => {
    setProjectId(pid)
    setTaskId(tid)
    if (running && window.toggl) {
      void window.toggl.entries
        .update(running.id, { project_id: pid, task_id: tid })
        .then(() => window.toggl.timer.sync())
        .catch(() => {})
    }
  }

  const saveDescription = (): void => {
    if (running && window.toggl && description.trim() !== (running.description ?? '')) {
      void window.toggl.entries
        .update(running.id, { description: description.trim() })
        .then(() => window.toggl.timer.sync())
        .catch(() => {})
    }
  }

  const project = projects.find((p) => p.id === projectId)
  const task = tasks.find((t) => t.id === taskId)
  const meta = project
    ? `${project.name}${task ? ` · ${task.name}` : ''}`
    : 'No project'

  return (
    <div className={`mini ${running ? 'mini--running' : ''} ${expanded ? 'mini--expanded' : ''}`}>
     <div className="mini__content" ref={contentRef}>
      <div className="mini__header">
        {/* Draggable glance area (the whole window moves the OS window). */}
        <div className="mini__glance">
          <span
            className="mini__time mono"
            role="timer"
            aria-live="off"
          >
            {formatDuration(running ? elapsed : 0)}
          </span>
          {/* Redundant with the editable fields when expanded, so collapsed-only. */}
          {!expanded && (
            <span className="mini__summary">
              <span className="mini__desc">
                {running ? running.description || 'No description' : 'Stopped'}
              </span>
              <span className="mini__meta">
                <span
                  className="project-dot mini__dot"
                  style={{ background: project?.color ?? 'var(--border-strong)' }}
                  aria-hidden="true"
                />
                {meta}
              </span>
            </span>
          )}
        </div>

        <button
          className="mini__expand"
          onClick={toggleExpanded}
          aria-expanded={expanded}
          aria-label={expanded ? 'Collapse timer' : 'Expand timer to edit'}
        >
          <Chevron expanded={expanded} />
        </button>

        {/* Collapsed: quick round toggle in the header. Expanded: a full-width
            primary button lives at the bottom instead (see below). */}
        {!expanded && (
          <button
            className={`btn-round ${running ? 'btn-round--stop' : 'btn-round--start'} mini__btn`}
            onClick={onToggleTimer}
            disabled={timer.pending}
            aria-label={running ? 'Stop timer' : 'Start timer'}
          >
            <TimerIcon running={!!running} />
          </button>
        )}
      </div>

      {expanded && (
        <div className="mini__editor">
          <input
            className="input mini__desc-input"
            type="text"
            placeholder="What are you working on?"
            aria-label="Time entry description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            onBlur={saveDescription}
          />
          <ProjectTaskPicker
            projectId={projectId}
            taskId={taskId}
            onChange={onPick}
            projects={projects}
            tasks={tasks}
            compact
            ariaLabel="Project and task for this timer"
          />
          <button
            className={`btn ${running ? 'btn--danger' : 'btn--success'} mini__primary`}
            onClick={onToggleTimer}
            disabled={timer.pending}
          >
            <TimerIcon running={!!running} />
            {running ? 'Stop timer' : 'Start timer'}
          </button>
        </div>
      )}
     </div>
    </div>
  )
}

function TimerIcon({ running }: { running: boolean }): JSX.Element {
  return running ? (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <rect x="6" y="6" width="12" height="12" rx="2" />
    </svg>
  ) : (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M8 5v14l11-7z" />
    </svg>
  )
}

function Chevron({ expanded }: { expanded: boolean }): JSX.Element {
  return (
    <svg
      className={`mini__chevron ${expanded ? 'mini__chevron--up' : ''}`}
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M7 10l5 5 5-5z" />
    </svg>
  )
}
