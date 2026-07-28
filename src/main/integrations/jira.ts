import type { TrackingSuggestion } from '../../shared/types.js'
import type { SuggestionSource } from './index.js'

/**
 * Suggests tracking based on Jira issues currently assigned to / in progress
 * for the user, and enriches window-detection ticket refs with issue summaries.
 *
 * SCAFFOLD: the real implementation authenticates to Jira Cloud (API token +
 * account email, or OAuth) and runs a JQL query such as
 * `assignee = currentUser() AND statusCategory = "In Progress"`.
 * Credentials would be stored with the same encrypted store used for the Toggl
 * token. No network calls are made yet; enabling this source emits nothing
 * until `fetchActiveIssues` is implemented.
 */

interface JiraIssue {
  key: string
  summary: string
}

// Deferred: replace with a real JQL search against the user's Jira site.
async function fetchActiveIssues(): Promise<JiraIssue[]> {
  return []
}

export class JiraSource implements SuggestionSource {
  readonly id = 'jira'
  private handle: ReturnType<typeof setInterval> | null = null

  constructor(private emit: (s: TrackingSuggestion[]) => void) {}

  start(): void {
    if (this.handle) return
    // Jira changes slowly; poll every few minutes.
    this.handle = setInterval(() => void this.tick(), 300_000)
    void this.tick()
  }

  stop(): void {
    if (this.handle) clearInterval(this.handle)
    this.handle = null
  }

  async poll(): Promise<TrackingSuggestion[]> {
    const issues = await fetchActiveIssues()
    return issues.map((issue) => ({
      id: `jira:${issue.key}`,
      source: 'jira' as const,
      description: `${issue.key} ${issue.summary}`,
      ticketRef: issue.key,
      confidence: 0.6
    }))
  }

  private async tick(): Promise<void> {
    this.emit(await this.poll())
  }
}
