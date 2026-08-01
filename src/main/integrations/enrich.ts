import type { TimeEntry, TrackingSuggestion } from '../../shared/types.js'

/**
 * Enrichment shared by the suggestion sources: pulling a ticket reference out of
 * free text, and learning a project/task from what the user tracked against the
 * same thing before. Kept pure (no clock, no network) so the matching rules are
 * unit-testable.
 */

// A Jira-style key: an uppercase project code, a hyphen, and a number
// (PROJ-123, AB12-9). Anchored on word boundaries so it won't match inside a
// larger token.
const TICKET_RE = /\b([A-Z][A-Z0-9]+-\d+)\b/

/** Extract the first ticket reference from some text, if any. */
export function extractTicketRef(text: string | undefined | null): string | undefined {
  if (!text) return undefined
  return TICKET_RE.exec(text)?.[1]
}

/** Project/task the user previously tracked against a given thing. */
export interface HistoryMatch {
  projectId: number
  taskId: number | null
}

/**
 * Lookup tables built from past time entries: one keyed by the (normalised)
 * entry description, one by any ticket reference found in it. Only entries that
 * carried a project are indexed — a match with no project can't pre-fill
 * anything useful.
 */
export interface HistoryIndex {
  byDescription: Map<string, HistoryMatch>
  byTicket: Map<string, HistoryMatch>
}

/** Case/whitespace-insensitive key so "Team Standup" == "team  standup". */
export function normalizeDescription(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, ' ')
}

/**
 * Build the history index from recent entries. Entries are considered newest
 * first so the most recent choice wins; we keep the first value seen per key.
 */
export function buildHistoryIndex(entries: TimeEntry[]): HistoryIndex {
  const byDescription = new Map<string, HistoryMatch>()
  const byTicket = new Map<string, HistoryMatch>()

  const newestFirst = [...entries].sort(
    (a, b) => new Date(b.start).getTime() - new Date(a.start).getTime()
  )

  for (const entry of newestFirst) {
    if (entry.project_id == null) continue
    const match: HistoryMatch = { projectId: entry.project_id, taskId: entry.task_id ?? null }

    const desc = entry.description?.trim()
    if (desc) {
      const key = normalizeDescription(desc)
      if (!byDescription.has(key)) byDescription.set(key, match)
      const ticket = extractTicketRef(desc)
      if (ticket && !byTicket.has(ticket)) byTicket.set(ticket, match)
    }
  }

  return { byDescription, byTicket }
}

/**
 * Find a prior project/task for a suggestion. An exact description match is the
 * strongest signal (e.g. the same recurring meeting); otherwise fall back to a
 * shared ticket reference.
 */
export function matchHistory(
  index: HistoryIndex,
  description: string,
  ticketRef?: string
): HistoryMatch | undefined {
  return (
    index.byDescription.get(normalizeDescription(description)) ??
    (ticketRef ? index.byTicket.get(ticketRef) : undefined)
  )
}

/**
 * Enrich a suggestion in place-ish (returns a new object): attach a ticket
 * reference parsed from its description, and a project/task learned from
 * history. A history match nudges confidence up, since the user has effectively
 * confirmed this mapping before. Existing values on the suggestion are
 * preserved when nothing better is found.
 */
export function enrichSuggestion(
  suggestion: TrackingSuggestion,
  index: HistoryIndex
): TrackingSuggestion {
  const ticketRef = suggestion.ticketRef ?? extractTicketRef(suggestion.description)
  const match = matchHistory(index, suggestion.description, ticketRef)

  return {
    ...suggestion,
    ticketRef: ticketRef ?? suggestion.ticketRef,
    projectId: match?.projectId ?? suggestion.projectId ?? null,
    taskId: match?.taskId ?? suggestion.taskId ?? null,
    confidence: match ? Math.min(0.95, suggestion.confidence + 0.1) : suggestion.confidence
  }
}
