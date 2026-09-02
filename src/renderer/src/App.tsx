import { useEffect, useState } from 'react'
import type { JSX } from 'react'
import { useApp } from './store/app.js'
import { useAppearance } from './lib/useAppearance.js'
import { LoginView } from './components/LoginView.js'
import { TitleBar, type Tab } from './components/TitleBar.js'
import { TimerBar } from './components/TimerBar.js'
import { EntryList } from './components/EntryList.js'
import { SuggestionsPanel } from './components/SuggestionsPanel.js'
import { SettingsView } from './components/SettingsView.js'

/**
 * The main window's shell: its own title bar (the window is frameless), the
 * timer bar, and one scrolling region below it.
 *
 * Only that region scrolls. The timer bar is the one control you always want
 * reachable, and pinning it means the entry list gets the whole remaining
 * height to itself instead of sharing one page-length scroll with it.
 */
export function App(): JSX.Element {
  const { ready, session, settings, init, timer, toast, setToast, suggestions } = useApp()
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

  // The suggestions column is only worth 20rem of the window when it actually
  // has something to offer: its "enable an integration" hint belongs in
  // Settings, which is where you would act on it, not permanently alongside
  // the entries it is squeezing.
  const hasSuggestions = suggestions.length > 0

  return (
    <div className="app">
      <a href="#main-content" className="skip-link">
        Skip to main content
      </a>

      <TitleBar tab={tab} onTab={setTab} showNav={ready && !!session} />

      {!ready ? (
        <div className="splash" role="status" aria-live="polite">
          Loading…
        </div>
      ) : !session ? (
        <LoginView />
      ) : (
        <>
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
                <div className="app__scroll">
                  <div className={`app__columns ${hasSuggestions ? 'app__columns--aside' : ''}`}>
                    <section className="app__entries" aria-label="Recent entries">
                      <h2 className="section-label">Recent entries</h2>
                      <EntryList />
                    </section>
                    {hasSuggestions && (
                      <aside className="app__aside">
                        <SuggestionsPanel />
                      </aside>
                    )}
                  </div>
                </div>
              </>
            ) : (
              <div className="app__scroll">
                <SettingsView />
              </div>
            )}
          </main>
        </>
      )}
    </div>
  )
}
