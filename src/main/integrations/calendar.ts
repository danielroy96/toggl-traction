import type { TrackingSuggestion } from '../../shared/types.js'
import type { SuggestionSource } from './index.js'

/**
 * Suggests time entries from Google Calendar meetings. A meeting the user is
 * currently in (or that just ended) becomes a one-click entry pre-filled with
 * the meeting title and its start/end times.
 *
 * SCAFFOLD: the real implementation uses Google OAuth (Calendar read-only
 * scope) and the Calendar events.list API for the primary calendar in a window
 * around "now". Token exchange and refresh would run in the main process and
 * the refresh token stored with the encrypted store. No calls are made yet;
 * enabling this source emits nothing until `fetchNearbyEvents` is implemented.
 */

interface CalendarEvent {
  id: string
  title: string
  start: string
  end: string
}

// Deferred: replace with a Google Calendar events.list call around now().
async function fetchNearbyEvents(): Promise<CalendarEvent[]> {
  return []
}

export class GoogleCalendarSource implements SuggestionSource {
  readonly id = 'google-calendar'
  private handle: ReturnType<typeof setInterval> | null = null

  constructor(private emit: (s: TrackingSuggestion[]) => void) {}

  start(): void {
    if (this.handle) return
    this.handle = setInterval(() => void this.tick(), 120_000)
    void this.tick()
  }

  stop(): void {
    if (this.handle) clearInterval(this.handle)
    this.handle = null
  }

  async poll(): Promise<TrackingSuggestion[]> {
    const events = await fetchNearbyEvents()
    return events.map((ev) => ({
      id: `gcal:${ev.id}`,
      source: 'google-calendar' as const,
      description: ev.title,
      start: ev.start,
      end: ev.end,
      confidence: 0.7
    }))
  }

  private async tick(): Promise<void> {
    this.emit(await this.poll())
  }
}
