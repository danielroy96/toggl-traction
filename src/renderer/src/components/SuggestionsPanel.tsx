import { useApp } from '../store/app.js'

/**
 * Shows tracking suggestions from the integration sources (IntelliJ window
 * detection, Jira, Google Calendar). Sources are scaffolded, so this panel
 * renders an informational empty state until an integration is enabled and
 * wired to real data. Each suggestion is a one-click start.
 */
export function SuggestionsPanel(): JSX.Element {
  const { suggestions, settings, start, projects } = useApp()
  const projectOf = (id?: number | null): { name: string; color: string } | undefined => {
    if (id == null) return undefined
    const p = projects.find((x) => x.id === id)
    return p ? { name: p.name, color: p.color } : undefined
  }
  const anyEnabled =
    !!settings &&
    (settings.integrations.windowDetection ||
      settings.integrations.jira ||
      settings.integrations.googleCalendar)

  return (
    <section className="suggestions" aria-label="Tracking suggestions">
      <h2>Suggestions</h2>
      {!anyEnabled && (
        <p className="muted">
          Enable an integration in Settings to get automatic tracking
          suggestions from your IDE, Jira or Google Calendar.
        </p>
      )}
      {anyEnabled && suggestions.length === 0 && (
        <p className="muted">No suggestions right now.</p>
      )}
      <ul className="suggestions__list">
        {suggestions.map((s) => {
          const project = projectOf(s.projectId)
          return (
            <li key={s.id} className="suggestion-row">
              <span className={`badge badge--${s.source}`}>{sourceLabel(s.source)}</span>
              <span className="suggestion-row__desc">{s.description}</span>
              {s.ticketRef && <span className="badge">{s.ticketRef}</span>}
              {project && (
                <span className="badge" title="Suggested from your history">
                  <span
                    className="project-dot"
                    style={{ background: project.color }}
                    aria-hidden="true"
                  />
                  <span className="badge__label">{project.name}</span>
                </span>
              )}
              <button
                className="btn btn--secondary suggestion-row__start"
                onClick={() =>
                  void start({
                    description: s.description,
                    projectId: s.projectId ?? null,
                    taskId: s.taskId ?? null
                  })
                }
              >
                Start
              </button>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

function sourceLabel(source: string): string {
  switch (source) {
    case 'window-detection':
      return 'IDE'
    case 'jira':
      return 'Jira'
    case 'google-calendar':
      return 'Calendar'
    default:
      return source
  }
}
