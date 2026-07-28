/*
 * Local dev bridge server. Runs the REAL TogglClient + TimerManager in Node and
 * exposes the same API surface the renderer expects, over HTTP (/rpc) and SSE
 * (/events). Lets the full UI be driven against a real Toggl account in a plain
 * browser (open the renderer with `?server`). NOT part of the shipped app.
 *
 * Run: node scripts/run-dev-server.mjs   (bundles this then runs it)
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { TogglClient } from '../src/main/toggl/client.js'
import { TimerManager } from '../src/main/timer.js'
import { DEFAULT_SETTINGS, type AppSettings, type Session } from '../src/shared/types.js'

const PORT = Number(process.env['DEV_BRIDGE_PORT'] ?? 5178)

// ---- In-memory state (no persistence; this is a dev harness) ----
let client: TogglClient | null = null
let session: Session | null = null
let settings: AppSettings = { ...DEFAULT_SETTINGS }
const timer = new TimerManager()

// ---- SSE fan-out ----
const clients = new Set<ServerResponse>()
function broadcast(channel: string, payload: unknown): void {
  const data = `data: ${JSON.stringify({ channel, payload })}\n\n`
  for (const res of clients) res.write(data)
}
timer.on('change', (state) => broadcast('timer', state))

async function signIn(token: string): Promise<Session> {
  const c = new TogglClient(token)
  const me = await c.getMe()
  const workspaces = (me.workspaces ?? []).map((w) => ({ id: w.id, name: w.name }))
  const activeWorkspaceId = me.default_workspace_id ?? workspaces[0]?.id
  if (!activeWorkspaceId) throw new Error('No workspace found for this account.')
  client = c
  session = {
    user: {
      id: me.id,
      fullname: me.fullname,
      email: me.email,
      default_workspace_id: me.default_workspace_id,
      image_url: me.image_url
    },
    workspaces,
    activeWorkspaceId
  }
  timer.attach(c, activeWorkspaceId)
  broadcast('auth', session)
  return session
}

// ---- RPC dispatch: mirrors the Electron IPC handlers ----
async function dispatch(method: string, args: unknown[]): Promise<unknown> {
  const ws = (): number => {
    if (!session) throw new Error('Not signed in.')
    return session.activeWorkspaceId
  }
  switch (method) {
    case 'auth.signIn':
      return signIn(String(args[0] ?? '').trim())
    case 'auth.signOut':
      client = null
      session = null
      timer.detach()
      broadcast('auth', null)
      return null
    case 'auth.getSession':
      return session
    case 'timer.getState':
      return timer.getState()
    case 'timer.start':
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return timer.start(args[0] as any)
    case 'timer.stop':
      await timer.stop()
      return null
    case 'timer.sync':
      await timer.sync()
      return timer.getState()
    case 'projects.list':
      if (!client) throw new Error('Not signed in.')
      return client.getProjects(ws())
    case 'tasks.list':
      if (!client) throw new Error('Not signed in.')
      return client.getTasks(ws())
    case 'entries.recent':
      if (!client) throw new Error('Not signed in.')
      return client.getRecentEntries()
    case 'entries.update':
      if (!client) throw new Error('Not signed in.')
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return client.updateEntry(ws(), args[0] as number, args[1] as any)
    case 'entries.remove':
      if (!client) throw new Error('Not signed in.')
      await client.deleteEntry(ws(), args[0] as number)
      void timer.sync()
      return null
    case 'settings.get':
      return settings
    case 'settings.update':
      settings = { ...settings, ...(args[0] as Partial<AppSettings>) }
      broadcast('settings', settings)
      return settings
    case 'suggestions.get':
      return []
    case 'mini.show':
    case 'mini.hide':
    case 'mini.setContentSize':
      return null
    default:
      throw new Error(`Unknown method: ${method}`)
  }
}

function cors(res: ServerResponse): void {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
}

const server = createServer((req: IncomingMessage, res: ServerResponse) => {
  cors(res)
  if (req.method === 'OPTIONS') {
    res.writeHead(204).end()
    return
  }

  if (req.url === '/events') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive'
    })
    res.write(': connected\n\n')
    clients.add(res)
    req.on('close', () => clients.delete(res))
    return
  }

  if (req.url === '/rpc' && req.method === 'POST') {
    let body = ''
    req.on('data', (c) => (body += c))
    req.on('end', async () => {
      try {
        const { method, args } = JSON.parse(body || '{}')
        const data = await dispatch(method, args ?? [])
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: true, data }))
      } catch (err) {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(
          JSON.stringify({ ok: false, error: err instanceof Error ? err.message : 'Error' })
        )
      }
    })
    return
  }

  res.writeHead(404).end('Not found')
})

server.listen(PORT, () => {
  console.log(`Toggl Traction dev bridge on http://localhost:${PORT}`)
  console.log('Open the renderer with ?server, e.g. http://localhost:5199/?server')
})
