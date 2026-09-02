import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { JSX } from 'react'
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
  type EntryDetails,
  type PickVia
} from '../components/DescriptionAutocomplete.js'

const emptyTimer: TimerState = {
  running: null,
  pending: false,
  error: null,
  lastSyncedAt: null
}

/**
 * Fixed width. Set by what has to fit on the one line and still be readable:
 * the elapsed time, the description, the project/task tag and three controls.
 * Even at this width the card is a fraction of the area the two-row layout took.
 */
const MINI_WIDTH = 500
/** The dropdowns that float outside the card and must not be clipped. */
const OVERLAY_SEL = '.autocomplete__list, .ptpick__panel'
/** Room below an open dropdown so its soft shadow isn't cut off mid-fade. */
const OVERLAY_SHADOW = 10
/**
 * How long a shrink waits before it is sent. Closing one dropdown to open
 * another produces a shrink immediately followed by a grow; sending both makes
 * the window visibly snap twice. Growing is instant (the dropdown must not be
 * clipped), shrinking is deferred and cancelled if the space is claimed again.
 */
const SHRINK_DELAY_MS = 180

/**
 * The always-on-top mini timer.
 *
 * One line: elapsed time, the description field, refresh, expand, start/stop.
 * Choosing a suggestion fills in its project and task too, so that single field
 * covers the common "repeat what I did before" case — and choosing one with
 * Enter starts the timer outright, because Enter in this field has always meant
 * "go".
 *
 * Editing project/task by hand is the uncommon case, so it lives behind the
 * expand button rather than costing a permanent second row.
 *
 * The window is transparent and sized to the card plus whatever dropdown is
 * currently open, so the dropdowns overlay like real dropdowns instead of
 * growing the card. `requestSize` below is what keeps those steps from
 * flickering.
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
  const [expanded, setExpanded] = useState(false)
  // Which dropdowns are actually showing a panel. Only used to re-run the
  // measurement below — a panel overhangs the card, so the window must grow.
  const [descOpen, setDescOpen] = useState(false)
  const [pickOpen, setPickOpen] = useState(false)
  const cardRef = useRef<HTMLDivElement>(null)
  const elapsed = useElapsed(timer.running?.start ?? null)

  useAppearance(settings)

  // Last size sent to the main process, plus a pending deferred shrink.
  const sentSize = useRef({ w: 0, h: 0 })
  const shrinkTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const requestSize = useCallback((w: number, h: number): void => {
    const cancelShrink = (): void => {
      if (shrinkTimer.current) {
        clearTimeout(shrinkTimer.current)
        shrinkTimer.current = null
      }
    }
    // Already this size (possibly because a queued shrink is now obsolete).
    if (w === sentSize.current.w && h === sentSize.current.h) {
      cancelShrink()
      return
    }
    const send = (): void => {
      cancelShrink()
      sentSize.current = { w, h }
      void window.toggl?.mini.setContentSize(w, h)
    }
    cancelShrink()
    if (h >= sentSize.current.h) send()
    else shrinkTimer.current = setTimeout(send, SHRINK_DELAY_MS)
  }, [])

  useEffect(() => {
    return () => {
      if (shrinkTimer.current) clearTimeout(shrinkTimer.current)
    }
  }, [])

  /*
   * Fit the window to the card plus any dropdown hanging below it. The card
   * sits at the top of a transparent window with natural height, so its
   * viewport-relative bottom *is* the card height; a dropdown that reaches
   * further down simply raises that number, and the rest of the window stays
   * see-through. Re-measured whenever a panel opens/closes or resizes (typing
   * filters the list), the card grows/shrinks, or the font scale changes.
   */
  useLayoutEffect(() => {
    const card = cardRef.current
    if (!card || !window.toggl) return
    const overlays = (): HTMLElement[] =>
      Array.from(document.querySelectorAll<HTMLElement>(OVERLAY_SEL))
    const measure = (): void => {
      // Document coordinates (rect + scrollY), not viewport ones: if anything
      // ever does manage to scroll the page, a viewport-relative bottom would
      // silently under-measure and clip the dropdown.
      const y = window.scrollY
      let bottom = card.getBoundingClientRect().bottom + y
      for (const el of overlays()) {
        bottom = Math.max(bottom, el.getBoundingClientRect().bottom + y + OVERLAY_SHADOW)
      }
      requestSize(MINI_WIDTH, Math.ceil(bottom))
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(card)
    for (const el of overlays()) ro.observe(el)
    return () => ro.disconnect()
    // `descOpen`/`pickOpen` mount and unmount the panels, so the observer has
    // to be rebuilt around the current set.
  }, [descOpen, pickOpen, expanded, settings?.fontScale, requestSize])

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

  /** Start with explicit values — callers often have them before state lands. */
  const startTimer = (desc: string, pid: number | null, tid: number | null): void => {
    if (!window.toggl) return
    void window.toggl.timer.start({ description: desc.trim(), projectId: pid, taskId: tid })
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
      startTimer(description, projectId, taskId)
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

  /**
   * Copy a recent entry's details into the fields — this is what lets the one
   * visible field set description, project and task at once.
   *
   * Choosing with Enter also starts the timer when nothing is running. Enter in
   * this field already means "start" for free text, so it means the same for a
   * suggestion; clicking one only fills the fields, as a click always has.
   */
  const onPickSuggestion = (d: EntryDetails, via: PickVia): void => {
    const pid = d.project_id ?? null
    const tid = d.task_id ?? null
    setDescription(d.description)
    setProjectId(pid)
    setTaskId(tid)
    if (running) patchRunning({ description: d.description, project_id: pid, task_id: tid })
    else if (via === 'enter') startTimer(d.description, pid, tid)
  }

  // Enter in the description field saves it while running, else starts.
  const onSubmit = (e: React.FormEvent): void => {
    e.preventDefault()
    if (running) saveDescription()
    else onToggleTimer()
  }

  const project = projects.find((p) => p.id === projectId)
  const task = tasks.find((t) => t.id === taskId)
  const selection = project
    ? `${project.name}${task ? ` · ${task.name}` : ''}`
    : 'No project'
  /*
   * While collapsed the picker is not on screen, so the field carries the
   * booking itself: the project's colour as a dot, plus the task name — or the
   * project name when the entry has no task. Expanded, the picker below says
   * the same thing in full, so the tag would only be repeating it.
   */
  const fieldTag =
    !expanded && project
      ? { label: task?.name ?? project.name, color: project.color, title: selection }
      : null

  return (
    <div className="mini" ref={cardRef}>
      <form className="mini__row" onSubmit={onSubmit}>
        {/* The elapsed time doubles as the window's drag handle. */}
        <span className="mini__time mono" role="timer" aria-live="off">
          {formatDuration(running ? elapsed : 0)}
        </span>

        <DescriptionAutocomplete
          value={description}
          onChange={setDescription}
          onPick={onPickSuggestion}
          onBlur={saveDescription}
          onOpenChange={setDescOpen}
          entries={entries}
          projects={projects}
          tasks={tasks}
          placeholder="What are you working on?"
          ariaLabel="Time entry description"
          tag={fieldTag}
          compact
        />

        <button
          type="button"
          className="mini__icon-btn"
          onClick={onRefresh}
          disabled={syncing}
          aria-label={syncing ? 'Refreshing from Toggl' : 'Refresh from Toggl'}
          title={`Refresh from Toggl — ${formatSyncedAt(timer.lastSyncedAt)}`}
        >
          <RefreshIcon className={syncing ? 'spin' : undefined} />
        </button>
        <button
          type="button"
          className="mini__icon-btn"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          aria-label={expanded ? 'Hide project and task' : 'Edit project and task'}
          title={expanded ? 'Hide project & task' : `Edit project & task — ${selection}`}
        >
          <ChevronIcon up={expanded} />
        </button>
        <button
          type="button"
          className={`btn-round ${running ? 'btn-round--stop' : 'btn-round--start'} mini__btn`}
          onClick={onToggleTimer}
          disabled={timer.pending}
          aria-label={running ? 'Stop timer' : 'Start timer'}
          title={running ? 'Stop timer' : 'Start timer'}
        >
          <TimerIcon running={!!running} />
        </button>
      </form>

      {expanded && (
        <div className="mini__more">
          <ProjectTaskPicker
            projectId={projectId}
            taskId={taskId}
            onChange={onPickProjectTask}
            onOpenChange={setPickOpen}
            projects={projects}
            tasks={tasks}
            compact
            ariaLabel="Project and task for this timer"
          />
        </div>
      )}
    </div>
  )
}

function TimerIcon({ running }: { running: boolean }): JSX.Element {
  return running ? (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <rect x="6" y="6" width="12" height="12" rx="2" />
    </svg>
  ) : (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M8 5v14l11-7z" />
    </svg>
  )
}

/**
 * Stroked rather than the usual filled caret: a caret only fills the middle
 * third of its viewBox, so next to the refresh glyph — which fills its box —
 * it reads as a much smaller control than it is.
 */
function ChevronIcon({ up }: { up: boolean }): JSX.Element {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.25"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={up ? 'M5 15l7-7 7 7' : 'M5 9l7 7 7-7'} />
    </svg>
  )
}

function RefreshIcon({ className }: { className?: string }): JSX.Element {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
      className={className}
    >
      <path d="M17.65 6.35A7.958 7.958 0 0 0 12 4a8 8 0 1 0 7.73 10h-2.08A6 6 0 1 1 12 6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z" />
    </svg>
  )
}
