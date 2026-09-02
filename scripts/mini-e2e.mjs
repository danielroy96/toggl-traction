/*
 * Headless end-to-end check of the mini timer's auto-fit in REAL Electron.
 * Creates the mini window exactly like the app (real preload, frameless),
 * stubs the IPC the renderer needs, actually resizes on mini:set-content-size,
 * then checks the always-visible fields fit, and that opening each inline
 * dropdown (description autocomplete, project/task picker) grows the window
 * instead of clipping the list.
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
  const h = Math.round(Math.max(40, Math.min(height, 640)))
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
// Recent entries feed the description autocomplete, so give it something to
// suggest — otherwise the list never opens and the check is vacuous.
ipcMain.handle('entries:recent', () =>
  ok([
    { id: 91, workspace_id: 100, description: 'PROJ-1 Review the API client', project_id: 1, task_id: 10, start: '2026-01-01T09:00:00Z', stop: '2026-01-01T10:00:00Z', duration: 3600 },
    { id: 92, workspace_id: 100, description: 'PROJ-2 Standup', project_id: 1, task_id: null, start: '2026-01-01T08:45:00Z', stop: '2026-01-01T09:00:00Z', duration: 900 }
  ])
)
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
    desc: r('.autocomplete > .input'),
    acList: r('.autocomplete__list'),
    picker: r('.ptpick__trigger'),
    ptPanel: r('.ptpick__panel'),
  };
})()`

app.whenReady().then(async () => {
  win = new BrowserWindow({
    width: 300,
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

  const idle = await win.webContents.executeJavaScript(measure)
  log('IDLE:', JSON.stringify(idle))
  const idleClip = idle.picker && idle.picker.bottom > idle.winH
  log(`  idle: play centered in header? ${!!idle.playRound}  picker clipped? ${idleClip}`)

  // Open the description autocomplete (focus shows all recent entries).
  await win.webContents.executeJavaScript(
    `document.querySelector('.autocomplete > .input').focus(); true`
  )
  await delay(2000)
  const acOpen = await win.webContents.executeJavaScript(measure)
  log('AUTOCOMPLETE OPEN:', JSON.stringify(acOpen))
  const acClip = acOpen.acList ? acOpen.acList.bottom > acOpen.winH : null
  log(`  suggestion list present? ${!!acOpen.acList}  clipped? ${acClip}`)

  // Close it, then open the project/task picker.
  await win.webContents.executeJavaScript(
    `document.querySelector('.autocomplete > .input').blur(); true`
  )
  await delay(600)
  await win.webContents.executeJavaScript(
    `document.querySelector('.ptpick__trigger').click(); true`
  )
  await delay(2500) // well past any macOS resize animation

  log('window size (main) after opening picker:', win.getSize().join('x'))
  const ptOpen = await win.webContents.executeJavaScript(measure)
  log('PICKER OPEN:', JSON.stringify(ptOpen))
  const ptClip = ptOpen.ptPanel ? ptOpen.ptPanel.bottom > ptOpen.winH : null
  log(`  picker panel bottom=${ptOpen.ptPanel?.bottom} winH=${ptOpen.winH} -> clipped? ${ptClip}`)

  log('RESULT', JSON.stringify({ idleClip, acListClip: acClip, pickerPanelClip: ptClip }))
  // Held open for screen capture; set MINI_E2E_HOLD_MS=0 to exit immediately.
  const hold = Number(process.env['MINI_E2E_HOLD_MS'] ?? 15000)
  if (hold > 0) log(`holding window open for ${hold}ms…`)
  await delay(hold)
  app.quit()
})

app.on('window-all-closed', () => app.quit())
