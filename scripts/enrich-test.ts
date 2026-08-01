/*
 * Tests for suggestion enrichment — ticket-ref extraction and learning a
 * project/task from history. Pure logic, no clock/network. Run via:
 *   node scripts/run-tests.mjs
 */
import {
  extractTicketRef,
  normalizeDescription,
  buildHistoryIndex,
  matchHistory,
  enrichSuggestion
} from '../src/main/integrations/enrich.js'
import type { TimeEntry, TrackingSuggestion } from '../src/shared/types.js'

let failures = 0
function assert(cond: boolean, msg: string): void {
  if (cond) {
    console.log(`  PASS  ${msg}`)
  } else {
    failures++
    console.log(`  FAIL  ${msg}`)
  }
}

// --- extractTicketRef ----------------------------------------------------
assert(extractTicketRef('PROJ-123 kickoff') === 'PROJ-123', 'finds a leading ticket ref')
assert(extractTicketRef('Weekly sync re AB12-9') === 'AB12-9', 'finds a mid-string ref')
assert(extractTicketRef('no ticket here') === undefined, 'returns undefined when absent')
assert(extractTicketRef('') === undefined, 'empty string yields undefined')
assert(extractTicketRef(undefined) === undefined, 'undefined input is tolerated')
assert(
  extractTicketRef('lowercase abc-12 ignored') === undefined,
  'lowercase project code is not a ticket ref'
)

// --- normalizeDescription ------------------------------------------------
assert(
  normalizeDescription('  Team   Standup ') === 'team standup',
  'normalises case and whitespace'
)

// --- buildHistoryIndex ---------------------------------------------------
let idSeq = 1
function entry(over: Partial<TimeEntry> = {}): TimeEntry {
  return {
    id: idSeq++,
    workspace_id: 1,
    description: 'Team Standup',
    project_id: 10,
    task_id: null,
    start: '2026-07-01T09:00:00.000Z',
    stop: '2026-07-01T09:15:00.000Z',
    duration: 900,
    ...over
  }
}

{
  const index = buildHistoryIndex([entry()])
  assert(
    index.byDescription.get('team standup')?.projectId === 10,
    'indexes an entry by its normalised description'
  )
}

{
  // Two entries for the same meeting; the most recent (project 20) should win.
  const older = entry({ project_id: 10, start: '2026-07-01T09:00:00.000Z' })
  const newer = entry({ project_id: 20, task_id: 5, start: '2026-07-20T09:00:00.000Z' })
  const index = buildHistoryIndex([older, newer])
  const match = index.byDescription.get('team standup')
  assert(match?.projectId === 20, 'most recent entry wins for a repeated description')
  assert(match?.taskId === 5, 'carries the task id from the winning entry')
}

{
  const index = buildHistoryIndex([entry({ project_id: null })])
  assert(index.byDescription.size === 0, 'entries without a project are not indexed')
}

{
  const index = buildHistoryIndex([entry({ description: 'PROJ-42 planning', project_id: 30 })])
  assert(index.byTicket.get('PROJ-42')?.projectId === 30, 'indexes by ticket ref in the description')
}

// --- matchHistory --------------------------------------------------------
{
  const index = buildHistoryIndex([
    entry({ description: 'Design review', project_id: 11 }),
    entry({ description: 'PROJ-7 build', project_id: 12 })
  ])
  assert(
    matchHistory(index, 'design review')?.projectId === 11,
    'matches on description regardless of case'
  )
  assert(
    matchHistory(index, 'Some other meeting', 'PROJ-7')?.projectId === 12,
    'falls back to a shared ticket ref when description differs'
  )
  assert(
    matchHistory(index, 'Design review', 'PROJ-7')?.projectId === 11,
    'description match takes precedence over ticket match'
  )
  assert(matchHistory(index, 'unknown meeting') === undefined, 'no match returns undefined')
}

// --- enrichSuggestion ----------------------------------------------------
function suggestion(over: Partial<TrackingSuggestion> = {}): TrackingSuggestion {
  return {
    id: 'gcal:e1',
    source: 'google-calendar',
    description: 'Team Standup',
    confidence: 0.7,
    ...over
  }
}

{
  const index = buildHistoryIndex([entry({ description: 'Team Standup', project_id: 10, task_id: 3 })])
  const out = enrichSuggestion(suggestion(), index)
  assert(out.projectId === 10, 'enriched suggestion gets the historical project')
  assert(out.taskId === 3, 'enriched suggestion gets the historical task')
  assert(out.confidence > 0.7 && out.confidence <= 0.95, 'a history match nudges confidence up')
}

{
  const index = buildHistoryIndex([])
  const out = enrichSuggestion(suggestion({ description: 'PROJ-99 review' }), index)
  assert(out.ticketRef === 'PROJ-99', 'ticket ref is extracted even with no history')
  assert(out.projectId == null, 'no project is invented without a history match')
  assert(out.confidence === 0.7, 'confidence is unchanged without a match')
}

{
  // A meeting titled with a ticket the user has tracked under a project.
  const index = buildHistoryIndex([entry({ description: 'Worked on PROJ-5', project_id: 40 })])
  const out = enrichSuggestion(suggestion({ description: 'PROJ-5 refinement' }), index)
  assert(
    out.ticketRef === 'PROJ-5' && out.projectId === 40,
    'ticket-ref match pre-fills the project when descriptions differ'
  )
}

console.log(`\n${failures === 0 ? 'All enrich tests passed.' : `${failures} FAILURES`}`)
process.exit(failures === 0 ? 0 : 1)
