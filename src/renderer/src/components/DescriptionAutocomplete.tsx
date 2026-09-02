import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { JSX } from 'react'
import type { TimeEntry, TogglProject, TogglTask } from '../../../shared/types.js'
import { useDismiss } from '../lib/useDismiss.js'

/** How a suggestion was chosen. Enter is a commit; a click only fills in. */
export type PickVia = 'enter' | 'pointer'

/**
 * A project/task tag rendered inside the field, after the text. Use it where
 * the project/task picker is not on screen, so the field still says what the
 * entry will be booked against — the dot carries the project colour, exactly as
 * it does in the suggestion list below.
 */
export interface FieldTag {
  label: string
  color: string | null
  /** Full "Project · Task" for the tooltip, when `label` is only part of it. */
  title?: string
}

export interface EntryDetails {
  description: string
  project_id?: number | null
  task_id?: number | null
}

interface Props {
  value: string
  onChange: (value: string) => void
  /** Fired when a suggestion is chosen — copies its description + project/task.
   *  `via` lets a caller treat Enter as a commit (the mini timer starts the
   *  timer on it) while a click just fills the fields. */
  onPick: (details: EntryDetails, via: PickVia) => void
  onBlur?: () => void
  /** Fired when the suggestion list appears or disappears. Lets a caller whose
   *  container is sized to its content (the mini window) make room for it. */
  onOpenChange?: (open: boolean) => void
  entries: TimeEntry[]
  projects: TogglProject[]
  tasks: TogglTask[]
  placeholder?: string
  ariaLabel?: string
  /** Project/task shown inside the field. Omit where a picker is visible. */
  tag?: FieldTag | null
  /** Compact styling (smaller field and options) for the mini timer. */
  compact?: boolean
  /** Render the list in normal flow instead of an overlay, for containers that
   *  would clip an overlay and cannot be grown to fit one. */
  inline?: boolean
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
  onOpenChange,
  entries,
  projects,
  tasks,
  placeholder,
  ariaLabel,
  tag,
  compact,
  inline
}: Props): JSX.Element {
  const uid = useId()
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(-1)
  const blurTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  /**
   * Set when the whole window was deactivated while this field had focus.
   *
   * Deactivating fires `blur` on the input (with DOM focus still on it) and
   * reactivating fires `focus` again. Left alone, that closes the list and then
   * immediately reopens it — and in a window sized to its content, that is a
   * shrink followed by a grow. It was observed cycling indefinitely. Closing is
   * right; reopening unasked is not, so the next focus is swallowed instead.
   */
  const reopenSuppressed = useRef(false)

  useEffect(() => {
    const onWindowBlur = (): void => {
      reopenSuppressed.current = document.activeElement === inputRef.current
      setOpen(false)
      setActive(-1)
    }
    window.addEventListener('blur', onWindowBlur)
    return () => window.removeEventListener('blur', onWindowBlur)
  }, [])

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

  const close = (): void => {
    setOpen(false)
    setActive(-1)
  }

  /*
   * A pointer press outside the field, or focus leaving it, closes the list
   * immediately. The input's own onBlur below would get there eventually, but
   * only after its 120ms grace period — which exists to let an option's
   * mousedown land, not to keep a dead list on screen.
   *
   * Window deactivation is left to the listener above: that case also has to
   * suppress the reopen that reactivating would otherwise trigger.
   */
  useDismiss(canOpen, rootRef, (reason) => {
    if (reason !== 'window-blur') close()
  })

  // Report the state that actually matters to a caller sizing around us: not
  // `open`, but whether a list is on screen. A layout effect so the caller can
  // resize before the frame is painted rather than a frame late.
  const openChangeRef = useRef(onOpenChange)
  useLayoutEffect(() => {
    openChangeRef.current = onOpenChange
  })
  useLayoutEffect(() => {
    openChangeRef.current?.(canOpen)
  }, [canOpen])

  const choose = (d: EntryDetails, via: PickVia): void => {
    onPick(d, via)
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
        // preventDefault stops the implicit form submit, so choosing a
        // suggestion never also fires the form's own Enter handling.
        e.preventDefault()
        choose(suggestions[active]!, 'enter')
      }
    } else if (e.key === 'Escape') {
      e.preventDefault()
      // One Escape dismisses one thing: without this it would also reach an
      // enclosing dialog and close that too.
      e.stopPropagation()
      close()
    }
  }

  return (
    <div
      className={`autocomplete ${compact ? 'autocomplete--compact' : ''} ${
        inline ? 'autocomplete--inline' : ''
      } ${tag ? 'autocomplete--tagged' : ''}`}
      ref={rootRef}
    >
      <div className="autocomplete__field">
        <input
          ref={inputRef}
          className="input"
          type="text"
          role="combobox"
          aria-expanded={canOpen}
          aria-controls={`${uid}-listbox`}
          aria-autocomplete="list"
          aria-activedescendant={active >= 0 ? `${uid}-opt-${active}` : undefined}
          placeholder={placeholder}
          aria-label={ariaLabel}
          value={value}
          onChange={(e) => {
            onChange(e.target.value)
            setOpen(true)
            setActive(-1)
          }}
          onFocus={() => {
            // Swallow the focus that merely comes from the window being reactivated.
            if (reopenSuppressed.current) {
              reopenSuppressed.current = false
              return
            }
            setOpen(true)
          }}
          onMouseDown={() => {
            // An explicit click on the field is always a request to see the list,
            // including the click that reactivates the window (see above).
            reopenSuppressed.current = false
            setOpen(true)
          }}
          onKeyDown={onKeyDown}
          onBlur={() => {
            // Delay so an option's mousedown can register before we close.
            blurTimer.current = setTimeout(() => {
              close()
              onBlur?.()
            }, 120)
          }}
        />
        {tag && (
          <span className="autocomplete__tag" title={tag.title ?? tag.label}>
            <span
              className="project-dot"
              style={{ background: tag.color ?? 'var(--border-strong)' }}
              aria-hidden="true"
            />
            <span className="autocomplete__tag-label">{tag.label}</span>
          </span>
        )}
      </div>
      {canOpen && (
        <ul className="autocomplete__list" id={`${uid}-listbox`} role="listbox">
          {suggestions.map((d, i) => {
            const { project, task } = label(d)
            return (
              <li
                key={`${d.description}|${d.project_id}|${d.task_id}`}
                id={`${uid}-opt-${i}`}
                role="option"
                aria-selected={i === active}
                className={`autocomplete__opt ${i === active ? 'autocomplete__opt--active' : ''}`}
                onMouseDown={(e) => {
                  // Prevent the input blur from firing before the click.
                  e.preventDefault()
                  if (blurTimer.current) clearTimeout(blurTimer.current)
                  choose(d, 'pointer')
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
                    <span className="badge__label">
                      {project.name}
                      {task && <span className="badge__task"> · {task.name}</span>}
                    </span>
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
