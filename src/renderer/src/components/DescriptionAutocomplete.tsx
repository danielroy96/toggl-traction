import { useMemo, useRef, useState } from 'react'
import type { TimeEntry, TogglProject, TogglTask } from '../../../shared/types.js'

export interface EntryDetails {
  description: string
  project_id?: number | null
  task_id?: number | null
}

interface Props {
  value: string
  onChange: (value: string) => void
  /** Fired when a suggestion is chosen — copies its description + project/task. */
  onPick: (details: EntryDetails) => void
  onBlur?: () => void
  entries: TimeEntry[]
  projects: TogglProject[]
  tasks: TogglTask[]
  placeholder?: string
  ariaLabel?: string
}

/**
 * Description field with autocomplete over recent entries. Typing filters
 * distinct recent entries by description; choosing one copies its description,
 * project and task into the new entry — the quick "repeat what I did before"
 * flow.
 *
 * Implements the WAI-ARIA combobox + listbox pattern: the input owns
 * aria-expanded / aria-activedescendant, options are role="option", and
 * Up/Down/Enter/Escape work from the keyboard.
 */
export function DescriptionAutocomplete({
  value,
  onChange,
  onPick,
  onBlur,
  entries,
  projects,
  tasks,
  placeholder,
  ariaLabel
}: Props): JSX.Element {
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(-1)
  const blurTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const suggestions = useMemo(() => {
    const seen = new Set<string>()
    const distinct: EntryDetails[] = []
    for (const e of entries) {
      if (!e.description) continue
      const key = `${e.description}|${e.project_id ?? ''}|${e.task_id ?? ''}`
      if (seen.has(key)) continue
      seen.add(key)
      distinct.push({
        description: e.description,
        project_id: e.project_id ?? null,
        task_id: e.task_id ?? null
      })
    }
    const q = value.trim().toLowerCase()
    const filtered = q
      ? distinct.filter((d) => d.description.toLowerCase().includes(q))
      : distinct
    return filtered.slice(0, 8)
  }, [entries, value])

  const label = (d: EntryDetails): { project?: TogglProject; task?: TogglTask } => ({
    project: projects.find((p) => p.id === d.project_id),
    task: tasks.find((t) => t.id === d.task_id)
  })

  const canOpen = open && suggestions.length > 0

  const choose = (d: EntryDetails): void => {
    onPick(d)
    setOpen(false)
    setActive(-1)
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>): void => {
    if (!canOpen && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      setOpen(true)
      return
    }
    if (!canOpen) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((i) => (i + 1) % suggestions.length)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((i) => (i <= 0 ? suggestions.length - 1 : i - 1))
    } else if (e.key === 'Enter') {
      if (active >= 0 && active < suggestions.length) {
        e.preventDefault()
        choose(suggestions[active]!)
      }
    } else if (e.key === 'Escape') {
      setOpen(false)
      setActive(-1)
    }
  }

  return (
    <div className="autocomplete">
      <input
        className="input"
        type="text"
        role="combobox"
        aria-expanded={canOpen}
        aria-controls="ac-listbox"
        aria-autocomplete="list"
        aria-activedescendant={active >= 0 ? `ac-opt-${active}` : undefined}
        placeholder={placeholder}
        aria-label={ariaLabel}
        value={value}
        onChange={(e) => {
          onChange(e.target.value)
          setOpen(true)
          setActive(-1)
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
        onBlur={() => {
          // Delay so an option's mousedown can register before we close.
          blurTimer.current = setTimeout(() => {
            setOpen(false)
            setActive(-1)
            onBlur?.()
          }, 120)
        }}
      />
      {canOpen && (
        <ul className="autocomplete__list" id="ac-listbox" role="listbox">
          {suggestions.map((d, i) => {
            const { project, task } = label(d)
            return (
              <li
                key={`${d.description}|${d.project_id}|${d.task_id}`}
                id={`ac-opt-${i}`}
                role="option"
                aria-selected={i === active}
                className={`autocomplete__opt ${i === active ? 'autocomplete__opt--active' : ''}`}
                onMouseDown={(e) => {
                  // Prevent the input blur from firing before the click.
                  e.preventDefault()
                  if (blurTimer.current) clearTimeout(blurTimer.current)
                  choose(d)
                }}
                onMouseEnter={() => setActive(i)}
              >
                <span className="autocomplete__desc">{d.description}</span>
                {project && (
                  <span className="badge">
                    <span
                      className="project-dot"
                      style={{ background: project.color }}
                      aria-hidden="true"
                    />
                    {project.name}
                    {task && <span className="badge__task"> · {task.name}</span>}
                  </span>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
