import { useMemo, useState } from 'react'
import { useApp } from '../store/app.js'
import type { TimeEntry } from '../../../shared/types.js'
import { Modal } from './Modal.js'
import { ProjectTaskPicker } from './ProjectTaskPicker.js'
import { fromLocalInput, toLocalInput, formatDuration } from '../lib/format.js'

interface Props {
  entry: TimeEntry
  onClose: () => void
}

/**
 * Rich editor for a time entry — works for both the running entry and finished
 * ones. Lets the user change description, project/task, and (for finished
 * entries) the start and stop times, or delete the entry entirely.
 */
export function EntryEditor({ entry, onClose }: Props): JSX.Element {
  const { projects, tasks, editEntry, deleteEntry } = useApp()
  const isRunning = !entry.stop

  const [description, setDescription] = useState(entry.description)
  const [projectId, setProjectId] = useState<number | null>(entry.project_id ?? null)
  const [taskId, setTaskId] = useState<number | null>(entry.task_id ?? null)
  const [start, setStart] = useState(toLocalInput(entry.start))
  const [stop, setStop] = useState(entry.stop ? toLocalInput(entry.stop) : '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const durationSeconds = useMemo(() => {
    if (isRunning) return null
    const s = new Date(fromLocalInput(start)).getTime()
    const e = new Date(fromLocalInput(stop)).getTime()
    return Math.round((e - s) / 1000)
  }, [start, stop, isRunning])

  const invalidRange = durationSeconds != null && durationSeconds < 0

  const onSave = async (): Promise<void> => {
    if (invalidRange) {
      setError('The stop time must be after the start time.')
      return
    }
    setBusy(true)
    setError(null)
    const patch: Partial<TimeEntry> = {
      description: description.trim(),
      project_id: projectId,
      task_id: taskId,
      start: fromLocalInput(start)
    }
    if (!isRunning) {
      patch.stop = fromLocalInput(stop)
      patch.duration = durationSeconds ?? 0
    }
    try {
      await editEntry(entry.id, patch)
      onClose()
    } catch {
      // editEntry already surfaced a toast; keep the dialog open to retry.
      setBusy(false)
    }
  }

  const onDelete = async (): Promise<void> => {
    if (!confirm('Delete this time entry? This cannot be undone.')) return
    setBusy(true)
    await deleteEntry(entry.id)
    onClose()
  }

  return (
    <Modal title={isRunning ? 'Edit running entry' : 'Edit time entry'} onClose={onClose}>
      <div className="field">
        <label htmlFor="edit-desc">Description</label>
        <input
          id="edit-desc"
          className="input"
          type="text"
          value={description}
          placeholder="What did you work on?"
          onChange={(e) => setDescription(e.target.value)}
        />
      </div>

      <div className="field">
        <label htmlFor="edit-project">Project &amp; task</label>
        <ProjectTaskPicker
          id="edit-project"
          projectId={projectId}
          taskId={taskId}
          onChange={(p, t) => {
            setProjectId(p)
            setTaskId(t)
          }}
          projects={projects}
          tasks={tasks}
          inline
        />
      </div>

      <div className="edit-times">
        <div className="field">
          <label htmlFor="edit-start">Start</label>
          <input
            id="edit-start"
            className="input"
            type="datetime-local"
            value={start}
            onChange={(e) => setStart(e.target.value)}
          />
        </div>
        {!isRunning && (
          <div className="field">
            <label htmlFor="edit-stop">Stop</label>
            <input
              id="edit-stop"
              className="input"
              type="datetime-local"
              value={stop}
              onChange={(e) => setStop(e.target.value)}
            />
          </div>
        )}
      </div>

      {durationSeconds != null && !invalidRange && (
        <p className="hint">
          Duration: <span className="mono">{formatDuration(durationSeconds)}</span>
        </p>
      )}
      {isRunning && (
        <p className="hint">This entry is still running; stop it to set an end time.</p>
      )}
      {error && (
        <div className="alert alert--error" role="alert">
          {error}
        </div>
      )}

      <div className="modal__actions">
        <button className="btn btn--danger" onClick={() => void onDelete()} disabled={busy}>
          Delete
        </button>
        <div className="modal__actions-right">
          <button className="btn btn--secondary" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button className="btn btn--accent" onClick={() => void onSave()} disabled={busy}>
            {busy ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      </div>
    </Modal>
  )
}
