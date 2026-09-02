import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type {
  AppSettings,
  TimeEntry,
  TimerState,
  TogglProject,
  TogglTask
} from '../../../shared/types.js'
import { useElapsed } from '../lib/useElapsed.js'
import { useAppearance } from '../lib/useAppearance.js'
import { formatDuration, formatSyncedAt } from '../lib/format.js'
import { ProjectTaskPicker } from '../components/ProjectTaskPicker.js'
import {
  DescriptionAutocomplete,
  type EntryDetails
} from '../components/DescriptionAutocomplete.js'

const emptyTimer: TimerState = {
  running: null,
  pending: false,
  error: null,
  lastSyncedAt: null
}

/**
 * The always-on-top mini timer.
 *
 * One always-editable state: elapsed time and a start/stop button on the drag
 * row, then the same description autocomplete and project/task picker the main
 * window's timer bar uses — so "repeat what I did before" behaves identically
 * in both, and there is no edit mode to enter first.
 *
 * Both dropdowns render inline (in normal flow) rather than as overlays: the
 * window is sized to its content, so an overlay would be clipped at the window
 * edge. That is why the auto-fit below stays; the height is otherwise stable.
 *
 * It is self-contained (talks to window.toggl directly) so it never depends on
 * the main window being open.
 */
export function MiniTimer(): JSX.Element {
  const [timer, setTimer] = useState<TimerState>(emptyTimer)
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [projects, setProjects] = useState<TogglProject[]>([])
  const [tasks, setTasks] = useState<TogglTask[]>([])
  const [entries, setEntries] = useState<TimeEntry[]>([])
  const [projectId, setProjectId] = useState<number | null>(null)
  const [taskId, setTaskId] = useState<number | null>(null)
  const [description, setDescription] = useState('')
  const [syncing, setSyncing] = useState(false)
  const contentRef = useRef<HTMLDivElement>(null)
  const elapsed = useElapsed(timer.running?.start ?? null)

  useAppearance(settings)

  // Auto-fit the window to the exact rendered content height (no empty space),
  // re-measuring whenever the content or font scale changes.
  useLayoutEffect(() => {
    const el = contentRef.current
    if (!el || !window.toggl) return
    const sync = (): void => {
      // Fixed width — wide enough for a ticket ref plus some description and
      // the project/task line.
      const width = 320
      // +2 accounts for the .mini 1px top/bottom border (box-sizing: border-box).
      const height = Math.ceil(el.getBoundingClientRect().height) + 2
      void window.toggl.mini.setContentSize(width, height)
    }
    sync()
    const ro = new ResizeObserver(sync)
    ro.observe(el)
    return () => ro.disconnect()
  }, [settings?.fontScale])

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

  // Reload the autocomplete's source whenever the running entry changes — a
  // start/stop adds to history and there is no entries-changed broadcast.
  useEffect(() => {
    if (!window.toggl) return
    void window.toggl.entries
      .recent()
      .then(setEntries)
      .catch(() => {})
  }, [running?.id])

  /**
   * Pull the current state from Toggl on demand. A timer started elsewhere (the
   * web app, another device) only reaches us on the main process's slow poll —
   * deliberately slow, because the API rate limit is tight — so this is how you
   * catch the mini timer up immediately.
   */
  const onRefresh = (): void => {
    if (syncing || !window.toggl) return
    setSyncing(true)
    void window.toggl.timer
      .sync()
      .then(setTimer)
      .catch(() => {
        /* the main process records the failure in timer.error */
      })
      .finally(() => setSyncing(false))
  }

  const onToggleTimer = (): void => {
    if (timer.pending || !window.toggl) return
    if (running) {
      void window.toggl.timer.stop()
      // Clear the fields on stop, matching the main window: this entry is
      // finished and the next one usually starts from a clean slate.
      setDescription('')
      setProjectId(null)
      setTaskId(null)
    } else {
      void window.toggl.timer.start({ description: description.trim(), projectId, taskId })
    }
  }

  /** Patch the running entry, then re-sync so the change is reflected live. */
  const patchRunning = (patch: Partial<TimeEntry>): void => {
    if (!running || !window.toggl) return
    void window.toggl.entries
      .update(running.id, patch)
      .then(() => window.toggl.timer.sync())
      .catch(() => {})
  }

  const onPickProjectTask = (pid: number | null, tid: number | null): void => {
    setProjectId(pid)
    setTaskId(tid)
    patchRunning({ project_id: pid, task_id: tid })
  }

  const saveDescription = (): void => {
    if (running && description.trim() !== (running.description ?? '')) {
      patchRunning({ description: description.trim() })
    }
  }

  // Copy a recent entry's details (description + project/task) into the fields.
  const onPickSuggestion = (d: EntryDetails): void => {
    const pid = d.project_id ?? null
    const tid = d.task_id ?? null
    setDescription(d.description)
    setProjectId(pid)
    setTaskId(tid)
    patchRunning({ description: d.description, project_id: pid, task_id: tid })
  }

  // Enter in the description field saves it while running, else starts.
  const onSubmit = (e: React.FormEvent): void => {
    e.preventDefault()
    if (running) saveDescription()
    else onToggleTimer()
  }

  return (
    <div className={`mini ${running ? 'mini--running' : ''}`}>
     <div className="mini__content" ref={contentRef}>
      {/* Draggable glance row — dragging it moves the OS window. */}
      <div className="mini__header">
        <span className="mini__time mono" role="timer" aria-live="off">
          {formatDuration(running ? elapsed : 0)}
        </span>
        <span className="mini__status">{running ? 'Tracking' : 'Stopped'}</span>
        <button
          className="mini__icon-btn"
          onClick={onRefresh}
          disabled={syncing}
          aria-label={syncing ? 'Refreshing from Toggl' : 'Refresh from Toggl'}
          title={`Refresh from Toggl — ${formatSyncedAt(timer.lastSyncedAt)}`}
        >
          <RefreshIcon className={syncing ? 'spin' : undefined} />
        </button>

        <button
          className={`btn-round ${running ? 'btn-round--stop' : 'btn-round--start'} mini__btn`}
          onClick={onToggleTimer}
          disabled={timer.pending}
          aria-label={running ? 'Stop timer' : 'Start timer'}
          title={running ? 'Stop timer' : 'Start timer'}
        >
          <TimerIcon running={!!running} />
        </button>
      </div>

      <form className="mini__fields" onSubmit={onSubmit}>
        <DescriptionAutocomplete
          value={description}
          onChange={setDescription}
          onPick={onPickSuggestion}
          onBlur={saveDescription}
          entries={entries}
          projects={projects}
          tasks={tasks}
          placeholder="What are you working on?"
          ariaLabel="Time entry description"
          compact
        />
        <ProjectTaskPicker
          projectId={projectId}
          taskId={taskId}
          onChange={onPickProjectTask}
          projects={projects}
          tasks={tasks}
          compact
          ariaLabel="Project and task for this timer"
        />
      </form>
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

function RefreshIcon({ className }: { className?: string }): JSX.Element {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
      className={className}
    >
      <path d="M17.65 6.35A7.958 7.958 0 0 0 12 4a8 8 0 1 0 7.73 10h-2.08A6 6 0 1 1 12 6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z" />
    </svg>
  )
}
