import { contextBridge, ipcRenderer } from 'electron'
import {
  CHANNELS,
  INVOKE,
  type AppSettings,
  type GoogleCalendarStatus,
  type IpcResult,
  type Session,
  type TimeEntry,
  type TimerState,
  type TogglProject,
  type TogglTask,
  type TrackingSuggestion,
  type StartTimerInput
} from '../shared/types.js'

/** Unwrap an IpcResult, throwing a real Error on the renderer side. */
async function unwrap<T>(p: Promise<IpcResult<T>>): Promise<T> {
  const res = await p
  if (!res.ok) throw new Error(res.error)
  return res.data
}

function on<T>(channel: string, cb: (payload: T) => void): () => void {
  const listener = (_e: unknown, payload: T): void => cb(payload)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

const api = {
  auth: {
    signIn: (token: string): Promise<Session> =>
      unwrap(ipcRenderer.invoke(INVOKE.authSignIn, token)),
    signOut: (): Promise<null> => unwrap(ipcRenderer.invoke(INVOKE.authSignOut)),
    getSession: (): Promise<Session | null> => unwrap(ipcRenderer.invoke(INVOKE.authGetSession)),
    onChange: (cb: (s: Session | null) => void) => on<Session | null>(CHANNELS.authChanged, cb)
  },
  timer: {
    getState: (): Promise<TimerState> => unwrap(ipcRenderer.invoke(INVOKE.timerGetState)),
    start: (input: StartTimerInput): Promise<TimeEntry> =>
      unwrap(ipcRenderer.invoke(INVOKE.timerStart, input)),
    stop: (): Promise<null> => unwrap(ipcRenderer.invoke(INVOKE.timerStop)),
    sync: (): Promise<TimerState> => unwrap(ipcRenderer.invoke(INVOKE.timerSync)),
    onChange: (cb: (s: TimerState) => void) => on<TimerState>(CHANNELS.timerStateChanged, cb)
  },
  projects: {
    list: (): Promise<TogglProject[]> => unwrap(ipcRenderer.invoke(INVOKE.projectsList))
  },
  tasks: {
    list: (): Promise<TogglTask[]> => unwrap(ipcRenderer.invoke(INVOKE.tasksList))
  },
  entries: {
    recent: (): Promise<TimeEntry[]> => unwrap(ipcRenderer.invoke(INVOKE.entriesRecent)),
    update: (id: number, patch: Partial<TimeEntry>): Promise<TimeEntry> =>
      unwrap(ipcRenderer.invoke(INVOKE.entryUpdate, id, patch)),
    remove: (id: number): Promise<null> => unwrap(ipcRenderer.invoke(INVOKE.entryDelete, id))
  },
  settings: {
    get: (): Promise<AppSettings> => unwrap(ipcRenderer.invoke(INVOKE.settingsGet)),
    update: (patch: Partial<AppSettings>): Promise<AppSettings> =>
      unwrap(ipcRenderer.invoke(INVOKE.settingsUpdate, patch)),
    onChange: (cb: (s: AppSettings) => void) => on<AppSettings>(CHANNELS.settingsChanged, cb)
  },
  suggestions: {
    get: (): Promise<TrackingSuggestion[]> => unwrap(ipcRenderer.invoke(INVOKE.suggestionsGet)),
    onChange: (cb: (s: TrackingSuggestion[]) => void) =>
      on<TrackingSuggestion[]>(CHANNELS.suggestionsChanged, cb)
  },
  calendar: {
    getStatus: (): Promise<GoogleCalendarStatus> =>
      unwrap(ipcRenderer.invoke(INVOKE.calendarGetStatus)),
    connect: (): Promise<GoogleCalendarStatus> =>
      unwrap(ipcRenderer.invoke(INVOKE.calendarConnect)),
    disconnect: (): Promise<GoogleCalendarStatus> =>
      unwrap(ipcRenderer.invoke(INVOKE.calendarDisconnect)),
    onChange: (cb: (s: GoogleCalendarStatus) => void) =>
      on<GoogleCalendarStatus>(CHANNELS.calendarStatusChanged, cb)
  },
  mini: {
    show: (): Promise<null> => unwrap(ipcRenderer.invoke(INVOKE.miniShow)),
    hide: (): Promise<null> => unwrap(ipcRenderer.invoke(INVOKE.miniHide)),
    setContentSize: (width: number, height: number): Promise<null> =>
      unwrap(ipcRenderer.invoke(INVOKE.miniSetContentSize, width, height))
  }
}

export type TogglTractionApi = typeof api

contextBridge.exposeInMainWorld('toggl', api)
