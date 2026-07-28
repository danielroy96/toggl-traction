import { useEffect, useId, useMemo, useRef, useState } from 'react'
import type { TogglProject, TogglTask } from '../../../shared/types.js'

interface Props {
  projectId: number | null
  taskId: number | null
  onChange: (projectId: number | null, taskId: number | null) => void
  projects: TogglProject[]
  tasks: TogglTask[]
  /** Compact styling for the mini timer (also renders the panel inline). */
  compact?: boolean
  /** Render the dropdown in normal flow instead of an overlay (for the mini
   *  window, whose panel would otherwise be clipped, and modals). */
  inline?: boolean
  id?: string
  ariaLabel?: string
}

interface Opt {
  key: string
  label: string
  projectId: number | null
  taskId: number | null
  color: string | null
  search: string
}

/**
 * Searchable Project + Task selector (accessible combobox).
 *
 * Replaces a native <select> — with many tasks a type-to-filter search is much
 * faster. A trigger button shows the current selection; opening reveals a search
 * box and a filtered listbox of "Project · Task" options. Keyboard: type to
 * filter, Up/Down to move, Enter to choose, Escape to close.
 */
export function ProjectTaskPicker({
  projectId,
  taskId,
  onChange,
  projects,
  tasks,
  compact,
  inline,
  id,
  ariaLabel = 'Project and task'
}: Props): JSX.Element {
  const uid = useId()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const rootRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const panelInline = compact || inline

  const options = useMemo<Opt[]>(() => {
    const opts: Opt[] = [
      { key: 'none', label: 'No project', projectId: null, taskId: null, color: null, search: 'no project' }
    ]
    for (const p of projects) {
      opts.push({
        key: `p${p.id}`,
        label: p.name,
        projectId: p.id,
        taskId: null,
        color: p.color,
        search: p.name.toLowerCase()
      })
      for (const t of tasks.filter((t) => t.project_id === p.id)) {
        opts.push({
          key: `t${p.id}-${t.id}`,
          label: `${p.name} · ${t.name}`,
          projectId: p.id,
          taskId: t.id,
          color: p.color,
          search: `${p.name} ${t.name}`.toLowerCase()
        })
      }
    }
    return opts
  }, [projects, tasks])

  const selected =
    options.find((o) => o.projectId === (projectId ?? null) && o.taskId === (taskId ?? null)) ??
    options[0]!

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return q ? options.filter((o) => o.search.includes(q)) : options
  }, [options, query])

  useEffect(() => setActive(0), [query])

  // Close on outside interaction.
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent): void => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  useEffect(() => {
    if (open) inputRef.current?.focus()
  }, [open])

  // Keep the active option scrolled into view.
  useEffect(() => {
    if (!open) return
    document.getElementById(`${uid}-opt-${active}`)?.scrollIntoView({ block: 'nearest' })
  }, [active, open, uid])

  const openPanel = (): void => {
    setQuery('')
    setActive(Math.max(0, options.findIndex((o) => o.key === selected.key)))
    setOpen(true)
  }

  const choose = (o: Opt): void => {
    onChange(o.projectId, o.taskId)
    setOpen(false)
    setQuery('')
  }

  const onKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((i) => Math.min(i + 1, filtered.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((i) => Math.max(i - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (filtered[active]) choose(filtered[active]!)
    } else if (e.key === 'Escape') {
      e.preventDefault()
      setOpen(false)
    }
  }

  return (
    <div
      className={`ptpick ${compact ? 'ptpick--compact' : ''} ${panelInline ? 'ptpick--inline' : ''}`}
      ref={rootRef}
    >
      <button
        type="button"
        id={id}
        className="ptpick__trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`${ariaLabel}: ${selected.label}`}
        onClick={() => (open ? setOpen(false) : openPanel())}
      >
        {!compact && (
          <span
            className="project-dot"
            style={{ background: selected.color ?? 'var(--border-strong)' }}
            aria-hidden="true"
          />
        )}
        <span className="ptpick__value">{selected.label}</span>
        <svg
          className="ptpick__caret"
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="currentColor"
          aria-hidden="true"
        >
          <path d="M7 10l5 5 5-5z" />
        </svg>
      </button>

      {open && (
        <div className="ptpick__panel">
          <input
            ref={inputRef}
            className="input ptpick__search"
            type="text"
            role="combobox"
            aria-expanded="true"
            aria-controls={`${uid}-list`}
            aria-activedescendant={filtered[active] ? `${uid}-opt-${active}` : undefined}
            aria-autocomplete="list"
            aria-label="Search projects and tasks"
            placeholder="Search projects & tasks…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
          />
          <ul className="ptpick__list" id={`${uid}-list`} role="listbox" aria-label={ariaLabel}>
            {filtered.length === 0 && <li className="ptpick__empty">No matches</li>}
            {filtered.map((o, i) => (
              <li
                key={o.key}
                id={`${uid}-opt-${i}`}
                role="option"
                aria-selected={o.key === selected.key}
                className={`ptpick__opt ${i === active ? 'ptpick__opt--active' : ''}`}
                onMouseDown={(e) => {
                  e.preventDefault()
                  choose(o)
                }}
                onMouseEnter={() => setActive(i)}
              >
                <span
                  className="project-dot"
                  style={{ background: o.color ?? 'var(--border-strong)' }}
                  aria-hidden="true"
                />
                <span className="ptpick__opt-label">{o.label}</span>
                {o.key === selected.key && (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                    <path d="M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4z" />
                  </svg>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
