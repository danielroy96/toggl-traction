import { BrowserWindow, Menu, screen, shell, app } from 'electron'
import { join } from 'node:path'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'

const isDev = !!process.env['ELECTRON_RENDERER_URL']
// electron-vite emits the preload as an ESM `.mjs` (the project is type:module).
const preload = join(__dirname, '../preload/index.mjs')

/** Load either the dev server URL or the built HTML for a named entry. */
function loadEntry(win: BrowserWindow, entry: 'index' | 'mini'): void {
  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (isDev && devUrl) {
    win.loadURL(entry === 'index' ? devUrl : `${devUrl}/mini.html`)
  } else {
    win.loadFile(join(__dirname, `../renderer/${entry}.html`))
  }
}

export function createMainWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 960,
    height: 720,
    minWidth: 480,
    minHeight: 480,
    show: false,
    title: 'Toggl Traction',
    backgroundColor: '#12131a',
    autoHideMenuBar: true,
    webPreferences: {
      preload,
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  win.on('ready-to-show', () => win.show())
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  loadEntry(win, 'index')
  return win
}

// Initial size of the compact mini timer; the renderer then reports its exact
// content height and the window auto-fits via setContentSize().
const MINI_WIDTH = 232
const MINI_HEIGHT = 72
// Highest level that stays above normal windows without fighting the OS UI.
const AOT_LEVEL = 'screen-saver' as const

function miniPositionPath(): string {
  return join(app.getPath('userData'), 'mini-window.json')
}

function loadMiniPosition(): { x: number; y: number } | null {
  try {
    const p = miniPositionPath()
    if (!existsSync(p)) return null
    const { x, y } = JSON.parse(readFileSync(p, 'utf-8'))
    // Only restore if the saved point is still on a connected display.
    const onScreen = screen.getAllDisplays().some((d) => {
      const b = d.workArea
      return x >= b.x - 40 && x <= b.x + b.width - 40 && y >= b.y - 20 && y <= b.y + b.height - 20
    })
    return onScreen ? { x, y } : null
  } catch {
    return null
  }
}

function saveMiniPosition(x: number, y: number): void {
  try {
    writeFileSync(miniPositionPath(), JSON.stringify({ x, y }))
  } catch {
    /* best effort */
  }
}

/**
 * The always-on-top mini timer.
 *
 * A recurring source of "the timer vanished" bugs is that `alwaysOnTop` gets
 * silently dropped by the OS — after a display change, after another app goes
 * fullscreen, or after the window is hidden and shown again. We defend against
 * that by re-asserting the flag on every relevant event and on a low-frequency
 * heartbeat, and by hiding (never destroying) the window so its state and
 * position survive.
 */
export class MiniTimerWindow {
  private win: BrowserWindow | null = null
  private heartbeat: ReturnType<typeof setInterval> | null = null
  private displayListenersBound = false

  constructor(
    private opts: { onHideRequested?: () => void; onOpenMain?: () => void } = {}
  ) {
    this.onDisplayChange = this.onDisplayChange.bind(this)
  }

  /** Native right-click menu, with a quick "hide" for when it's in the way. */
  private popupMenu(): void {
    if (!this.win || this.win.isDestroyed()) return
    const menu = Menu.buildFromTemplate([
      {
        label: 'Hide mini timer',
        click: () => (this.opts.onHideRequested ? this.opts.onHideRequested() : this.hide())
      },
      { type: 'separator' },
      { label: 'Open Toggl Traction', click: () => this.opts.onOpenMain?.() }
    ])
    menu.popup({ window: this.win })
  }

  private create(): BrowserWindow {
    const saved = loadMiniPosition()
    const primary = screen.getPrimaryDisplay().workArea
    const win = new BrowserWindow({
      width: MINI_WIDTH,
      height: MINI_HEIGHT,
      x: saved?.x ?? primary.x + primary.width - MINI_WIDTH - 24,
      y: saved?.y ?? primary.y + 24,
      show: false,
      frame: false,
      resizable: false,
      maximizable: false,
      minimizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      title: 'Timer',
      // Match the card surface so any transient gap during auto-resize or the
      // rounded corners don't flash a mismatched colour.
      backgroundColor: '#1c1e2a',
      webPreferences: {
        preload,
        sandbox: false,
        contextIsolation: true,
        nodeIntegration: false
      }
    })

    this.applyAlwaysOnTop(win)

    // Right-click anywhere on the mini timer opens its context menu.
    win.webContents.on('context-menu', () => this.popupMenu())

    // Re-assert whenever the window could have lost its topmost status.
    win.on('show', () => this.applyAlwaysOnTop(win))
    win.on('blur', () => this.applyAlwaysOnTop(win))
    win.on('focus', () => this.applyAlwaysOnTop(win))
    win.on('moved', () => {
      const [x = 0, y = 0] = win.getPosition()
      saveMiniPosition(x, y)
    })

    // Closing the window (e.g. Cmd+W) should hide it, not destroy it.
    win.on('close', (e) => {
      if (!(app as unknown as { isQuitting?: boolean }).isQuitting) {
        e.preventDefault()
        win.hide()
      }
    })

    loadEntry(win, 'mini')
    return win
  }

