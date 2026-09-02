import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { JSX } from 'react'
import type { TogglProject, TogglTask } from '../../../shared/types.js'
import { useDismiss } from '../lib/useDismiss.js'

interface Props {
  projectId: number | null
  taskId: number | null
  onChange: (projectId: number | null, taskId: number | null) => void
  /** Fired when the panel opens or closes. Lets a caller whose container is
   *  sized to its content (the mini window) make room for it. */
  onOpenChange?: (open: boolean) => void
  projects: TogglProject[]
  tasks: TogglTask[]
  /** Compact styling (smaller trigger) for the mini timer. */
  compact?: boolean
  /** Render the panel in normal flow instead of an overlay, for containers that
   *  would clip an overlay and cannot be grown to fit one (e.g. a modal). */
  inline?: boolean
  id?: string
  ariaLabel?: string
}

interface Opt {
  key: string
  /** Full "Project · Task" path: the trigger's label and the accessible name. */
  label: string
  /** What the row shows — for a task, just its own name; the project is the
   *  line above it. */
  display: string
  /** The two halves of `label`, so the trigger can truncate the project and
   *  keep the task. Absent for "No project", which is neither. */
  project?: string
  task?: string
  projectId: number | null
  taskId: number | null
  color: string | null
  /** True for a task, which renders indented under its project. */
  nested: boolean
}

/**
 * One line of the panel: either a selectable option, or a project acting purely
 * as a heading for the tasks beneath it (used when the project itself did not
 * match the search, so offering it as a choice would invite a mis-hit).
 */
type Row =
  | { kind: 'option'; opt: Opt; index: number }
  | { kind: 'group'; key: string; project: TogglProject }

/**
 * Searchable Project + Task selector (accessible combobox).
 *
 * Replaces a native <select> — with many tasks a type-to-filter search is much
 * faster. A trigger button shows the current selection; opening reveals a search
 * box and a filtered listbox. Keyboard: type to filter, Up/Down to move, Enter
 * to choose, Escape to close.
 *
 * The list is a hierarchy: each project appears once, with its tasks indented
 * beneath it showing only their own names. Repeating "Project · Task" on every
 * row spent the whole width of the panel on a name the reader had already seen
 * several rows running, and the task — the part that actually tells the options
 * apart — was what got ellipsised away. Options still carry the full path as
 * their accessible name, so nothing is lost to a screen reader.
 */
