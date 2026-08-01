import { app } from 'electron'
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

/**
 * OAuth client credentials for the Google Calendar integration.
 *
 * These identify *the app* (not the user) and come from a Google Cloud
 * "Desktop app" OAuth client. For installed apps the client secret is not
 * treated as confidential (see Google's OAuth for native apps guidance), and
 * the flow is additionally protected with PKCE — but the token endpoint still
 * requires the secret to be sent, so we accept one when configured.
 *
 * We deliberately do not hard-code credentials into the repo. They are read,
 * in order of precedence, from:
 *   1. Environment variables GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET
 *      (handy for `npm run dev`).
 *   2. Constants baked into the bundle at build time from the build environment
 *      — this is how release installers ship working credentials (see
 *      electron.vite.config.ts and the Release workflow).
 *   3. A `google-oauth.json` file in the app's userData directory. This may be
 *      either our own `{ "clientId": "...", "clientSecret": "..." }` shape or the
 *      file Google Cloud hands you verbatim (`{ "installed": { "client_id", … } }`
 *      or the `"web"` variant), so you can just drop the download in place.
 *
 * When none is present the integration reports itself as "not configured" and
 * the Connect action is disabled with an explanatory message, rather than
 * failing at the OAuth screen.
 */
export interface OAuthConfig {
  clientId: string
  /** Optional for pure-PKCE clients; sent when present. */
  clientSecret?: string
}

let cached: OAuthConfig | null | undefined

interface GoogleNativeCredentials {
  client_id?: string
  client_secret?: string
}

function fromFile(): Partial<OAuthConfig> | null {
  try {
    const path = join(app.getPath('userData'), 'google-oauth.json')
    if (!existsSync(path)) return null
    const parsed = JSON.parse(readFileSync(path, 'utf-8')) as {
      clientId?: string
      clientSecret?: string
      installed?: GoogleNativeCredentials
      web?: GoogleNativeCredentials
    }
    // Accept Google Cloud's verbatim download ({ installed | web: { client_id … } })
    // as well as our own camelCase shape.
    const native = parsed.installed ?? parsed.web
    return {
      clientId: parsed.clientId ?? native?.client_id,
      clientSecret: parsed.clientSecret ?? native?.client_secret
    }
  } catch {
    return null
  }
}

// Build-time constants (Vite `define`); guarded so non-bundled contexts are safe.
const bakedClientId =
  typeof __GOOGLE_OAUTH_CLIENT_ID__ !== 'undefined' ? __GOOGLE_OAUTH_CLIENT_ID__ : ''
const bakedClientSecret =
  typeof __GOOGLE_OAUTH_CLIENT_SECRET__ !== 'undefined' ? __GOOGLE_OAUTH_CLIENT_SECRET__ : ''

/** Returns the configured OAuth client, or null when this build has none. */
export function loadOAuthConfig(): OAuthConfig | null {
  if (cached !== undefined) return cached

  const file = fromFile() ?? {}
  const clientId =
    process.env.GOOGLE_OAUTH_CLIENT_ID || bakedClientId || file.clientId
  const clientSecret =
    process.env.GOOGLE_OAUTH_CLIENT_SECRET || bakedClientSecret || file.clientSecret

  cached = clientId ? { clientId, clientSecret: clientSecret || undefined } : null
  return cached
}

export function isConfigured(): boolean {
  return loadOAuthConfig() !== null
}

/** Test seam: forget any cached config so env/file changes are re-read. */
export function resetOAuthConfigCache(): void {
  cached = undefined
}

/** Read-only Calendar events, plus identity for showing which account is linked. */
export const OAUTH_SCOPES = [
  'openid',
  'email',
  'https://www.googleapis.com/auth/calendar.events.readonly'
]

export const OAUTH_AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth'
export const OAUTH_TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token'
export const USERINFO_ENDPOINT = 'https://openidconnect.googleapis.com/v1/userinfo'
