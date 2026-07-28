import { useEffect, useState } from 'react'
import { useApp } from './store/app.js'
import { useAppearance } from './lib/useAppearance.js'
import { LoginView } from './components/LoginView.js'
import { TimerBar } from './components/TimerBar.js'
import { EntryList } from './components/EntryList.js'
import { SuggestionsPanel } from './components/SuggestionsPanel.js'
import { SettingsView } from './components/SettingsView.js'

type Tab = 'timer' | 'settings'

export function App(): JSX.Element {
  const { ready, session, settings, init, timer, toast, setToast } = useApp()
  const [tab, setTab] = useState<Tab>('timer')

  useEffect(() => {
    void init()
  }, [])

  useAppearance(settings)

  // Auto-dismiss transient toasts.
  useEffect(() => {
    if (!toast) return
    const id = setTimeout(() => setToast(null), 6000)
    return () => clearTimeout(id)
  }, [toast])

  if (!ready) {
    return (
      <div className="splash" role="status" aria-live="polite">
        Loading…
      </div>
    )
  }

  if (!session) return <LoginView />

  return (
    <div className="app">
      <a href="#main-content" className="skip-link">
        Skip to main content
      </a>

      <header className="app__header">
        <div className="app__brand">
          <span className="app__logo" aria-hidden="true">
            ⏱
          </span>
          <strong>Toggl Traction</strong>
        </div>
        <nav className="app__nav" aria-label="Primary">
          <button
            className={`tab ${tab === 'timer' ? 'tab--active' : ''}`}
            aria-current={tab === 'timer' ? 'page' : undefined}
            onClick={() => setTab('timer')}
          >
            Timer
          </button>
          <button
            className={`tab ${tab === 'settings' ? 'tab--active' : ''}`}
            aria-current={tab === 'settings' ? 'page' : undefined}
            onClick={() => setTab('settings')}
          >
            Settings
          </button>
        </nav>
      </header>

      {(timer.error || toast) && (
        <div className="app__alerts">
          {timer.error && (
            <div className="alert alert--error" role="alert">
              {timer.error}
            </div>
          )}
          {toast && (
            <div className="alert alert--error" role="alert">
              {toast}
            </div>
          )}
        </div>
      )}

      <main id="main-content" className="app__main">
        {tab === 'timer' ? (
          <>
            <TimerBar />
            <div className="app__columns">
              <div className="app__entries">
                <h2>Recent entries</h2>
                <EntryList />
              </div>
              <aside className="app__aside">
                <SuggestionsPanel />
              </aside>
            </div>
          </>
        ) : (
          <SettingsView />
        )}
      </main>
    </div>
  )
}
