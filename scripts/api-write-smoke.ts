/* Start/stop/delete round-trip against real Toggl. Token via TOGGL_TOKEN env.
   Creates a clearly-labelled test entry and cleans it up afterwards. */
import { TogglClient } from '../src/main/toggl/client.js'

const token = process.env['TOGGL_TOKEN']
if (!token) {
  console.error('Set TOGGL_TOKEN')
  process.exit(2)
}
const delay = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

async function main(): Promise<void> {
  const client = new TogglClient(token as string)
  const me = await client.getMe()
  const ws = me.default_workspace_id
  console.log(`workspace: ${ws}`)

  console.log('\n== startTimer ==')
  const started = await client.startTimer({
    description: '[Toggl Traction test] safe to delete',
    workspaceId: ws,
    projectId: null
  })
  console.log(`  created entry id=${started.id} duration=${started.duration} (negative = running)`)

  await delay(3000)

  console.log('\n== getCurrentEntry (should be our entry) ==')
  const current = await client.getCurrentEntry()
  console.log(
    current?.id === started.id
      ? `  OK running: "${current.description}"`
      : `  MISMATCH current=${current?.id}`
  )

  console.log('\n== stopTimer ==')
  const stopped = await client.stopTimer(ws, started.id)
  console.log(`  stopped id=${stopped.id} duration=${stopped.duration}s stop=${stopped.stop}`)

  console.log('\n== getCurrentEntry (should be none) ==')
  const afterStop = await client.getCurrentEntry()
  console.log(afterStop ? `  still running?! id=${afterStop.id}` : '  OK none running')

  console.log('\n== deleteEntry (cleanup) ==')
  await client.deleteEntry(ws, started.id)
  console.log(`  deleted id=${started.id}`)

  console.log('\n== verify gone ==')
  const recent = await client.getRecentEntries()
  const stillThere = recent.some((e) => e.id === started.id)
  console.log(stillThere ? '  STILL PRESENT (cleanup failed)' : '  OK removed from recent entries')

  console.log(`\nWRITE SMOKE ${stillThere ? 'INCOMPLETE' : 'OK'}`)
  process.exit(stillThere ? 1 : 0)
}

main().catch((err) => {
  console.error('\nWRITE SMOKE FAILED:', err instanceof Error ? err.message : err)
  process.exit(1)
})
