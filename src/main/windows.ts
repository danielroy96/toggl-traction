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
  // Whether `visibleOnAllWorkspaces` is currently applied. Calling
  // setVisibleOnAllWorkspaces repeatedly is the classic macOS cause of orphaned
  // "ghost" windows, so we apply it exactly once per shown session and clear it
  // before hiding, tracking the state here rather than re-asserting blindly.
  private spacesApplied = false
  // The renderer has reported at least one content size, so the window is sized
  // to fit. We defer the first reveal until this is true to avoid flashing the
  // window at its placeholder height.
  private hasFitted = false
  // show() was requested; the window should be revealed once it has fitted.
  private wantsVisible = false
  private revealTimer: ReturnType<typeof setTimeout> | null = null

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
    // Fresh window: it has not fitted yet and carries no Spaces flag.
    this.hasFitted = false
    this.spacesApplied = false
    const win = new BrowserWindow({
      width: MINI_WIDTH,
      height: MINI_HEIGHT,
      x: saved?.x ?? primary.x + primary.width - MINI_WIDTH - 24,
      y: saved?.y ?? primary.y + 24,
      // Content-relative sizing: width/height and setContentSize() below refer
      // to the web content area, so the renderer's measured height maps 1:1 to
      // the OS window and there is no frame arithmetic to get wrong.
      useContentSize: true,
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

    // Right-click anywhere on the mini timer opens its context menu.
    win.webContents.on('context-menu', () => this.popupMenu())

    // Re-assert topmost when the window could have lost it. Deliberately only
    // setAlwaysOnTop here (cheap, idempotent) — NOT setVisibleOnAllWorkspaces,
    // whose repeated use spawns ghost windows on macOS.
    win.on('show', () => this.assertOnTop())
    win.on('blur', () => this.assertOnTop())
    win.on('focus', () => this.assertOnTop())
    win.on('moved', () => {
      const [x = 0, y = 0] = win.getPosition()
      saveMiniPosition(x, y)
    })

    // Closing the window (e.g. Cmd+W) should hide it, not destroy it.
    win.on('close', (e) => {
      if (!(app as unknown as { isQuitting?: boolean }).isQuitting) {
        e.preventDefault()
        this.hide()
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
    // The renderer has produced a real measurement — safe to reveal now.
    this.hasFitted = true
    const [x = 0, y = 0] = win.getPosition()
    const [curW = w, curH = h] = win.getContentSize()
    if (curW !== w || curH !== h) {
      const display = screen.getDisplayNearestPoint({ x, y })
      const wa = display.workArea
      const nx = Math.min(Math.max(x, wa.x), wa.x + wa.width - w)
      const ny = Math.min(Math.max(y, wa.y), wa.y + wa.height - h)
      // Animate only for larger jumps (expand/collapse), not tiny reflows.
      const animate = process.platform === 'darwin' && Math.abs(curH - h) > 24
      win.setContentBounds(
        { x: Math.round(nx), y: Math.round(ny), width: w, height: h },
        animate
      )
      this.assertOnTop()
    }
    // First fit for a pending show → reveal the correctly-sized window.
    if (this.wantsVisible && !win.isVisible()) this.reveal()
  }

  /**
   * Re-assert always-on-top only. Cheap and idempotent — unlike
   * setVisibleOnAllWorkspaces, repeating setAlwaysOnTop does not spawn ghost
   * windows, so this is what every routine "keep it on top" path uses.
   */
  private assertOnTop(): void {
    const win = this.win
    if (!win || win.isDestroyed() || !win.isVisible()) return
    win.setAlwaysOnTop(true, AOT_LEVEL)
  }

  /**
   * Actually put the window on screen, once it has a real content size. Applies
   * the cross-Spaces / over-fullscreen visibility exactly once per shown session
   * (tracked by `spacesApplied`) to avoid ghost-window duplication.
   */
  private reveal(): void {
    const win = this.win
    if (!this.wantsVisible || !win || win.isDestroyed()) return
    if (this.revealTimer) {
      clearTimeout(this.revealTimer)
      this.revealTimer = null
    }
    if (!win.isVisible()) win.showInactive()
    win.setAlwaysOnTop(true, AOT_LEVEL)
    if (!this.spacesApplied) {
      win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
      this.spacesApplied = true
    }
    if (!this.heartbeat) {
      // Belt-and-braces: some window managers drop topmost with no event.
      // Only re-assert alwaysOnTop here — never setVisibleOnAllWorkspaces.
      this.heartbeat = setInterval(() => this.assertOnTop(), 4000)
    }
  }

  private onDisplayChange(): void {
    if (!this.win || this.win.isDestroyed()) return
    // A display change can drop the topmost flag and can move the window
    // off-screen; re-assert and pull it back into a valid work area.
    this.assertOnTop()
    const [x = 0, y = 0] = this.win.getPosition()
    const [w = MINI_WIDTH] = this.win.getContentSize()
    const visible = screen.getAllDisplays().some((d) => {
      const b = d.workArea
      return x >= b.x && x < b.x + b.width && y >= b.y && y < b.y + b.height
    })
    if (!visible) {
      const primary = screen.getPrimaryDisplay().workArea
      this.win.setPosition(primary.x + primary.width - w - 24, primary.y + 24)
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
    this.wantsVisible = true
    // Reveal now if the window is already sized to its content; otherwise wait
    // for the renderer's first setContentSize (with a fallback so a renderer
    // that never reports still surfaces the window).
    if (this.hasFitted) {
      this.reveal()
    } else if (!this.revealTimer) {
      this.revealTimer = setTimeout(() => this.reveal(), 1500)
    }
  }

  hide(): void {
    this.wantsVisible = false
    if (this.revealTimer) {
      clearTimeout(this.revealTimer)
      this.revealTimer = null
    }
    if (this.heartbeat) {
      clearInterval(this.heartbeat)
      this.heartbeat = null
    }
    const win = this.win
    if (win && !win.isDestroyed()) {
      // Clear the cross-Spaces flag before hiding. Leaving it set while hidden
      // is what leaves phantom copies of the window on other macOS Spaces.
      if (this.spacesApplied) {
        win.setVisibleOnAllWorkspaces(false)
        this.spacesApplied = false
      }
      win.hide()
    }
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