export function ProjectTaskPicker({
  projectId,
  taskId,
  onChange,
  onOpenChange,
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
  const triggerRef = useRef<HTMLButtonElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLUListElement>(null)

  // A layout effect so a caller sizing around the panel can do so before the
  // frame is painted rather than a frame late.
  const openChangeRef = useRef(onOpenChange)
  useLayoutEffect(() => {
    openChangeRef.current = onOpenChange
  })
  useLayoutEffect(() => {
    openChangeRef.current?.(open)
  }, [open])

  const groups = useMemo(
    () =>
      projects.map((project) => ({
        project,
        tasks: tasks.filter((t) => t.project_id === project.id)
      })),
    [projects, tasks]
  )

  /** Every selectable option, unfiltered — resolves the current selection and
   *  the initial keyboard position (the search box is empty on open). */
  const allOptions = useMemo<Opt[]>(() => {
    const out: Opt[] = [NO_PROJECT]
    for (const { project, tasks: ts } of groups) {
      out.push(projectOpt(project))
      for (const t of ts) out.push(taskOpt(project, t))
    }
    return out
  }, [groups])

  const selected =
    allOptions.find(
      (o) => o.projectId === (projectId ?? null) && o.taskId === (taskId ?? null)
    ) ?? allOptions[0]!

  /** The filtered panel contents: `rows` is what we draw, `options` is what the
   *  keyboard walks (headings are skipped). */
  const { rows, options } = useMemo(() => {
    const q = query.trim().toLowerCase()
    const rows: Row[] = []
    const options: Opt[] = []
    const pushOption = (opt: Opt): void => {
      rows.push({ kind: 'option', opt, index: options.length })
      options.push(opt)
    }

    if (!q || 'no project'.includes(q)) pushOption(NO_PROJECT)

    for (const { project, tasks: ts } of groups) {
      const projectMatches = !q || project.name.toLowerCase().includes(q)
      // Tasks match on "Project Task" so a query can still span both, as it
      // could when every row spelled out the whole path.
      const shownTasks =
        q && !projectMatches
          ? ts.filter((t) => `${project.name} ${t.name}`.toLowerCase().includes(q))
          : ts
      if (!projectMatches && shownTasks.length === 0) continue
      if (projectMatches) pushOption(projectOpt(project))
      else rows.push({ kind: 'group', key: `g${project.id}`, project })
      for (const t of shownTasks) pushOption(taskOpt(project, t))
    }
    return { rows, options }
  }, [groups, query])

  useEffect(() => setActive(0), [query])

  // Pointer press outside, focus leaving, or the window being deactivated.
  // Focus is not restored for any of these: the user has already moved it (or
  // left), and yanking it back to the trigger would fight them.
  useDismiss(open, rootRef, () => setOpen(false))

  useEffect(() => {
    // preventScroll: focusing a control the browser thinks is off-screen (the
    // panel briefly is, in the mini window, until it has been made room for)
    // otherwise scrolls an ancestor to reveal it — which drags the whole UI.
    if (open) inputRef.current?.focus({ preventScroll: true })
  }, [open])

  // Keep the active option in view by scrolling the list and nothing else.
  // scrollIntoView() would be shorter but it walks up every scrollable ancestor
  // — including the document — so in the mini window it shunted the card off
  // the top of the window instead of just scrolling the list.
  useEffect(() => {
    if (!open) return
    const list = listRef.current
    const opt = document.getElementById(`${uid}-opt-${active}`)
    if (!list || !opt) return
    const l = list.getBoundingClientRect()
    const o = opt.getBoundingClientRect()
    if (o.top < l.top) list.scrollTop -= l.top - o.top
    else if (o.bottom > l.bottom) list.scrollTop += o.bottom - l.bottom
  }, [active, open, uid])

  const openPanel = (): void => {
    setQuery('')
    setActive(Math.max(0, allOptions.findIndex((o) => o.key === selected.key)))
    setOpen(true)
  }

  /**
   * Close and put focus back on the trigger. Used by every dismissal the user
   * drives from the keyboard (Escape) or by choosing an option: focus is inside
   * the panel, and the panel is about to unmount, so without this it would fall
   * to <body> and the next Tab would restart from the top of the window.
   */
  const closeToTrigger = (): void => {
    setOpen(false)
    setQuery('')
    // preventScroll for the same reason the search box uses it: in the mini
    // window the control can briefly be off-screen, and focusing it would
    // otherwise scroll an ancestor and drag the whole card.
    triggerRef.current?.focus({ preventScroll: true })
  }

  const choose = (o: Opt): void => {
    onChange(o.projectId, o.taskId)
    closeToTrigger()
  }

  // On the root, not the search box: Escape has to work wherever focus is
  // inside the picker, and the panel holds more than one focusable element.
  const onRootKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'Escape' && open) {
      e.preventDefault()
      // Stop it here — in the entry editor this picker sits inside a modal that
      // also closes on Escape, and one key press should dismiss one thing.
      e.stopPropagation()
      closeToTrigger()
    }
  }

  const onSearchKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((i) => Math.min(i + 1, options.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((i) => Math.max(i - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (options[active]) choose(options[active]!)
    }
  }

  return (
    <div
      className={`ptpick ${compact ? 'ptpick--compact' : ''} ${inline ? 'ptpick--inline' : ''}`}
      ref={rootRef}
      onKeyDown={onRootKeyDown}
    >
      <button
        type="button"
        ref={triggerRef}
        id={id}
        className="ptpick__trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`${ariaLabel}: ${selected.label}`}
        // The trigger is narrow enough to ellipsise a full "Project · Task"
        // path, so the whole thing has to be readable on hover too.
        title={selected.label}
        onClick={() => (open ? setOpen(false) : openPanel())}
      >
        {/* Always shown: a project/task name is never displayed without the
            colour that identifies it. */}
        <span
          className="project-dot"
          style={{ background: selected.color ?? 'var(--border-strong)' }}
          aria-hidden="true"
        />
        <span className="ptpick__value">
          <span className="ptpick__value-project">{selected.project ?? selected.label}</span>
          {selected.task && (
            <span className="ptpick__value-task">{`· ${selected.task}`}</span>
          )}
        </span>
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
            aria-activedescendant={options[active] ? `${uid}-opt-${active}` : undefined}
            aria-autocomplete="list"
            aria-label="Search projects and tasks"
            placeholder="Search projects & tasks…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onSearchKeyDown}
          />
          <ul
            ref={listRef}
            className="ptpick__list"
            id={`${uid}-list`}
            role="listbox"
            aria-label={ariaLabel}
          >
            {options.length === 0 && <li className="ptpick__empty">No matches</li>}
            {rows.map((row) =>
              row.kind === 'group' ? (
                <li key={row.key} className="ptpick__group" role="presentation">
                  <span
                    className="project-dot"
                    style={{ background: row.project.color }}
                    aria-hidden="true"
                  />
                  <span className="ptpick__opt-label">{row.project.name}</span>
                </li>
              ) : (
                <li
                  key={row.opt.key}
                  id={`${uid}-opt-${row.index}`}
                  role="option"
                  aria-selected={row.opt.key === selected.key}
                  /* A task row shows only its own name, so the accessible name
                     keeps the project: never ambiguous read aloud. */
                  aria-label={row.opt.nested ? row.opt.label : undefined}
                  className={[
                    'ptpick__opt',
                    row.opt.nested ? 'ptpick__opt--task' : '',
                    row.index === active ? 'ptpick__opt--active' : ''
                  ]
                    .filter(Boolean)
                    .join(' ')}
                  style={
                    row.opt.nested
                      ? ({ '--guide': row.opt.color } as React.CSSProperties)
                      : undefined
                  }
                  onMouseDown={(e) => {
                    e.preventDefault()
                    choose(row.opt)
                  }}
                  onMouseEnter={() => setActive(row.index)}
                >
                  {!row.opt.nested && (
                    <span
                      className="project-dot"
                      style={{ background: row.opt.color ?? 'var(--border-strong)' }}
                      aria-hidden="true"
                    />
                  )}
                  <span className="ptpick__opt-label">{row.opt.display}</span>
                  {row.opt.key === selected.key && (
                    <svg
                      width="16"
                      height="16"
                      viewBox="0 0 24 24"
                      fill="currentColor"
                      aria-hidden="true"
                    >
                      <path d="M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4z" />
                    </svg>
                  )}
                </li>
              )
            )}
          </ul>
        </div>
      )}
    </div>
  )
}

const NO_PROJECT: Opt = {
  key: 'none',
  label: 'No project',
  display: 'No project',
  projectId: null,
  taskId: null,
  color: null,
  nested: false
}

function projectOpt(p: TogglProject): Opt {
  return {
    key: `p${p.id}`,
    label: p.name,
    display: p.name,
    project: p.name,
    projectId: p.id,
    taskId: null,
    color: p.color,
    nested: false
  }
}

function taskOpt(p: TogglProject, t: TogglTask): Opt {
  return {
    key: `t${p.id}-${t.id}`,
    label: `${p.name} · ${t.name}`,
    display: t.name,
    project: p.name,
    task: t.name,
    projectId: p.id,
    taskId: t.id,
    color: p.color,
    nested: true
  }
}
