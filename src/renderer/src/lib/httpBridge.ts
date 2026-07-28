import type { TogglTractionApi } from '../../../preload/index.js'

/**
 * A browser-side stand-in for the Electron preload bridge that talks to the
 * local dev bridge server (scripts/dev-server.ts) over HTTP + SSE. The server
 * runs the REAL TogglClient/TimerManager in Node, so this lets the full UI be
 * driven against a real Toggl account in a plain browser — no Electron needed.
 *
 * Enabled only when the page is opened with `?server`. Never ships in Electron.
 */
// Same-origin by default (the dev web server proxies /rpc and /events to the
// bridge), which satisfies the renderer's `connect-src 'self'` CSP. An explicit
// ?api=http://host:port override is available if you run them separately.
const API_BASE = new URLSearchParams(location.search).get('api') || ''

type Listener = (payload: unknown) => void
const listeners = new Map<string, Set<Listener>>()

function subscribe(channel: string, cb: Listener): () => void {
  const set = listeners.get(channel) ?? new Set()
  set.add(cb)
  listeners.set(channel, set)
  return () => set.delete(cb)
}

async function rpc<T>(method: string, args: unknown[] = []): Promise<T> {
  const res = await fetch(`${API_BASE}/rpc`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ method, args })
  })
  const json = await res.json()
  if (!json.ok) throw new Error(json.error || 'Request failed')
  return json.data as T
}

export function installHttpBridge(): void {
  if (window.toggl) return

  // Server-sent events carry the same broadcasts as the Electron app.
  const es = new EventSource(`${API_BASE}/events`)
  es.onmessage = (e): void => {
    try {
      const { channel, payload } = JSON.parse(e.data)
      listeners.get(channel)?.forEach((cb) => cb(payload))
    } catch {
      /* ignore malformed */
    }
  }

  const api: TogglTractionApi = {
    auth: {
      signIn: (token) => rpc('auth.signIn', [token]),
      signOut: () => rpc('auth.signOut'),
      getSession: () => rpc('auth.getSession'),
      onChange: (cb) => subscribe('auth', cb as Listener)
    },
    timer: {
      getState: () => rpc('timer.getState'),
      start: (input) => rpc('timer.start', [input]),
      stop: () => rpc('timer.stop'),
      sync: () => rpc('timer.sync'),
      onChange: (cb) => subscribe('timer', cb as Listener)
    },
    projects: { list: () => rpc('projects.list') },
    tasks: { list: () => rpc('tasks.list') },
    entries: {
      recent: () => rpc('entries.recent'),
      update: (id, patch) => rpc('entries.update', [id, patch]),
      remove: (id) => rpc('entries.remove', [id])
    },
    settings: {
      get: () => rpc('settings.get'),
      update: (patch) => rpc('settings.update', [patch]),
      onChange: (cb) => subscribe('settings', cb as Listener)
    },
    suggestions: {
      get: () => rpc('suggestions.get'),
      onChange: (cb) => subscribe('suggestions', cb as Listener)
    },
    mini: {
      show: () => rpc('mini.show'),
      hide: () => rpc('mini.hide'),
      setContentSize: (width: number, height: number) =>
        rpc('mini.setContentSize', [width, height])
    }
  }

  window.toggl = api
}
