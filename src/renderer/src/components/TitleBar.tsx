import { useEffect, useState } from 'react'
import type { JSX } from 'react'
import type { WindowState } from '../../../shared/types.js'

export type Tab = 'timer' | 'settings'

/** macOS draws its own traffic lights over the content; we only leave room. */
const isMac = document.documentElement.dataset.platform === 'darwin'

interface Props {
  tab: Tab
  onTab: (tab: Tab) => void
  /** Hidden until there is a session — the tabs lead nowhere before sign-in. */
  showNav: boolean
}

/**
 * The window's own title bar.
 *
 * The main window is frameless (see frameOptions() in src/main/windows.ts): the
 * OS bar only ever repeated the app name, which this row already shows, so it
 * bought nothing and cost ~30px of every screen. This row takes over its jobs —
 * it is the drag handle, it double-clicks to maximize, and on Windows/Linux it
 * draws the minimize/maximize/close controls. On macOS the traffic lights still
 * float over the content, so there the row only reserves space for them.
 *
 * Everything interactive must opt out of the drag region explicitly (see
 * `-webkit-app-region` in app.css) or the platform swallows its clicks.
 */
export function TitleBar({ tab, onTab, showNav }: Props): JSX.Element {
  const controls = window.toggl?.window
  const [maximized, setMaximized] = useState(false)

  useEffect(() => {
    if (!controls) return
    void controls
      .getState()
      .then((s) => setMaximized(s.maximized))
      .catch(() => {})
    return controls.onChange((s: WindowState) => setMaximized(s.maximized))
  }, [controls])

  return (
    <header className="app__titlebar">
      <div className="app__brand">
        <span className="app__logo" aria-hidden="true">
          ⏱
        </span>
        <strong>Toggl Traction</strong>
      </div>

      {showNav && (
        <nav className="app__nav" aria-label="Primary">
          <button
            className={`tab ${tab === 'timer' ? 'tab--active' : ''}`}
            aria-current={tab === 'timer' ? 'page' : undefined}
            onClick={() => onTab('timer')}
          >
            Timer
          </button>
          <button
            className={`tab ${tab === 'settings' ? 'tab--active' : ''}`}
            aria-current={tab === 'settings' ? 'page' : undefined}
            onClick={() => onTab('settings')}
          >
            Settings
          </button>
        </nav>
      )}

      {controls && !isMac && (
        <div className="app__wincontrols">
          <button
            className="wincontrol"
            onClick={() => void controls.minimize()}
            aria-label="Minimize window"
            title="Minimize"
          >
            <MinimizeIcon />
          </button>
          <button
            className="wincontrol"
            onClick={() => void controls.toggleMaximize()}
            aria-label={maximized ? 'Restore window' : 'Maximize window'}
            title={maximized ? 'Restore' : 'Maximize'}
          >
            {maximized ? <RestoreIcon /> : <MaximizeIcon />}
          </button>
          <button
            className="wincontrol wincontrol--close"
            onClick={() => void controls.close()}
            aria-label="Close window"
            title="Close"
          >
            <CloseIcon />
          </button>
        </div>
      )}
    </header>
  )
}

/*
 * Caption glyphs, drawn on a 10x10 grid with a 1-unit stroke so they carry the
 * same weight the platform gives its own — a filled icon reads much heavier.
 */
function Glyph({ children }: { children: React.ReactNode }): JSX.Element {
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 10 10"
      fill="none"
      stroke="currentColor"
      strokeWidth="1"
      aria-hidden="true"
    >
      {children}
    </svg>
  )
}
function MinimizeIcon(): JSX.Element {
  return (
    <Glyph>
      <path d="M0 5.5h10" />
    </Glyph>
  )
}
function MaximizeIcon(): JSX.Element {
  return (
    <Glyph>
      <rect x="0.5" y="0.5" width="9" height="9" />
    </Glyph>
  )
}
function RestoreIcon(): JSX.Element {
  return (
    <Glyph>
      <rect x="0.5" y="2.5" width="7" height="7" />
      <path d="M2.5 2.5v-2h7v7h-2" />
    </Glyph>
  )
}
function CloseIcon(): JSX.Element {
  return (
    <Glyph>
      <path d="M0.5 0.5l9 9M9.5 0.5l-9 9" />
    </Glyph>
  )
}
