import { useState } from 'react'
import { useApp } from '../store/app.js'

/**
 * API-token sign-in. OAuth can be added later without changing this component's
 * contract — it just calls store.signIn.
 */
export function LoginView(): JSX.Element {
  const signIn = useApp((s) => s.signIn)
  const bridgeAvailable = useApp((s) => s.bridgeAvailable)
  const [token, setToken] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const onSubmit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault()
    setError(null)
    setBusy(true)
    try {
      await signIn(token.trim())
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign-in failed.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="login">
      <div className="card login__card">
        <h1>Toggl Traction</h1>
        <p className="muted">Sign in with your Toggl Track API token to start tracking.</p>

        {!bridgeAvailable && (
          <div className="alert alert--error" role="alert">
            This page is running in a plain browser, so it can’t reach Toggl.
            Launch the desktop app (<span className="mono">npm run dev</span>), or
            for a browser test start the dev bridge (
            <span className="mono">npm run dev:server</span>) and open this page
            with <span className="mono">?server</span>.
          </div>
        )}

        <form onSubmit={onSubmit}>
          <div className="field">
            <label htmlFor="token">API token</label>
            <input
              id="token"
              className="input"
              type="password"
              autoComplete="off"
              spellCheck={false}
              placeholder="Paste your Toggl API token"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              aria-describedby="token-hint"
              required
            />
            <span id="token-hint" className="hint">
              Find it at track.toggl.com → Profile settings → API Token.
            </span>
          </div>

          {error && (
            <div className="alert alert--error" role="alert">
              {error}
            </div>
          )}

          <button
            className="btn btn--accent login__submit"
            type="submit"
            disabled={busy || !token.trim()}
          >
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      </div>
    </main>
  )
}
