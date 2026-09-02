import { useEffect, useState } from 'react'
import { useApp } from '../store/app.js'
import { useElapsed } from '../lib/useElapsed.js'
import { formatDuration, formatSyncedAt } from '../lib/format.js'
import { ProjectTaskPicker } from './ProjectTaskPicker.js'
import { DescriptionAutocomplete, type EntryDetails } from './DescriptionAutocomplete.js'
import { EntryEditor } from './EntryEditor.js'

/**
 * The primary timer control: a description field, project/task picker and a
 * large start/stop button. Start/stop is guarded by `timer.pending` so a
 * double-click cannot fire two requests — the main-process TimerManager also
 * serialises them as a second line of defence.
 */
export function TimerBar(): JSX.Element {
  const {
    timer,
    start,
    stop,
    projects,
    tasks,
    entries,
    setEntryProjectTask,
    editEntry,
    syncing,
    syncNow
  } = useApp()
  const running = timer.running
  const elapsed = useElapsed(running?.start ?? null)

  const [description, setDescription] = useState('')
  const [projectId, setProjectId] = useState<number | null>(null)
  const [taskId, setTaskId] = useState<number | null>(null)
  // Opens the full entry editor for the running timer, where the start time can
  // be overridden (e.g. when you started tracking late).
  const [editing, setEditing] = useState(false)

  // When a timer is running, mirror its description/project/task into the fields.
  useEffect(() => {
    if (running) {
      setDescription(running.description ?? '')
      setProjectId(running.project_id ?? null)
      setTaskId(running.task_id ?? null)
    }
  }, [running?.id])

  const onPrimary = (): void => {
    if (timer.pending) return
    if (running) {
      void stop()
      // Clear the detail fields on stop: the user has finished this entry and
      // is likely about to start a different one from a clean slate.
      setDescription('')
      setProjectId(null)
      setTaskId(null)
    } else {
      void start({ description: description.trim(), projectId, taskId })
    }
  }

  // For a running timer, persist description edits when the field loses focus
  // or Enter is pressed (avoids a request per keystroke).
  const saveRunningDescription = (): void => {
    if (running && description.trim() !== (running.description ?? '')) {
      void editEntry(running.id, { description: description.trim() })
    }
  }

  const onSubmit = (e: React.FormEvent): void => {
    e.preventDefault()
    if (running) saveRunningDescription()
    else onPrimary()
  }

  // Changing the picker updates local state; if a timer is running, also push
  // the change to that entry so the project/task is reassigned live.
  const onPickProjectTask = (pid: number | null, tid: number | null): void => {
    setProjectId(pid)
    setTaskId(tid)
    if (running) void setEntryProjectTask(running.id, pid, tid)
  }

  // Copy a recent entry's details (description + project/task) into the fields.
  const onPickSuggestion = (d: EntryDetails): void => {
    const pid = d.project_id ?? null
    const tid = d.task_id ?? null
    setDescription(d.description)
    setProjectId(pid)
    setTaskId(tid)
    if (running) {
      void editEntry(running.id, {
        description: d.description,
        project_id: pid,
        task_id: tid
      })
    }
  }

  return (
    <>
    <form className="timer-bar" onSubmit={onSubmit} aria-label="Timer">
      <div className="timer-bar__desc">
        <DescriptionAutocomplete
          value={description}
          onChange={setDescription}
          onPick={onPickSuggestion}
          onBlur={saveRunningDescription}
          entries={entries}
          projects={projects}
          tasks={tasks}
          placeholder="What are you working on?"
          ariaLabel="Time entry description"
        />
      </div>

      <ProjectTaskPicker
        projectId={projectId}
        taskId={taskId}
        onChange={onPickProjectTask}
        projects={projects}
        tasks={tasks}
      />

      <div
        className="timer-bar__elapsed mono"
        role="timer"
        aria-live={running ? 'off' : 'polite'}
        aria-label={running ? `Elapsed time ${formatDuration(elapsed)}` : 'Timer stopped'}
      >
        {formatDuration(running ? elapsed : 0)}
      </div>

      {/* Toggl is the source of truth and it can be changed from anywhere (web,
          mobile, another device). The main process reconciles on a slow timer to
          stay inside the API rate limit, so this is the escape hatch for when
          you want the app caught up right now. */}
      <button
        type="button"
        className="icon-btn"
        onClick={() => void syncNow()}
        disabled={syncing}
        aria-label={syncing ? 'Refreshing from Toggl' : 'Refresh from Toggl'}
        title={`Refresh from Toggl — ${formatSyncedAt(timer.lastSyncedAt)}`}
      >
        <RefreshIcon className={syncing ? 'spin' : undefined} />
      </button>

      {running && (
        <button
          type="button"
          className="icon-btn"
          onClick={() => setEditing(true)}
          aria-label="Edit running entry, including its start time"
          title="Edit entry / adjust start time"
        >
          <EditIcon />
        </button>
      )}

      <button
        type="button"
        className={`btn-round ${running ? 'btn-round--stop' : 'btn-round--start'}`}
        onClick={onPrimary}
        disabled={timer.pending}
        aria-label={running ? 'Stop timer' : 'Start timer'}
        title={running ? 'Stop timer' : 'Start timer'}
      >
        {timer.pending ? (
          <Spinner />
        ) : running ? (
          <StopIcon />
        ) : (
          <PlayIcon />
        )}
      </button>

      {projectId != null && (
        <span className="sr-only">
          Current project: {projects.find((p) => p.id === projectId)?.name}
          {taskId != null && `, task ${tasks.find((t) => t.id === taskId)?.name}`}
        </span>
      )}
    </form>

      {running && editing && (
        <EntryEditor entry={running} onClose={() => setEditing(false)} />
      )}
    </>
  )
}

function PlayIcon(): JSX.Element {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true" fill="currentColor">
      <path d="M8 5v14l11-7z" />
    </svg>
  )
}
function RefreshIcon({ className }: { className?: string }): JSX.Element {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      aria-hidden="true"
      fill="currentColor"
      className={className}
    >
      <path d="M17.65 6.35A7.958 7.958 0 0 0 12 4a8 8 0 1 0 7.73 10h-2.08A6 6 0 1 1 12 6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z" />
    </svg>
  )
}
function EditIcon(): JSX.Element {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true" fill="currentColor">
      <path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z" />
    </svg>
  )
}
function StopIcon(): JSX.Element {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true" fill="currentColor">
      <rect x="6" y="6" width="12" height="12" rx="2" />
    </svg>
  )
}
function Spinner(): JSX.Element {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      aria-hidden="true"
      className="spin"
      fill="none"
      stroke="currentColor"
      strokeWidth="3"
    >
      <circle cx="12" cy="12" r="9" opacity="0.3" />
      <path d="M21 12a9 9 0 0 0-9-9" />
    </svg>
  )
}
