/*
 * Headless end-to-end check of the mini timer in REAL Electron. Creates the
 * mini window exactly like the app (real preload, frameless, transparent),
 * stubs the IPC the renderer needs and actually resizes on
 * mini:set-content-size, then checks the two things the layout has to get
 * right:
 *
 *  - the card is ONE LINE: time, description and controls share a row;
 *  - the CARD never changes size when a dropdown opens — only the transparent
 *    window around it grows, so the dropdowns behave like dropdowns;
 *  - no dropdown is clipped by the window edge;
 *  - the focus ring stays inside the field instead of lapping the next control;
 *  - Enter on a highlighted suggestion starts the timer.
 *
 * It also drives the expand toggle, which is the one control that is *meant*
 * to change the card's size (it reveals the project/task picker).
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
// Every size the renderer asked for, so we can assert it isn't thrashing.
const sizeRequests = []
// Payloads the renderer sent to timer:start, for the Enter-to-start check.
const starts = []

// The renderer's setContentSize -> we resize the window for real, like the app.
// Mirrors MiniTimerWindow.setContentSize: clamped, content-relative, no
// animation.
ipcMain.handle('mini:set-content-size', (_e, width, height) => {
  const w = Math.round(Math.max(180, Math.min(width, 520)))
  const h = Math.round(Math.max(40, Math.min(height, 640)))
  sizeRequests.push(`${w}x${h}`)
  if (win && !win.isDestroyed()) {
    const [x, y] = win.getPosition()
    const [curW, curH] = win.getContentSize()
    if (curW !== w || curH !== h) {
      win.setContentBounds({ x, y, width: w, height: h })
      win.setAlwaysOnTop(true, 'screen-saver')
    }
    log(`req ${w}x${h} -> ${win.getContentSize().join('x')}`)
  }
  return ok(null)
})
ipcMain.handle('mini:show', () => ok(null))
ipcMain.handle('mini:hide', () => ok(null))
ipcMain.handle('timer:get-state', () => ok({ running: null, pending: false, error: null, lastSyncedAt: null }))
ipcMain.handle('timer:sync', () => ok({ running: null, pending: false, error: null, lastSyncedAt: null }))
ipcMain.handle('settings:get', () => ok(settings))
// Enough projects that the picker's list has to scroll — that is what
// exercises the keyboard "keep the active option in view" path.
ipcMain.handle('projects:list', () =>
  ok(
    Array.from({ length: 20 }, (_, i) => ({
      id: i + 1,
      workspace_id: 100,
      name: i === 0 ? 'PROJ – Platform' : `Project ${String(i + 1).padStart(2, '0')}`,
      color: '#e08bd6',
      active: true
    }))
  )
)
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
ipcMain.handle('timer:start', (_e, payload) => {
  starts.push(payload)
  return ok({})
})
ipcMain.handle('timer:stop', () => ok(null))

const measure = `(() => {
  const r = (s) => { const el = document.querySelector(s); if (!el) return null; const b = el.getBoundingClientRect(); return { top: Math.round(b.top), bottom: Math.round(b.bottom), h: Math.round(b.height) }; };
  return {
    winH: window.innerHeight,
    card: r('.mini'),
    header: r('.mini__header'),
    time: r('.mini__time'),
    playRound: r('.mini__btn'),
    row: r('.mini__row'),
    desc: r('.autocomplete .input'),
    descBox: (() => { const el = document.querySelector('.autocomplete .input'); if (!el) return null; const b = el.getBoundingClientRect(); return { left: Math.round(b.left), right: Math.round(b.right) } })(),
    stopBox: (() => { const el = document.querySelector('.mini__btn'); if (!el) return null; const b = el.getBoundingClientRect(); return { left: Math.round(b.left), right: Math.round(b.right) } })(),
    acList: r('.autocomplete__list'),
    picker: r('.ptpick__trigger'),
    ptPanel: r('.ptpick__panel'),
    status: r('.mini__status'),
    scrollY: Math.round(window.scrollY),
  };
})()`

const failures = []
const check = (name, pass, detail) => {
  log(`  ${pass ? 'PASS' : 'FAIL'} ${name}${detail ? ` (${detail})` : ''}`)
  if (!pass) failures.push(name)
}

app.whenReady().then(async () => {
  win = new BrowserWindow({
    width: 500,
    height: 48,
    x: 60,
    y: 80,
    useContentSize: true,
    show: true,
    frame: false,
    transparent: true,
    hasShadow: false,
    backgroundColor: '#00000000',
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
  const cardH = idle.card.h
  check('no TRACKING label', idle.status === null)
  check('single field (no picker while collapsed)', idle.picker === null)
  // One line: the description shares the row with the time and the controls,
  // so the card is barely taller than a single control.
  check('card is one line', cardH <= 56, `card ${cardH}px`)
  check('description is on the control row', idle.desc && idle.row && idle.desc.top >= idle.row.top && idle.desc.bottom <= idle.row.bottom, JSON.stringify({ desc: idle.desc, row: idle.row }))
  check('description sits left of the stop button', idle.descBox.right <= idle.stopBox.left, `desc ends ${idle.descBox.right}, stop starts ${idle.stopBox.left}`)
  check('window fits the card (no dead space)', idle.winH - idle.card.bottom <= 3 && idle.winH >= idle.card.bottom, `win ${idle.winH} card ${idle.card.bottom}`)

  // The description is borderless at rest and outlines itself on hover. Driven
  // with a real mouseMove so the :hover state actually engages, and measured
  // either side to prove the row does not shift when the border appears.
  const borderAt = (label) =>
    win.webContents.executeJavaScript(
      `(() => { const f = document.querySelector('.autocomplete--tagged .autocomplete__field') || document.querySelector('.autocomplete .input');
         const b = f.getBoundingClientRect();
         return { where: '${label}', color: getComputedStyle(f).borderColor,
                  width: getComputedStyle(f).borderTopWidth,
                  cardH: Math.round(document.querySelector('.mini').getBoundingClientRect().height),
                  cx: Math.round(b.left + b.width / 2), cy: Math.round(b.top + b.height / 2) } })()`
    )
  const rest = await borderAt('rest')
  win.webContents.sendInputEvent({ type: 'mouseMove', x: rest.cx, y: rest.cy })
  await delay(300)
  const hover = await borderAt('hover')
  // Park the pointer off the field again.
  win.webContents.sendInputEvent({ type: 'mouseMove', x: 5, y: 5 })
  await delay(300)
  log('FIELD BORDER:', JSON.stringify({ rest, hover }))
  check('the field has no visible border at rest', rest.color.includes('rgba(0, 0, 0, 0)') || rest.color.includes('transparent'), rest.color)
  check('hovering reveals the border', hover.color !== rest.color && !hover.color.includes('rgba(0, 0, 0, 0)'), hover.color)
  check('the border still occupies space at rest', rest.width === hover.width && parseFloat(rest.width) > 0, `${rest.width} vs ${hover.width}`)
  check('hovering does not move the row', rest.cardH === hover.cardH, `${rest.cardH} -> ${hover.cardH}`)

  // The focus ring is drawn inside the field, so it cannot lap the button next
  // to it however tight the row is.
  win.focus()
  await delay(300)
  const ring = await win.webContents.executeJavaScript(
    `(() => { const i = document.querySelector('.autocomplete .input'); i.focus();
       const s = getComputedStyle(i);
       const off = parseFloat(s.outlineOffset) || 0;
       const w = parseFloat(s.outlineWidth) || 0;
       const b = i.getBoundingClientRect();
       const btn = document.querySelector('.mini__icon-btn').getBoundingClientRect();
       return { off, w, ringRight: Math.round(b.right + off + w), btnLeft: Math.round(btn.left), ringBottom: Math.round(b.bottom + off + w), cardBottom: Math.round(document.querySelector('.mini').getBoundingClientRect().bottom) } })()`
  )
  log('FOCUS RING:', JSON.stringify(ring))
  check('focus ring is inset', ring.off < 0, `outline-offset ${ring.off}px`)
  check('focus ring clears the next control', ring.ringRight <= ring.btnLeft, `ring ${ring.ringRight}, button ${ring.btnLeft}`)
  check('focus ring stays inside the card', ring.ringBottom <= ring.cardBottom, `ring ${ring.ringBottom}, card ${ring.cardBottom}`)

  // Open the description autocomplete (focus shows all recent entries).
  // The window must hold OS focus first, or Chromium ignores element.focus().
  win.focus()
  await delay(300)
  await win.webContents.executeJavaScript(
    `(() => { const i = document.querySelector('.autocomplete .input'); i.focus(); i.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); return true })()`
  )
  await delay(800)
  const acOpen = await win.webContents.executeJavaScript(measure)
  log('AUTOCOMPLETE OPEN:', JSON.stringify(acOpen))
  check('suggestion list rendered', !!acOpen.acList)
  check('suggestion list not clipped', acOpen.acList && acOpen.acList.bottom <= acOpen.winH, `list ${acOpen.acList?.bottom} win ${acOpen.winH}`)
  check('list overlays instead of growing the card', acOpen.card.h === cardH, `${cardH} -> ${acOpen.card.h}`)
  check('list hangs outside the card', acOpen.acList && acOpen.acList.top >= cardH - 40)

  // Close it — the window should shrink back to the card.
  await win.webContents.executeJavaScript(
    `document.querySelector('.autocomplete .input').blur(); true`
  )
  await delay(900) // blur close (120ms) + deferred shrink (180ms) + slack
  const closed = await win.webContents.executeJavaScript(measure)
  check('window shrinks back after closing', closed.winH - cardH <= 3 && closed.winH >= cardH, `win ${closed.winH} card ${cardH}`)

  // Expand: this is the one action allowed to change the card's size.
  await win.webContents.executeJavaScript(
    `document.querySelector('button[aria-expanded]').click(); true`
  )
  await delay(600)
  const expanded = await win.webContents.executeJavaScript(measure)
  log('EXPANDED:', JSON.stringify(expanded))
  const expandedCardH = expanded.card.h
  check('expand reveals the project/task picker', !!expanded.picker)
  check('expand grows the card', expandedCardH > cardH, `${cardH} -> ${expandedCardH}`)

  // A project/task name is never shown without the colour that identifies it.
  const triggerDot = await win.webContents.executeJavaScript(
    `(() => { const t = document.querySelector('.ptpick__trigger');
       const dot = t.querySelector('.project-dot');
       return { hasDot: !!dot, bg: dot && getComputedStyle(dot).backgroundColor, label: t.querySelector('.ptpick__value').textContent } })()`
  )
  log('PICKER TRIGGER:', JSON.stringify(triggerDot))
  check('the picker trigger shows a project dot', triggerDot.hasDot, JSON.stringify(triggerDot))
  check('window fits the expanded card', expanded.winH - expanded.card.bottom <= 3 && expanded.winH >= expanded.card.bottom, `win ${expanded.winH} card ${expanded.card.bottom}`)

  // Open the picker panel.
  await win.webContents.executeJavaScript(
    `document.querySelector('.ptpick__trigger').click(); true`
  )
  await delay(800)
  const ptOpen = await win.webContents.executeJavaScript(measure)
  log('PICKER OPEN:', JSON.stringify(ptOpen))
  check('picker panel rendered', !!ptOpen.ptPanel)
  check('picker panel not clipped', ptOpen.ptPanel && ptOpen.ptPanel.bottom <= ptOpen.winH, `panel ${ptOpen.ptPanel?.bottom} win ${ptOpen.winH}`)
  check('panel overlays instead of growing the card', ptOpen.card.h === expandedCardH, `${expandedCardH} -> ${ptOpen.card.h}`)

  // Arrow past the bottom of the list. The list must scroll; the page must not
  // (scrollIntoView used to drag the whole card off the top of the window).
  await win.webContents.executeJavaScript(
    `(() => { const i = document.querySelector('.ptpick__search');
       for (let n = 0; n < 15; n++) i.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
       return true })()`
  )
  await delay(400)
  const scrolled = await win.webContents.executeJavaScript(
    `(() => { const l = document.querySelector('.ptpick__list'); const a = document.querySelector('.ptpick__opt--active');
       const lr = l.getBoundingClientRect(); const ar = a.getBoundingClientRect();
       return { listScroll: Math.round(l.scrollTop), pageScroll: Math.round(window.scrollY),
                cardTop: Math.round(document.querySelector('.mini').getBoundingClientRect().top),
                activeInView: ar.top >= lr.top - 1 && ar.bottom <= lr.bottom + 1 } })()`
  )
  log('KEYBOARD SCROLL:', JSON.stringify(scrolled))
  check('list scrolled to follow the active option', scrolled.listScroll > 0)
  check('active option is in view', scrolled.activeInView)
  check('the page itself did not scroll', scrolled.pageScroll === 0 && scrolled.cardTop === 0, `scrollY ${scrolled.pageScroll} card.top ${scrolled.cardTop}`)

  // Close the panel again so the collapse check below starts from a clean state.
  await win.webContents.executeJavaScript(
    `document.querySelector('.ptpick__search').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); true`
  )
  await delay(500)
  check('page never scrolled', ptOpen.scrollY === 0 && ptOpen.card.top === 0, `scrollY ${ptOpen.scrollY} card.top ${ptOpen.card.top}`)

  // Collapse again.
  await win.webContents.executeJavaScript(
    `document.querySelector('button[aria-expanded]').click(); true`
  )
  await delay(900)
  const collapsed = await win.webContents.executeJavaScript(measure)
  check('collapse returns to the original size', collapsed.card.h === cardH && collapsed.winH - cardH <= 3, `card ${collapsed.card.h} win ${collapsed.winH}`)

  // Enter on a highlighted suggestion should start the timer, not just fill in
  // the fields. (Nothing is running in this harness, so a start is expected.)
  // Click into the field the way a user does. A bare .focus() is not enough:
  // after the window has been deactivated the component deliberately swallows
  // the reactivation focus, so only a real pointer press reopens the list.
  win.focus()
  await delay(200)
  await win.webContents.executeJavaScript(
    `(() => { const i = document.querySelector('.autocomplete .input'); i.focus();
       i.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); return true })()`
  )
  await delay(500)
  check(
    'the suggestion list is open before arrowing',
    await win.webContents.executeJavaScript(`!!document.querySelector('.autocomplete__opt')`)
  )
  await win.webContents.executeJavaScript(
    `(() => { const i = document.querySelector('.autocomplete .input');
       i.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
       return true })()`
  )
  await delay(300)
  const picked = await win.webContents.executeJavaScript(
    `document.querySelector('.autocomplete__opt--active')?.textContent ?? null`
  )
  await win.webContents.executeJavaScript(
    `(() => { const i = document.querySelector('.autocomplete .input');
       i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
       return true })()`
  )
  await delay(600)
  log('ENTER-TO-START:', JSON.stringify({ picked, starts }))
  check('Enter on a suggestion started the timer', starts.length === 1, `${starts.length} start(s)`)
  check(
    'it started with the suggestion\'s description, project and task',
    !!starts[0] && starts[0].description === 'PROJ-1 Review the API client' && starts[0].projectId === 1 && starts[0].taskId === 10,
    JSON.stringify(starts[0])
  )

  // Choosing a suggestion with the mouse fills the fields without starting.
  // The collapsed field must then carry that entry's project colour and task
  // name, since the picker itself is not on screen to say so.
  win.focus()
  await delay(300)
  await win.webContents.executeJavaScript(
    `(() => { const i = document.querySelector('.autocomplete .input'); i.focus(); i.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); return true })()`
  )
  await delay(500)
  const optionShowing = await win.webContents.executeJavaScript(
    `!!document.querySelector('.autocomplete__opt')`
  )
  check('a suggestion is on screen to click', optionShowing)
  await win.webContents.executeJavaScript(
    `(() => { const o = document.querySelector('.autocomplete__opt');
       o.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
       return true })()`
  )
  await delay(600)
  const tag = await win.webContents.executeJavaScript(
    `(() => { const t = document.querySelector('.autocomplete__tag'); if (!t) return null;
       const dot = t.querySelector('.project-dot');
       return { label: t.querySelector('.autocomplete__tag-label').textContent,
                bg: getComputedStyle(dot).backgroundColor,
                title: t.getAttribute('title'),
                insideField: !!t.closest('.autocomplete__field'),
                startsAfterInput: t.getBoundingClientRect().left >= document.querySelector('.autocomplete .input').getBoundingClientRect().right - 1 } })()`
  )
  log('FIELD TAG:', JSON.stringify(tag))
  check('the collapsed field shows a project/task tag', !!tag)
  check('the tag names the task', tag && tag.label === 'Code review', tag && tag.label)
  // Stub project 1 is #e08bd6 = rgb(224, 139, 214).
  check('the dot carries that project’s colour', tag && tag.bg === 'rgb(224, 139, 214)', tag && tag.bg)
  check('the tag sits inside the field, after the text', tag && tag.insideField && tag.startsAfterInput, JSON.stringify(tag))
  check('the tag’s tooltip gives the full path', tag && tag.title === 'PROJ – Platform · Code review', tag && tag.title)
  // Gaining a project must not nudge the row: the tag's border replaces the
  // input's rather than adding to it.
  const tagged = await win.webContents.executeJavaScript(measure)
  check('the tag does not change the card height', tagged.card.h === cardH, `${cardH} -> ${tagged.card.h}`)

  log('size requests:', sizeRequests.join(' '))
  log(failures.length ? `RESULT FAIL: ${failures.join(', ')}` : 'RESULT PASS')
  // Held open for screen capture; set MINI_E2E_HOLD_MS=0 to exit immediately.
  const hold = Number(process.env['MINI_E2E_HOLD_MS'] ?? 15000)
  if (hold > 0) log(`holding window open for ${hold}ms…`)
  await delay(hold)
  app.exit(failures.length ? 1 : 0)
})

app.on('window-all-closed', () => app.quit())
