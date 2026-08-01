import { app, BrowserWindow, ipcMain, nativeTheme } from 'electron'
import { TogglClient } from './toggl/client.js'
import { TimerManager } from './timer.js'
import { SuggestionEngine } from './integrations/index.js'
import { createMainWindow, MiniTimerWindow } from './windows.js'
import { createTray } from './tray.js'
import {
  loadSettings,
  saveSettings,
  saveToken,
  loadToken,
  clearToken
} from './store.js'
import {
  CHANNELS,
  INVOKE,
  type AppSettings,
  type IpcResult,
  type Session,
  type StartTimerInput
} from '../shared/types.js'

/**
 * When the app is launched from a terminal (`npm run dev`) and that terminal
 * later closes, the process keeps running in the tray but its stdout/stderr
 * pipe is now broken. Any subsequent write then throws EPIPE/EIO, which Electron
 * would otherwise surface as a scary "Uncaught Exception" dialog. Swallow those
 * specific stream errors; log anything else rather than crash-dialoguing.
 */
function installCrashGuards(): void {
  const isPipeError = (err: unknown): boolean => {
    const code = (err as NodeJS.ErrnoException | null)?.code
    return code === 'EPIPE' || code === 'EIO'
  }
  process.stdout.on('error', (err) => {
    if (!isPipeError(err)) throw err
  })
  process.stderr.on('error', (err) => {
    if (!isPipeError(err)) throw err
  })
  process.on('uncaughtException', (err) => {
    if (isPipeError(err)) return
    try {
      console.error('Uncaught exception:', err)
    } catch {
      /* stdout may itself be broken; nothing more we can do */
    }
  })
  process.on('unhandledRejection', (reason) => {
    if (isPipeError(reason)) return
    try {
      console.error('Unhandled rejection:', reason)
    } catch {
      /* ignore */
    }
  })
}

installCrashGuards()

// In development the app menu, dock and About panel take their name from
// Electron's own bundle ("Electron"). `productName` only fixes packaged builds,
// so set the name explicitly here to keep dev and prod consistent.
app.setName('Toggl Traction')

/**
 * Application controller. Owns the long-lived services (timer, suggestions,
 * windows) and wires the IPC surface. Keeping this in one place makes the data
 * flow — renderer -> IPC -> service -> broadcast -> renderer — easy to follow.
 */
class AppController {
  private mainWindow: BrowserWindow | null = null
  private mini = new MiniTimerWindow({
    onHideRequested: () => this.hideMiniManually(),
    onOpenMain: () => this.focusMain()
  })
  /** Set when the user hides the mini timer via its menu; suppresses auto-show. */
  private miniManuallyHidden = false
  private timer = new TimerManager()
  private suggestions = new SuggestionEngine()
  private client: TogglClient | null = null
  private session: Session | null = null
  private settings: AppSettings = loadSettings()

  async init(): Promise<void> {
    this.applyTheme()
    this.registerIpc()
    this.wireBroadcasts()

    this.mainWindow = createMainWindow()
    createTray({
      onOpen: () => this.focusMain(),
      onToggleTimer: () => void this.timer.toggle(),
      onToggleMini: () =>
        this.mini.isVisible() ? this.hideMiniManually() : this.showMiniManually(),
      onQuit: () => this.quit(),
      getRunning: () => !!this.timer.getState().running,
      isMiniVisible: () => this.mini.isVisible()
    })

    // Auto sign-in if we have a stored token.
    const token = loadToken()
    if (token) {
      try {
        await this.signIn(token, /* persist */ false)
      } catch {
        // Token invalid/expired — user will see the sign-in screen.
        clearToken()
      }
    }

    this.suggestions.applySettings(this.settings)
    if (this.session) this.refreshMiniVisibility()
  }

  private applyTheme(): void {
    nativeTheme.themeSource =
      this.settings.theme === 'light'
        ? 'light'
        : this.settings.theme === 'dark' || this.settings.theme === 'high-contrast'
          ? 'dark'
          : 'system'
  }

  private focusMain(): void {
    if (!this.mainWindow || this.mainWindow.isDestroyed()) {
      this.mainWindow = createMainWindow()
      return
    }
    if (this.mainWindow.isMinimized()) this.mainWindow.restore()
    this.mainWindow.show()
    this.mainWindow.focus()
  }

