import type { TrackingSuggestion } from '../../../shared/types.js'

/**
 * A thin reader over the Google Calendar v3 API — just the one call this
 * integration needs: list events on the primary calendar within a time window.
 * Auth is a bearer access token supplied by the caller (the token manager owns
 * refresh); this module makes no assumptions about how it was obtained.
 */

const CALENDAR_EVENTS_ENDPOINT =
  'https://www.googleapis.com/calendar/v3/calendars/primary/events'

/** The subset of a Calendar v3 event we care about. */
export interface GoogleEvent {
  id: string
  status?: string
  summary?: string
  start?: { dateTime?: string; date?: string }
  end?: { dateTime?: string; date?: string }
  attendees?: { self?: boolean; responseStatus?: string }[]
  transparency?: string
}

interface EventsListResponse {
  items?: GoogleEvent[]
}

export class CalendarError extends Error {
  constructor(
    message: string,
    readonly status?: number
  ) {
    super(message)
    this.name = 'CalendarError'
  }
}

/** List primary-calendar events overlapping [timeMin, timeMax]. */
export async function listEvents(
  accessToken: string,
  timeMin: Date,
  timeMax: Date,
  timeoutMs = 15000
): Promise<GoogleEvent[]> {
  const params = new URLSearchParams({
    timeMin: timeMin.toISOString(),
    timeMax: timeMax.toISOString(),
    singleEvents: 'true',
    orderBy: 'startTime',
    maxResults: '50'
  })
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(`${CALENDAR_EVENTS_ENDPOINT}?${params.toString()}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: controller.signal
    })
    if (res.status === 401 || res.status === 403) {
      throw new CalendarError('Google rejected the calendar request. Reconnect the account.', res.status)
    }
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      throw new CalendarError(
        `Calendar request failed (${res.status})${body ? `: ${body.slice(0, 200)}` : ''}`,
        res.status
      )
    }
    const json = (await res.json()) as EventsListResponse
    return json.items ?? []
  } catch (err) {
    if (err instanceof CalendarError) throw err
    if (err instanceof Error && err.name === 'AbortError') {
      throw new CalendarError('The request to Google Calendar timed out.')
    }
    throw new CalendarError(err instanceof Error ? err.message : 'Unexpected calendar error.')
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Should this event become a tracking suggestion? We skip:
 *  - cancelled events,
 *  - all-day events (no dateTime; not billable meeting time),
 *  - events the user declined,
 *  - events marked "free" (transparency), which aren't real commitments.
 */
export function isTrackable(ev: GoogleEvent): boolean {
  if (ev.status === 'cancelled') return false
  if (!ev.start?.dateTime || !ev.end?.dateTime) return false
  if (ev.transparency === 'transparent') return false
  const self = ev.attendees?.find((a) => a.self)
  if (self?.responseStatus === 'declined') return false
  return true
}

/**
 * Turn calendar events into tracking suggestions. Pure function so the mapping
 * (filtering, titling, confidence) is unit-testable without network or clocks.
 * `now` lets a currently-running meeting score higher than a nearby one.
 */
export function eventsToSuggestions(
  events: GoogleEvent[],
  now: Date = new Date()
): TrackingSuggestion[] {
  const nowMs = now.getTime()
  return events.filter(isTrackable).map((ev) => {
    const start = ev.start!.dateTime!
    const end = ev.end!.dateTime!
    const inProgress = new Date(start).getTime() <= nowMs && nowMs < new Date(end).getTime()
    return {
      id: `gcal:${ev.id}`,
      source: 'google-calendar' as const,
      description: ev.summary?.trim() || 'Untitled meeting',
      start,
      end,
      // A meeting happening right now is the strongest signal.
      confidence: inProgress ? 0.85 : 0.7
    }
  })
}
