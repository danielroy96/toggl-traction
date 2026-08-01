/*
 * Tests for the pure Google Calendar mapping logic — which events become
 * suggestions, and how they are titled/scored. These are electron-free so they
 * bundle and run under plain node. Run via:
 *   node scripts/run-tests.mjs
 */
import {
  eventsToSuggestions,
  isTrackable,
  type GoogleEvent
} from '../src/main/integrations/google/calendar-client.js'

let failures = 0
function assert(cond: boolean, msg: string): void {
  if (cond) {
    console.log(`  PASS  ${msg}`)
  } else {
    failures++
    console.log(`  FAIL  ${msg}`)
  }
}

const NOW = new Date('2026-08-01T10:30:00.000Z')

/** Build a timed event, overriding any fields the test cares about. */
function event(over: Partial<GoogleEvent> = {}): GoogleEvent {
  return {
    id: 'e1',
    summary: 'Standup',
    start: { dateTime: '2026-08-01T10:15:00.000Z' },
    end: { dateTime: '2026-08-01T10:45:00.000Z' },
    ...over
  }
}

// --- isTrackable ---------------------------------------------------------
assert(isTrackable(event()) === true, 'a normal timed event is trackable')
assert(
  isTrackable(event({ status: 'cancelled' })) === false,
  'cancelled events are skipped'
)
assert(
  isTrackable(event({ start: { date: '2026-08-01' }, end: { date: '2026-08-02' } })) === false,
  'all-day events (date only) are skipped'
)
assert(
  isTrackable(event({ transparency: 'transparent' })) === false,
  'events marked "free" (transparent) are skipped'
)
assert(
  isTrackable(event({ attendees: [{ self: true, responseStatus: 'declined' }] })) === false,
  'events the user declined are skipped'
)
assert(
  isTrackable(event({ attendees: [{ self: true, responseStatus: 'accepted' }] })) === true,
  'events the user accepted are trackable'
)

// --- eventsToSuggestions -------------------------------------------------
{
  const out = eventsToSuggestions([event()], NOW)
  assert(out.length === 1, 'one trackable event yields one suggestion')
  assert(out[0].id === 'gcal:e1', 'suggestion id is namespaced with gcal:')
  assert(out[0].source === 'google-calendar', 'suggestion source is google-calendar')
  assert(out[0].description === 'Standup', 'suggestion uses the event summary')
  assert(
    out[0].start === '2026-08-01T10:15:00.000Z' && out[0].end === '2026-08-01T10:45:00.000Z',
    'suggestion carries the event start/end'
  )
}

{
  // NOW (10:30) is inside 10:15–10:45, so this meeting is in progress.
  const inProgress = eventsToSuggestions([event()], NOW)[0]
  assert(inProgress.confidence === 0.85, 'in-progress meeting scores higher (0.85)')

  const later = eventsToSuggestions(
    [
      event({
        start: { dateTime: '2026-08-01T11:00:00.000Z' },
        end: { dateTime: '2026-08-01T11:30:00.000Z' }
      })
    ],
    NOW
  )[0]
  assert(later.confidence === 0.7, 'not-yet-started meeting scores lower (0.7)')
}

{
  const out = eventsToSuggestions([event({ summary: undefined }), event({ summary: '   ' })], NOW)
  assert(
    out.every((s) => s.description === 'Untitled meeting'),
    'missing/blank titles fall back to "Untitled meeting"'
  )
}

{
  const out = eventsToSuggestions(
    [event({ id: 'ok' }), event({ id: 'bad', status: 'cancelled' })],
    NOW
  )
  assert(
    out.length === 1 && out[0].id === 'gcal:ok',
    'non-trackable events are filtered out of the mapping'
  )
}

console.log(`\n${failures === 0 ? 'All calendar tests passed.' : `${failures} FAILURES`}`)
process.exit(failures === 0 ? 0 : 1)
