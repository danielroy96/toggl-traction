import { Tray, Menu, nativeImage, type NativeImage } from 'electron'

interface TrayCallbacks {
  onOpen: () => void
  onToggleTimer: () => void
  onToggleMini: () => void
  onQuit: () => void
  getRunning: () => boolean
  isMiniVisible: () => boolean
}

let tray: Tray | null = null

/**
 * Builds a simple circular tray icon at runtime (filled when a timer is
 * running, hollow when idle) so the app ships without binary asset files.
 */
function makeIcon(running: boolean): NativeImage {
  const size = 16
  const r = 6
  const cx = size / 2
  const cy = size / 2
  const buf = Buffer.alloc(size * size * 4)
  const fg = running ? [88, 214, 141] : [180, 184, 200] // green when running
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy)
      const i = (y * size + x) * 4
      let alpha = 0
      if (d <= r) {
        if (running || d >= r - 2) alpha = 255
      }
      // Anti-alias the edge a touch.
      if (d > r && d < r + 1) alpha = Math.round(255 * (r + 1 - d))
      buf[i] = fg[0]!
      buf[i + 1] = fg[1]!
      buf[i + 2] = fg[2]!
      buf[i + 3] = alpha
    }
  }
  const img = nativeImage.createFromBuffer(buf, { width: size, height: size })
  img.setTemplateImage(false)
  return img
}

export function createTray(cb: TrayCallbacks): Tray {
  tray = new Tray(makeIcon(cb.getRunning()))
  tray.setToolTip('Toggl Traction')

  const rebuild = (): void => {
    const running = cb.getRunning()
    tray?.setImage(makeIcon(running))
    const menu = Menu.buildFromTemplate([
      { label: 'Open Toggl Traction', click: cb.onOpen },
      { type: 'separator' },
      { label: running ? 'Stop timer' : 'Start timer', click: cb.onToggleTimer },
      {
        label: cb.isMiniVisible() ? 'Hide mini timer' : 'Show mini timer',
        click: cb.onToggleMini
      },
      { type: 'separator' },
      { label: 'Quit', click: cb.onQuit }
    ])
    tray?.setContextMenu(menu)
  }

  rebuild()
  tray.on('click', cb.onOpen)
  // Refresh the icon/menu periodically so it reflects the running state.
  setInterval(rebuild, 2000)
  return tray
}
