/* Read-only smoke test against the real Toggl API. Token via TOGGL_TOKEN env. */
import { TogglClient } from '../src/main/toggl/client.js'

const token = process.env['TOGGL_TOKEN']
if (!token) {
  console.error('Set TOGGL_TOKEN')
  process.exit(2)
}

async function main(): Promise<void> {
  const client = new TogglClient(token as string)

  console.log('== getMe ==')
  const me = await client.getMe()
  console.log(`  user: ${me.fullname} <${me.email}>  id=${me.id}`)
  console.log(`  default_workspace_id: ${me.default_workspace_id}`)
  console.log(`  workspaces: ${(me.workspaces ?? []).map((w) => `${w.name}(${w.id})`).join(', ')}`)

  const ws = me.default_workspace_id ?? me.workspaces?.[0]?.id
  if (!ws) throw new Error('no workspace')

  console.log('\n== getProjects ==')
  const projects = await client.getProjects(ws)
  console.log(`  ${projects.length} active project(s)`)
  for (const p of projects.slice(0, 10)) console.log(`   - ${p.name} (${p.id}) ${p.color}`)

  console.log('\n== getCurrentEntry ==')
  const current = await client.getCurrentEntry()
  console.log(current ? `  running: "${current.description}" since ${current.start}` : '  (none running)')

  console.log('\n== getRecentEntries ==')
  const recent = await client.getRecentEntries()
  console.log(`  ${recent.length} recent entr(y/ies)`)
  for (const e of recent.slice(0, 5)) {
    console.log(`   - "${e.description || '(no description)'}"  dur=${e.duration}s  start=${e.start}`)
  }

  console.log('\nREAD-ONLY SMOKE OK')
}

main().catch((err) => {
  console.error('\nSMOKE FAILED:', err instanceof Error ? err.message : err)
  process.exit(1)
})
