import { useApp } from '../store/app.js'
import type { AppSettings } from '../../../shared/types.js'

const FONT_SCALES: { label: string; value: AppSettings['fontScale'] }[] = [
  { label: 'Follow system (recommended)', value: 'system' },
  { label: '100%', value: 1 },
  { label: '125%', value: 1.25 },
  { label: '150%', value: 1.5 },
  { label: '175%', value: 1.75 },
  { label: '200%', value: 2 }
]

const THEMES: { label: string; value: AppSettings['theme'] }[] = [
  { label: 'Follow system', value: 'system' },
  { label: 'Dark', value: 'dark' },
  { label: 'Light', value: 'light' },
  { label: 'High contrast', value: 'high-contrast' }
]

export function SettingsView(): JSX.Element {
  const { settings, updateSettings, signOut, session } = useApp()
  if (!settings) return <p>Loading…</p>

  const setIntegration = (
    key: keyof AppSettings['integrations'],
    value: boolean
  ): void => {
    void updateSettings({ integrations: { ...settings.integrations, [key]: value } })
  }

  return (
    <div className="settings">
      <section className="card">
        <h2>Appearance &amp; accessibility</h2>

        <div className="field">
          <label htmlFor="fontScale">Text size</label>
          <select
            id="fontScale"
            className="select"
            value={String(settings.fontScale)}
            onChange={(e) =>
              void updateSettings({
                fontScale:
                  e.target.value === 'system' ? 'system' : Number(e.target.value)
              })
            }
          >
            {FONT_SCALES.map((f) => (
              <option key={String(f.value)} value={String(f.value)}>
                {f.label}
              </option>
            ))}
          </select>
          <span className="hint">
            “Follow system” uses your OS accessibility text-size setting. Larger
            values scale the entire interface.
          </span>
        </div>

        <div className="field">
          <label htmlFor="theme">Theme</label>
          <select
            id="theme"
            className="select"
            value={settings.theme}
            onChange={(e) =>
              void updateSettings({ theme: e.target.value as AppSettings['theme'] })
            }
          >
            {THEMES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
          <span className="hint">All themes meet WCAG 2.1 AA colour contrast.</span>
        </div>
      </section>

      <section className="card">
        <h2>Mini timer</h2>
        <Toggle
          label="Show the always-on-top mini timer"
          checked={settings.miniTimerEnabled}
          onChange={(v) => void updateSettings({ miniTimerEnabled: v })}
        />
        <Toggle
          label="Keep the mini timer visible even when stopped"
          checked={settings.miniTimerAlwaysVisible}
          onChange={(v) => void updateSettings({ miniTimerAlwaysVisible: v })}
        />
      </section>

      <section className="card">
        <h2>Startup</h2>
        <Toggle
          label="Launch Toggl Traction at login"
          checked={settings.launchAtLogin}
          onChange={(v) => void updateSettings({ launchAtLogin: v })}
        />
      </section>

      <section className="card">
        <h2>Integrations</h2>
        <p className="hint">
          These sources suggest entries automatically. They are scaffolded in
          this build — enabling them wires the pipeline; connecting real
          accounts is the next step.
        </p>
        <Toggle
          label="IDE window detection (IntelliJ branch / ticket refs)"
          checked={settings.integrations.windowDetection}
          onChange={(v) => setIntegration('windowDetection', v)}
        />
        <Toggle
          label="Jira issues assigned to me"
          checked={settings.integrations.jira}
          onChange={(v) => setIntegration('jira', v)}
        />
        <Toggle
          label="Google Calendar meetings"
          checked={settings.integrations.googleCalendar}
          onChange={(v) => setIntegration('googleCalendar', v)}
        />
      </section>

      <section className="card">
        <h2>Account</h2>
        {session && (
          <p className="muted">
            Signed in as {session.user.fullname} ({session.user.email}).
          </p>
        )}
        <button className="btn btn--danger" onClick={() => void signOut()}>
          Sign out
        </button>
      </section>
    </div>
  )
}

interface ToggleProps {
  label: string
  checked: boolean
  onChange: (v: boolean) => void
}

/** A large, keyboard-accessible switch built on a native checkbox. */
function Toggle({ label, checked, onChange }: ToggleProps): JSX.Element {
  return (
    <label className="toggle">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className="toggle__track" aria-hidden="true">
        <span className="toggle__thumb" />
      </span>
      <span className="toggle__label">{label}</span>
    </label>
  )
}
