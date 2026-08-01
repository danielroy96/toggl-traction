/**
 * Types shared across the main process, preload bridge and renderer.
 * Keep this framework-free so it can be imported anywhere.
 */

export interface TogglUser {
  id: number
  fullname: string
  email: string
  default_workspace_id: number
  image_url?: string
}

export interface TogglProject {
  id: number
  workspace_id: number
  name: string
  color: string
  active: boolean
  client_id?: number | null
}

export interface TogglClient {
  id: number
  name: string
  workspace_id: number
}

/** A Task is a sub-item of a Project in Toggl (e.g. "Code review"). */
export interface TogglTask {
  id: number
  name: string
  project_id: number
  workspace_id: number
  active: boolean
}

/** A time entry as returned/stored by the Toggl v9 API. */
export interface TimeEntry {
  id: number
  workspace_id: number
  project_id?: number | null
  task_id?: number | null
  description: string
  /** ISO-8601 start time. */
  start: string
  /** ISO-8601 stop time, or null while running. */
  stop?: string | null
  /** Duration in seconds. Negative (running) while the entry is active. */
  duration: number
  tags?: string[]
  billable?: boolean
}

/** The authenticated session summary handed to the renderer. */
export interface Session {
  user: TogglUser
  workspaces: { id: number; name: string }[]
  activeWorkspaceId: number
}

/** Everything the UI needs to render the current running state. */
export interface TimerState {
  /** The running entry, or null when the timer is stopped. */
  running: TimeEntry | null
  /** True while a start/stop request is in flight (used to disable buttons). */
  pending: boolean
  /** Last error message from a start/stop/sync operation, if any. */
  error: string | null
  /** Epoch ms of the last successful sync with Toggl. */
  lastSyncedAt: number | null
}

export interface AppSettings {
  /**
   * Font scale. 'system' follows the OS accessibility text scaling where it can
   * be detected; otherwise a manual multiplier (1 = 100%).
   */
  fontScale: number | 'system'
  theme: 'system' | 'light' | 'dark' | 'high-contrast'
  /** Show the always-on-top mini timer. */
  miniTimerEnabled: boolean
  /** Keep the mini timer visible even when a timer is not running. */
  miniTimerAlwaysVisible: boolean
  launchAtLogin: boolean
  /** Integration toggles (scaffolded; see src/main/integrations). */
  integrations: {
    windowDetection: boolean
    jira: boolean
    googleCalendar: boolean
  }
}

export const DEFAULT_SETTINGS: AppSettings = {
  fontScale: 'system',
  theme: 'system',
  miniTimerEnabled: true,
  miniTimerAlwaysVisible: false,
  launchAtLogin: false,
  integrations: {
    windowDetection: false,
    jira: false,
    googleCalendar: false
  }
}

/** A tracking suggestion surfaced by an integration. */
export interface TrackingSuggestion {
  id: string
  source: 'window-detection' | 'jira' | 'google-calendar'
  description: string
  /** Suggested project, e.g. learned from what was tracked here before. */
  projectId?: number | null
  /** Suggested task within the project, when one was learned from history. */
  taskId?: number | null
  /** Optional detected ticket reference, e.g. "PROJ-123". */
  ticketRef?: string
  /** For calendar-derived suggestions. */
  start?: string
  end?: string
  confidence: number
}

/** Connection state for the Google Calendar integration, shown in settings. */
export interface GoogleCalendarStatus {
  /** True once the user has completed OAuth and a refresh token is stored. */
  connected: boolean
  /** The connected Google account's email, when known. */
  email?: string
  /**
   * False when this build has no OAuth client credentials configured, so the
   * "Connect" action cannot run. The UI uses this to explain why.
   */
  configured: boolean
}

/** Payload to start a new timer. */
export interface StartTimerInput {
  description: string
  projectId?: number | null
  taskId?: number | null
  workspaceId?: number
  tags?: string[]
  billable?: boolean
}

/** Result wrapper so IPC calls surface errors without throwing across the bridge. */
export type IpcResult<T> = { ok: true; data: T } | { ok: false; error: string }

/** Channel names for main -> renderer broadcasts. */
export const CHANNELS = {
  timerStateChanged: 'timer:state-changed',
  settingsChanged: 'settings:changed',
  suggestionsChanged: 'suggestions:changed',
  authChanged: 'auth:changed',
  calendarStatusChanged: 'calendar:status-changed'
} as const

/** Channel names for renderer -> main request/response (ipcRenderer.invoke). */
export const INVOKE = {
  authSignIn: 'auth:sign-in',
  authSignOut: 'auth:sign-out',
  authGetSession: 'auth:get-session',
  timerGetState: 'timer:get-state',
  timerStart: 'timer:start',
  timerStop: 'timer:stop',
  timerSync: 'timer:sync',
  projectsList: 'projects:list',
  tasksList: 'tasks:list',
  entriesRecent: 'entries:recent',
  entryUpdate: 'entry:update',
  entryDelete: 'entry:delete',
  settingsGet: 'settings:get',
  settingsUpdate: 'settings:update',
  suggestionsGet: 'suggestions:get',
  calendarConnect: 'calendar:connect',
  calendarDisconnect: 'calendar:disconnect',
  calendarGetStatus: 'calendar:get-status',
  miniShow: 'mini:show',
  miniHide: 'mini:hide',
  miniSetContentSize: 'mini:set-content-size'
} as const
