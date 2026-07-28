import type { TogglTractionApi } from '../../../preload/index.js'
import type {
  AppSettings,
  Session,
  TimeEntry,
  TimerState,
  TogglProject,
  TogglTask
} from '../../../shared/types.js'
import { DEFAULT_SETTINGS } from '../../../shared/types.js'

/**
 * An in-memory stand-in for the preload bridge, used ONLY when the app is
 * opened in a plain browser with `?demo` (e.g. `vite --config
 * vite.preview.config.ts` then visit `/?demo`). It lets the full UI be
 * previewed and visually/accessibility-tested without Electron or a Toggl
 * account. It is never installed inside Electron (the real bridge wins).
 */
export function installDemoBridge(): void {
  if (window.toggl) return

  const session: Session = {
    user: {
      id: 1,
      fullname: 'Dana Developer',
      email: 'dana@example.com',
      default_workspace_id: 100
    },
    workspaces: [{ id: 100, name: 'Acme Engineering' }],
    activeWorkspaceId: 100
  }

  const projects: TogglProject[] = [
    { id: 1, workspace_id: 100, name: 'PROJ – Platform', color: '#e08bd6', active: true },
    { id: 2, workspace_id: 100, name: 'Internal tooling', color: '#57d68d', active: true },
    { id: 3, workspace_id: 100, name: 'Support', color: '#f5c451', active: true }
  ]

  // Tasks (sub-items) belonging to projects, e.g. "Code review" under Platform.
  const tasks: TogglTask[] = [
    { id: 10, workspace_id: 100, project_id: 1, name: 'Code review', active: true },
    { id: 11, workspace_id: 100, project_id: 1, name: 'Bug triage', active: true },
    { id: 12, workspace_id: 100, project_id: 1, name: 'Feature work', active: true },
    { id: 13, workspace_id: 100, project_id: 2, name: 'CI maintenance', active: true }
  ]

  const now = Date.now()
  const iso = (msAgo: number): string => new Date(now - msAgo).toISOString()
  let seq = 1000
  let entries: TimeEntry[] = [
    {
      id: 1,
      workspace_id: 100,
      project_id: 1,
      task_id: 11,
      description: 'PROJ-142 Fix always-on-top timer',
      start: iso(3 * 3600_000),
      stop: iso(2 * 3600_000),
      duration: 3600
    },
    {
      id: 2,
      workspace_id: 100,
      project_id: 1,
      task_id: 10,
      description: 'Review Dana’s PR',
      start: iso(5 * 3600_000),
      stop: iso(4.5 * 3600_000),
      duration: 1800
    },
    {
      id: 3,
      workspace_id: 100,
      project_id: null,
      description: 'Standup',
      start: iso(26 * 3600_000),
      stop: iso(25.75 * 3600_000),
      duration: 900
    }
  ]

  let timer: TimerState = {
    running: {
      id: 999,
      workspace_id: 100,
      project_id: 1,
      task_id: 12,
      description: 'PROJ-158 Accessible design system',
      start: iso(15 * 60_000),
      stop: null,
      duration: -1
    },
    pending: false,
    error: null,
    lastSyncedAt: now
  }

  let settings: AppSettings = { ...DEFAULT_SETTINGS }
  const timerSubs = new Set<(s: TimerState) => void>()
  const settingsSubs = new Set<(s: AppSettings) => void>()
  const emitTimer = (): void => timerSubs.forEach((f) => f(timer))
  const emitSettings = (): void => settingsSubs.forEach((f) => f(settings))

  const api: TogglTractionApi = {
    auth: {
      signIn: async () => session,
      signOut: async () => null,
      getSession: async () => session,
      onChange: () => () => {}
    },
    timer: {
      getState: async () => timer,
      start: async (input) => {
        const entry: TimeEntry = {
          id: seq++,
          workspace_id: 100,
          project_id: input.projectId ?? null,
          task_id: input.taskId ?? null,
          description: input.description,
          start: new Date().toISOString(),
          stop: null,
          duration: -1
        }
        if (timer.running) {
          entries = [{ ...timer.running, stop: new Date().toISOString(), duration: 60 }, ...entries]
        }
        timer = { ...timer, running: entry }
        emitTimer()
        return entry
      },
      stop: async () => {
        if (timer.running) {
          entries = [{ ...timer.running, stop: new Date().toISOString(), duration: 120 }, ...entries]
        }
        timer = { ...timer, running: null }
        emitTimer()
        return null
      },
      sync: async () => timer,
      onChange: (cb) => {
        timerSubs.add(cb)
        return () => timerSubs.delete(cb)
      }
    },
    projects: { list: async () => projects },
    tasks: { list: async () => tasks },
    entries: {
      recent: async () => entries,
      update: async (id, patch) => {
        // The running entry lives in timer.running, not the entries list.
        if (timer.running && timer.running.id === id) {
          const updated: TimeEntry = { ...timer.running, ...patch }
          timer = { ...timer, running: updated }
          emitTimer()
          return updated
        }
        entries = entries.map((e) => (e.id === id ? { ...e, ...patch } : e))
        return entries.find((e) => e.id === id)!
      },
      remove: async (id) => {
        entries = entries.filter((e) => e.id !== id)
        return null
      }
    },
    settings: {
      get: async () => settings,
      update: async (patch) => {
        settings = { ...settings, ...patch }
        emitSettings()
        return settings
      },
      onChange: (cb) => {
        settingsSubs.add(cb)
        return () => settingsSubs.delete(cb)
      }
    },
    suggestions: {
      get: async () => [],
      onChange: () => () => {}
    },
    mini: {
      show: async () => null,
      hide: async () => null,
      setContentSize: async () => null
    }
  }

  window.toggl = api
}
