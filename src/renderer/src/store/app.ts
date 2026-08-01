import { create } from 'zustand'
import type {
  AppSettings,
  GoogleCalendarStatus,
  Session,
  StartTimerInput,
  TimeEntry,
  TimerState,
  TogglProject,
  TogglTask,
  TrackingSuggestion
} from '../../../shared/types.js'

interface AppStore {
  ready: boolean
  /** False when the preload/dev bridge is unavailable (opened in a bare browser). */
  bridgeAvailable: boolean
  session: Session | null
  timer: TimerState
  projects: TogglProject[]
  tasks: TogglTask[]
  entries: TimeEntry[]
  settings: AppSettings | null
  suggestions: TrackingSuggestion[]
  /** Google Calendar connection state; null until first loaded. */
  calendarStatus: GoogleCalendarStatus | null
  /** Non-fatal error shown as a toast; separate from timer.error. */
  toast: string | null

  init: () => Promise<void>
  signIn: (token: string) => Promise<void>
  signOut: () => Promise<void>
  start: (input: StartTimerInput) => Promise<void>
  stop: () => Promise<void>
  refreshEntries: () => Promise<void>
  refreshProjects: () => Promise<void>
  refreshTasks: () => Promise<void>
  updateSettings: (patch: Partial<AppSettings>) => Promise<void>
  /** Launch the Google OAuth flow and link the calendar account. */
  connectCalendar: () => Promise<void>
  /** Forget the linked Google Calendar account. */
  disconnectCalendar: () => Promise<void>
  deleteEntry: (id: number) => Promise<void>
  /** Apply an arbitrary patch to an entry (running or finished) and reconcile. */
  editEntry: (id: number, patch: Partial<TimeEntry>) => Promise<void>
  /** Change the project/task of an existing entry (e.g. the running one). */
  setEntryProjectTask: (
    id: number,
    projectId: number | null,
    taskId: number | null
  ) => Promise<void>
  setToast: (msg: string | null) => void
}

const emptyTimer: TimerState = {
  running: null,
  pending: false,
  error: null,
  lastSyncedAt: null
}

export const useApp = create<AppStore>((set, get) => ({
  ready: false,
  bridgeAvailable: true,
  session: null,
  timer: emptyTimer,
  projects: [],
  tasks: [],
  entries: [],
  settings: null,
  suggestions: [],
  calendarStatus: null,
  toast: null,

  init: async () => {
    const api = window.toggl
    if (!api) {
      // The preload bridge is unavailable (e.g. opened outside Electron). Fail
      // gracefully with a clear message instead of hanging or crashing.
      set({ ready: true, session: null, bridgeAvailable: false })
      return
    }
    try {
      const [session, settings, timer, suggestions, calendarStatus] = await Promise.all([
        api.auth.getSession(),
        api.settings.get(),
        api.timer.getState(),
        api.suggestions.get(),
        api.calendar.getStatus()
      ])
      set({ session, settings, timer, suggestions, calendarStatus })
    } catch (err) {
      // Never leave the app hanging on the splash if the bridge misbehaves.
      set({ toast: err instanceof Error ? err.message : 'Failed to connect.' })
    } finally {
      set({ ready: true })
    }

    // Live subscriptions — the main process is the source of truth.
    api.timer.onChange((t) => set({ timer: t }))
    api.settings.onChange((s) => set({ settings: s }))
    api.suggestions.onChange((s) => set({ suggestions: s }))
    api.calendar.onChange((s) => set({ calendarStatus: s }))
    api.auth.onChange((s) => {
      set({ session: s })
      if (s) {
        void get().refreshProjects()
        void get().refreshTasks()
        void get().refreshEntries()
      } else {
        set({ projects: [], tasks: [], entries: [], timer: emptyTimer })
      }
    })

    if (get().session) {
      void get().refreshProjects()
      void get().refreshTasks()
      void get().refreshEntries()
    }
  },

  signIn: async (token) => {
    if (!window.toggl) {
      throw new Error(
        'Not connected to Toggl. Launch the desktop app, or start the dev bridge and open with ?server.'
      )
    }
    const session = await window.toggl.auth.signIn(token)
    set({ session })
    if (!session.tokenPersisted) {
      set({
        toast:
          'Signed in, but your token couldn’t be saved securely on this system — you’ll need to sign in again next time.'
      })
    }
    await Promise.all([
      get().refreshProjects(),
      get().refreshTasks(),
      get().refreshEntries()
    ])
  },

  signOut: async () => {
    await window.toggl.auth.signOut()
    set({ session: null, projects: [], entries: [], timer: emptyTimer })
  },

  start: async (input) => {
    try {
      await window.toggl.timer.start(input)
      // Refresh the list so the previous (now-stopped) entry appears.
      void get().refreshEntries()
    } catch (err) {
      set({ toast: err instanceof Error ? err.message : 'Could not start the timer.' })
    }
  },

  stop: async () => {
    try {
      await window.toggl.timer.stop()
      void get().refreshEntries()
    } catch (err) {
      set({ toast: err instanceof Error ? err.message : 'Could not stop the timer.' })
    }
  },

  refreshEntries: async () => {
    try {
      const entries = await window.toggl.entries.recent()
      set({ entries })
    } catch (err) {
      set({ toast: err instanceof Error ? err.message : 'Could not load entries.' })
    }
  },

  refreshProjects: async () => {
    try {
      const projects = await window.toggl.projects.list()
      set({ projects })
    } catch {
      /* projects are optional; ignore */
    }
  },

  refreshTasks: async () => {
    try {
      const tasks = await window.toggl.tasks.list()
      set({ tasks })
    } catch {
      /* tasks are a paid feature; ignore when unavailable */
    }
  },

  updateSettings: async (patch) => {
    const settings = await window.toggl.settings.update(patch)
    set({ settings })
  },

  connectCalendar: async () => {
    try {
      const calendarStatus = await window.toggl.calendar.connect()
      set({ calendarStatus })
    } catch (err) {
      set({
        toast: err instanceof Error ? err.message : 'Could not connect Google Calendar.'
      })
    }
  },

  disconnectCalendar: async () => {
    try {
      const calendarStatus = await window.toggl.calendar.disconnect()
      set({ calendarStatus })
    } catch (err) {
      set({
        toast: err instanceof Error ? err.message : 'Could not disconnect Google Calendar.'
      })
    }
  },

  deleteEntry: async (id) => {
    try {
      await window.toggl.entries.remove(id)
      await get().refreshEntries()
    } catch (err) {
      set({ toast: err instanceof Error ? err.message : 'Could not delete the entry.' })
    }
  },

  editEntry: async (id, patch) => {
    try {
      await window.toggl.entries.update(id, patch)
      // If we edited the running entry, refresh the timer; always refresh list.
      await window.toggl.timer.sync()
      await get().refreshEntries()
    } catch (err) {
      set({ toast: err instanceof Error ? err.message : 'Could not update the entry.' })
      throw err
    }
  },

  setEntryProjectTask: async (id, projectId, taskId) => {
    await get().editEntry(id, { project_id: projectId, task_id: taskId })
  },

  setToast: (msg) => set({ toast: msg })
}))
