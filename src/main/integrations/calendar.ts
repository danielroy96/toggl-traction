import type { TimeEntry, TrackingSuggestion } from '../../shared/types.js'
import type { SuggestionSource } from './index.js'
import type { GoogleCalendarManager } from './google/tokens.js'
import { listEvents, eventsToSuggestions } from './google/calendar-client.js'
import { buildHistoryIndex, enrichSuggestion } from './enrich.js'

/**
 * Suggests time entries from Google Calendar meetings. A meeting the user is
 * currently in (or that just ended) becomes a one-click entry pre-filled with
 * the meeting title and its start/end times.
 *
 * The account connection (OAuth, refresh tokens) is owned by a shared
 * {@link GoogleCalendarManager}; this source only asks it for an access token
 * and reads events around "now". When the account isn't connected it simply
 * emits nothing, so enabling the toggle before connecting is harmless.
 *
 * Each meeting is then enriched: a ticket reference in the title is surfaced,
 * and if the user has tracked against this meeting (or ticket) before, the same
 * project/task is pre-filled so starting it is a single click.
 */

/** How far either side of now to look for meetings. */
const LOOKBACK_MS = 15 * 60 * 1000
const LOOKAHEAD_MS = 30 * 60 * 1000
const POLL_INTERVAL_MS = 120_000

export class GoogleCalendarSource implements SuggestionSource {
  readonly id = 'google-calendar'
  private handle: ReturnType<typeof setInterval> | null = null

  constructor(
    private emit: (s: TrackingSuggestion[]) => void,
    private auth: GoogleCalendarManager,
    private getHistory: () => Promise<TimeEntry[]>
  ) {}

  start(): void {
    if (this.handle) return
    this.handle = setInterval(() => void this.tick(), POLL_INTERVAL_MS)
    void this.tick()
  }

  stop(): void {
    if (this.handle) clearInterval(this.handle)
    this.handle = null
  }

  async poll(): Promise<TrackingSuggestion[]> {
    if (!this.auth.isConnected()) return []
    try {
      const accessToken = await this.auth.getAccessToken()
      const now = new Date()
      const events = await listEvents(
        accessToken,
        new Date(now.getTime() - LOOKBACK_MS),
        new Date(now.getTime() + LOOKAHEAD_MS)
      )
      const suggestions = eventsToSuggestions(events, now)

      // Learn a project/task from history. Never let a history failure sink the
      // whole poll — fall back to un-enriched suggestions.
      let history: TimeEntry[] = []
      try {
        history = await this.getHistory()
      } catch {
        /* no history this round */
      }
      const index = buildHistoryIndex(history)
      return suggestions.map((s) => enrichSuggestion(s, index))
    } catch {
      // Never let a transient calendar/network/auth error break the engine; drop
      // suggestions this round and let the next poll retry.
      return []
    }
  }

  private async tick(): Promise<void> {
    this.emit(await this.poll())
  }
}
