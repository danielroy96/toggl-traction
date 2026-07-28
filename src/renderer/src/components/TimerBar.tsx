import { useEffect, useState } from 'react'
import { useApp } from '../store/app.js'
import { useElapsed } from '../lib/useElapsed.js'
import { formatDuration } from '../lib/format.js'
import { ProjectTaskPicker } from './ProjectTaskPicker.js'
import { DescriptionAutocomplete, type EntryDetails } from './DescriptionAutocomplete.js'

/**
 * The primary timer control: a description field, project/task picker and a
 * large start/stop button. Start/stop is guarded by `timer.pending` so a
 * double-click cannot fire two requests — the main-process TimerManager also
 * serialises them as a second line of defence.
 */
export function TimerBar(): JSX.Element {
  const { timer, start, stop, projects, tasks, entries, setEntryProjectTask, editEntry } =
    useApp()
  const running = timer.running
  const elapsed = useElapsed(running?.start ?? null)

  const [description, setDescription] = useState('')
  const [projectId, setProjectId] = useState<number | null>(null)
  const [taskId, setTaskId] = useState<number | null>(null)

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
  )
}

function PlayIcon(): JSX.Element {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true" fill="currentColor">
      <path d="M8 5v14l11-7z" />
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