  private broadcast(channel: string, payload: unknown): void {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send(channel, payload)
    }
  }

  private wireBroadcasts(): void {
    this.timer.on('change', (state) => {
      this.broadcast(CHANNELS.timerStateChanged, state)
      // Show the mini timer automatically while something is running.
      this.refreshMiniVisibility()
    })
    this.suggestions.on('change', (list) => {
      this.broadcast(CHANNELS.suggestionsChanged, list)
    })
  }

  private refreshMiniVisibility(): void {
    const running = !!this.timer.getState().running
    const wants =
      !!this.session &&
      this.settings.miniTimerEnabled &&
      !this.miniManuallyHidden &&
      (running || this.settings.miniTimerAlwaysVisible)
    if (wants && !this.mini.isVisible()) this.mini.show()
    else if (!wants && this.mini.isVisible()) this.mini.hide()
  }

  /** User dismissed the mini timer from its menu — keep it hidden until they
   *  bring it back (tray toggle) or re-enable it in settings. */
  private hideMiniManually(): void {
    this.miniManuallyHidden = true
    this.mini.hide()
  }

  private showMiniManually(): void {
    this.miniManuallyHidden = false
    this.mini.show()
  }

  private async signIn(token: string, persist: boolean): Promise<Session> {
    const client = new TogglClient(token)
    const me = await client.getMe()
    const workspaces = (me.workspaces ?? []).map((w) => ({ id: w.id, name: w.name }))
    const activeWorkspaceId = me.default_workspace_id ?? workspaces[0]?.id
    if (!activeWorkspaceId) throw new Error('No workspace found for this account.')

    if (persist) saveToken(token)
    this.client = client
    this.session = {
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
    this.timer.attach(client, activeWorkspaceId)
    this.broadcast(CHANNELS.authChanged, this.session)
    this.refreshMiniVisibility()
    return this.session
  }

  private signOut(): void {
    clearToken()
    this.client = null
    this.session = null
    this.timer.detach()
    this.mini.hide()
    this.broadcast(CHANNELS.authChanged, null)
  }

  private registerIpc(): void {
    const handle = <T>(
      channel: string,
      fn: (...args: unknown[]) => Promise<T> | T
    ): void => {
      ipcMain.handle(channel, async (_e, ...args): Promise<IpcResult<T>> => {
        try {
          return { ok: true, data: await fn(...args) }
        } catch (err) {
          return { ok: false, error: err instanceof Error ? err.message : 'Unknown error' }
        }
      })
    }

    handle(INVOKE.authSignIn, async (token) => {
      if (typeof token !== 'string' || !token.trim()) {
        throw new Error('Please enter your Toggl API token.')
      }
      return this.signIn(token.trim(), true)
    })
    handle(INVOKE.authSignOut, () => {
      this.signOut()
      return null
    })
    handle(INVOKE.authGetSession, () => this.session)

    handle(INVOKE.timerGetState, () => this.timer.getState())
    handle(INVOKE.timerStart, (input) => this.timer.start(input as StartTimerInput))
    handle(INVOKE.timerStop, () => this.timer.stop().then(() => null))
    handle(INVOKE.timerSync, () => this.timer.sync().then(() => this.timer.getState()))

    handle(INVOKE.projectsList, () => {
      if (!this.client || !this.session) throw new Error('Not signed in.')
      return this.client.getProjects(this.session.activeWorkspaceId)
    })
    handle(INVOKE.tasksList, () => {
      if (!this.client || !this.session) throw new Error('Not signed in.')
      return this.client.getTasks(this.session.activeWorkspaceId)
    })
    handle(INVOKE.entriesRecent, () => {
      if (!this.client) throw new Error('Not signed in.')
      return this.client.getRecentEntries()
    })
    handle(INVOKE.entryUpdate, (id, patch) => {
      if (!this.client || !this.session) throw new Error('Not signed in.')
      return this.client.updateEntry(
        this.session.activeWorkspaceId,
        id as number,
        patch as Record<string, unknown>
      )
    })
    handle(INVOKE.entryDelete, async (id) => {
      if (!this.client || !this.session) throw new Error('Not signed in.')
      await this.client.deleteEntry(this.session.activeWorkspaceId, id as number)
      void this.timer.sync()
      return null
    })

    handle(INVOKE.settingsGet, () => this.settings)
    handle(INVOKE.settingsUpdate, (patch) => {
      const p = patch as Partial<AppSettings>
      // Re-enabling the mini timer clears a previous manual dismissal.
      if (p.miniTimerEnabled) this.miniManuallyHidden = false
      this.settings = { ...this.settings, ...p }
      saveSettings(this.settings)
      this.applyTheme()
      this.suggestions.applySettings(this.settings)
      this.refreshMiniVisibility()
      app.setLoginItemSettings({ openAtLogin: this.settings.launchAtLogin })
      this.broadcast(CHANNELS.settingsChanged, this.settings)
      return this.settings
    })

    handle(INVOKE.suggestionsGet, () => this.suggestions.getSuggestions())

    handle(INVOKE.miniShow, () => {
      this.mini.show()
      return null
    })
    handle(INVOKE.miniHide, () => {
      this.mini.hide()
      return null
    })
    handle(INVOKE.miniSetContentSize, (width, height) => {
      this.mini.setContentSize(Number(width) || 0, Number(height) || 0)
      return null
    })
  }

  quit(): void {
    ;(app as unknown as { isQuitting?: boolean }).isQuitting = true
    this.timer.detach()
    this.suggestions.stopAll()
    this.mini.destroy()
    app.quit()
  }
}

const controller = new AppController()

app.whenReady().then(() => {
  void controller.init()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) void controller.init()
  })
})

// Keep running in the tray on window close (except on explicit quit).
app.on('window-all-closed', () => {
  // Do not quit — the tray keeps the app alive so the mini timer can run.
})
