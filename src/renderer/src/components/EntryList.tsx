import { useMemo, useState } from 'react'
import { useApp } from '../store/app.js'
import type { TimeEntry } from '../../../shared/types.js'
import {
  formatClock,
  formatDayHeading,
  formatDurationCompact
} from '../lib/format.js'
import { EntryEditor } from './EntryEditor.js'

/**
 * A grouped list of recent, completed time entries. Each row can be edited
 * (click the description), resumed (starts a new timer with the same
 * description/project/task) or deleted.
 */
export function EntryList(): JSX.Element {
  const { entries, projects, tasks, start, deleteEntry } = useApp()
  const [editing, setEditing] = useState<TimeEntry | null>(null)

  const groups = useMemo(() => {
    const completed = entries.filter((e) => e.stop) // exclude the running one
    const byDay = new Map<string, TimeEntry[]>()
    for (const e of completed) {
      const key = new Date(e.start).toDateString()
      const list = byDay.get(key) ?? []
      list.push(e)
      byDay.set(key, list)
    }
    return [...byDay.entries()].sort(
      (a, b) => new Date(b[0]).getTime() - new Date(a[0]).getTime()
    )
  }, [entries])

  if (groups.length === 0) {
    return (
      <p className="empty" role="status">
        No time entries yet. Start a timer above to track your first entry.
      </p>
    )
  }

  return (
    <div className="entry-list">
      {editing && (
        <EntryEditor entry={editing} onClose={() => setEditing(null)} />
      )}
      {groups.map(([day, list]) => {
        const total = list.reduce((s, e) => s + Math.max(0, e.duration), 0)
        return (
          <section key={day} aria-label={formatDayHeading(list[0]!.start)}>
            <header className="entry-list__day">
              <h3>{formatDayHeading(list[0]!.start)}</h3>
              <span className="mono entry-list__day-total">
                {formatDurationCompact(total)}
              </span>
            </header>
            <ul className="entry-list__items">
              {list.map((e) => {
                const project = projects.find((p) => p.id === e.project_id)
                const task = tasks.find((t) => t.id === e.task_id)
                return (
                  <li key={e.id} className="entry-row">
                    <span
                      className="project-dot"
                      style={{ background: project?.color ?? 'var(--border-strong)' }}
                      aria-hidden="true"
                    />
                    <button
                      className="entry-row__desc entry-row__edit"
                      onClick={() => setEditing(e)}
                      title="Edit entry"
                      aria-label={`Edit "${e.description || 'entry'}"`}
                    >
                      {e.description || <em className="muted">(no description)</em>}
                    </button>
                    <span className="entry-row__meta">
                      {project && (
                        <span className="badge">
                          {project.name}
                          {task && <span className="badge__task"> · {task.name}</span>}
                        </span>
                      )}
                      <span className="entry-row__time muted mono">
                        {formatClock(e.start)}–{e.stop ? formatClock(e.stop) : ''}
                      </span>
                      <span className="entry-row__dur mono">
                        {formatDurationCompact(Math.max(0, e.duration))}
                      </span>
                    </span>
                    <span className="entry-row__actions">
                      <button
                        className="icon-btn"
                        aria-label={`Resume "${e.description || 'entry'}"`}
                        title="Resume"
                        onClick={() =>
                          void start({
                            description: e.description,
                            projectId: e.project_id ?? null,
                            taskId: e.task_id ?? null
                          })
                        }
                      >
                        <ResumeIcon />
                      </button>
                      <button
                        className="icon-btn"
                        aria-label={`Delete "${e.description || 'entry'}"`}
                        title="Delete"
                        onClick={() => {
                          if (confirm('Delete this time entry? This cannot be undone.')) {
                            void deleteEntry(e.id)
                          }
                        }}
                      >
                        <TrashIcon />
                      </button>
                    </span>
                  </li>
                )
              })}
            </ul>
          </section>
        )
      })}
    </div>
  )
}

function ResumeIcon(): JSX.Element {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M8 5v14l11-7z" />
    </svg>
  )
}
function TrashIcon(): JSX.Element {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M6 7h12l-1 13H7L6 7zm3-3h6l1 2H8l1-2z" />
    </svg>
  )
}