  /**
   * Size the window to exactly fit the renderer's measured content, so there is
   * never empty space at the bottom. The renderer calls this whenever its
   * content height changes (expand/collapse, font scaling, running state). The
   * window keeps its top-left corner but is nudged back on-screen near edges;
   * macOS animates a meaningful size change (e.g. expand/collapse).
   */
  setContentSize(width: number, height: number): void {
    const win = this.win
    if (!win || win.isDestroyed()) return
    const w = Math.round(Math.max(180, Math.min(width, 520)))
    const h = Math.round(Math.max(48, Math.min(height, 640)))
    const [x = 0, y = 0] = win.getPosition()
    const [curW = w, curH = h] = win.getSize()
    if (curW === w && curH === h) return // no change → avoid redundant resize
    const display = screen.getDisplayNearestPoint({ x, y })
    const wa = display.workArea
    const nx = Math.min(Math.max(x, wa.x), wa.x + wa.width - w)
    const ny = Math.min(Math.max(y, wa.y), wa.y + wa.height - h)
    // Animate only for larger jumps (expand/collapse), not tiny reflows.
    const animate = process.platform === 'darwin' && Math.abs(curH - h) > 24
    win.setBounds({ x: Math.round(nx), y: Math.round(ny), width: w, height: h }, animate)
    this.applyAlwaysOnTop(win)
  }

  private applyAlwaysOnTop(win: BrowserWindow): void {
    if (win.isDestroyed()) return
    win.setAlwaysOnTop(true, AOT_LEVEL)
    // Keep it visible across spaces and over fullscreen apps (macOS/Windows).
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  }

  private onDisplayChange(): void {
    if (!this.win || this.win.isDestroyed()) return
    // A display change can drop the topmost flag and can move the window
    // off-screen; re-assert and pull it back into a valid work area.
    this.applyAlwaysOnTop(this.win)
    const [x = 0, y = 0] = this.win.getPosition()
    const visible = screen.getAllDisplays().some((d) => {
      const b = d.workArea
      return x >= b.x && x < b.x + b.width && y >= b.y && y < b.y + b.height
    })
    if (!visible) {
      const primary = screen.getPrimaryDisplay().workArea
      this.win.setPosition(primary.x + primary.width - MINI_WIDTH - 24, primary.y + 24)
    }
  }

  show(): void {
    if (!this.win || this.win.isDestroyed()) {
      this.win = this.create()
    }
    if (!this.displayListenersBound) {
      screen.on('display-metrics-changed', this.onDisplayChange)
      screen.on('display-added', this.onDisplayChange)
      screen.on('display-removed', this.onDisplayChange)
      this.displayListenersBound = true
    }
    const win = this.win
    win.showInactive()
    this.applyAlwaysOnTop(win)

    if (!this.heartbeat) {
      // Belt-and-braces: some window managers drop topmost with no event.
      this.heartbeat = setInterval(() => {
        if (this.win && !this.win.isDestroyed() && this.win.isVisible()) {
          this.applyAlwaysOnTop(this.win)
        }
      }, 4000)
    }
  }

  hide(): void {
    if (this.heartbeat) {
      clearInterval(this.heartbeat)
      this.heartbeat = null
    }
    if (this.win && !this.win.isDestroyed()) this.win.hide()
  }

  isVisible(): boolean {
    return !!this.win && !this.win.isDestroyed() && this.win.isVisible()
  }

  destroy(): void {
    this.hide()
    if (this.displayListenersBound) {
      screen.removeListener('display-metrics-changed', this.onDisplayChange)
      screen.removeListener('display-added', this.onDisplayChange)
      screen.removeListener('display-removed', this.onDisplayChange)
      this.displayListenersBound = false
    }
    if (this.win && !this.win.isDestroyed()) this.win.destroy()
    this.win = null
  }

  get browserWindow(): BrowserWindow | null {
    return this.win && !this.win.isDestroyed() ? this.win : null
  }
}
