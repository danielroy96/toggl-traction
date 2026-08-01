import { useApp } from '../store/app.js'

/**
 * Shows tracking suggestions from the integration sources (IntelliJ window
 * detection, Jira, Google Calendar). Sources are scaffolded, so this panel
 * renders an informational empty state until an integration is enabled and
 * wired to real data. Each suggestion is a one-click start.
 */
export function SuggestionsPanel(): JSX.Element {
  const { suggestions, settings, start, projects } = useApp()
  const projectName = (id?: number | null): string | undefined =>
    id == null ? undefined : projects.find((p) => p.id === id)?.name
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
          const project = projectName(s.projectId)
          return (
            <li key={s.id} className="suggestion-row">
              <span className={`badge badge--${s.source}`}>{sourceLabel(s.source)}</span>
              <span className="suggestion-row__desc">{s.description}</span>
              {s.ticketRef && <span className="badge">{s.ticketRef}</span>}
              {project && (
                <span className="badge badge--project" title="Suggested from your history">
                  {project}
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
