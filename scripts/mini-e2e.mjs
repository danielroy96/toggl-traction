/*
 * Headless end-to-end check of the mini timer's auto-fit in REAL Electron.
 * Creates the mini window exactly like the app (real preload, frameless),
 * stubs the IPC the renderer needs, actually resizes on mini:set-content-size,
 * then drives collapse/expand and reports the true window height vs the Start
 * button position. Window is hidden (show:false) so nothing pops up.
 *
 * Run: node_modules/.bin/electron scripts/mini-e2e.mjs
 */
import { app, BrowserWindow, ipcMain } from 'electron'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')
const ok = (data) => ({ ok: true, data })

const settings = {
  fontScale: 'system',
  theme: 'dark',
  miniTimerEnabled: true,
  miniTimerAlwaysVisible: false,
  launchAtLogin: false,
  integrations: { windowDetection: false, jira: false, googleCalendar: false }
}

const delay = (ms) => new Promise((r) => setTimeout(r, ms))
const log = (...a) => console.log('[e2e]', ...a)

let win

// The renderer's setContentSize -> we resize the window for real, like the app.
// Mirror the REAL MiniTimerWindow.setContentSize exactly: animated setBounds on
// macOS, then applyAlwaysOnTop (setAlwaysOnTop + setVisibleOnAllWorkspaces).
ipcMain.handle('mini:set-content-size', (_e, width, height) => {
  const w = Math.round(Math.max(180, Math.min(width, 520)))
  const h = Math.round(Math.max(48, Math.min(height, 640)))
  if (win && !win.isDestroyed()) {
    const [x, y] = win.getPosition()
    const [, curH] = win.getSize()
    const animate = process.platform === 'darwin' && Math.abs(curH - h) > 24
    win.setBounds({ x, y, width: w, height: h }, animate)
    win.setAlwaysOnTop(true, 'screen-saver')
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
    log(`req ${w}x${h} animate=${animate} -> immediate ${win.getSize().join('x')}`)
  }
  return ok(null)
})
ipcMain.handle('mini:show', () => ok(null))
ipcMain.handle('mini:hide', () => ok(null))
ipcMain.handle('timer:get-state', () => ok({ running: null, pending: false, error: null, lastSyncedAt: null }))
ipcMain.handle('timer:sync', () => ok({ running: null, pending: false, error: null, lastSyncedAt: null }))
ipcMain.handle('settings:get', () => ok(settings))
ipcMain.handle('projects:list', () => ok([{ id: 1, workspace_id: 100, name: 'PROJ – Platform', color: '#e08bd6', active: true }]))
ipcMain.handle('tasks:list', () => ok([{ id: 10, workspace_id: 100, project_id: 1, name: 'Code review', active: true }]))
ipcMain.handle('entries:recent', () => ok([]))
ipcMain.handle('entry:update', () => ok({}))
ipcMain.handle('timer:start', () => ok({}))
ipcMain.handle('timer:stop', () => ok(null))

const measure = `(() => {
  const r = (s) => { const el = document.querySelector(s); if (!el) return null; const b = el.getBoundingClientRect(); return { top: Math.round(b.top), bottom: Math.round(b.bottom), cy: Math.round(b.top + b.height/2) }; };
  return {
    winH: window.innerHeight,
    content: r('.mini__content'),
    header: r('.mini__header'),
    time: r('.mini__time'),
    playRound: r('.mini__btn'),
    chevron: r('.mini__expand'),
    primary: r('.mini__primary'),
  };
})()`

app.whenReady().then(async () => {
  win = new BrowserWindow({
    width: 232,
    height: 72,
    x: 60,
    y: 80,
    show: true,
    frame: false,
    resizable: false,
    alwaysOnTop: true,
    webPreferences: {
      preload: join(root, 'out/preload/index.mjs'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  await win.loadFile(join(root, 'out/renderer/mini.html'))
  await delay(1200) // React mount + useLayoutEffect + resize round-trip

  const collapsed = await win.webContents.executeJavaScript(measure)
  log('COLLAPSED:', JSON.stringify(collapsed))
  const cClip = collapsed.playRound && collapsed.playRound.bottom > collapsed.winH
  const cCentered = collapsed.playRound && Math.abs(collapsed.playRound.cy - collapsed.winH / 2) <= 2
  log(`  collapsed play button clipped? ${cClip}   vertically centered? ${cCentered}`)

  // Expand.
  await win.webContents.executeJavaScript(`document.querySelector('.mini__expand').click(); true`)
  await delay(2500) // well past any macOS resize animation

  log('window size (main) after expand:', win.getSize().join('x'))
  const expanded = await win.webContents.executeJavaScript(measure)
  log('EXPANDED:', JSON.stringify(expanded))
  const eClip = expanded.primary && expanded.primary.bottom > expanded.winH
  log(`  expanded Start button bottom=${expanded.primary?.bottom} winH=${expanded.winH} -> clipped? ${eClip}`)

  log('RESULT', JSON.stringify({ collapsedClip: cClip, collapsedCentered: cCentered, expandedClip: eClip }))
  log('holding window open for screen capture…')
  await delay(15000)
  app.quit()
})

app.on('window-all-closed', () => app.quit())
