import { shell } from 'electron'
import { createServer, type Server } from 'node:http'
import { createHash, randomBytes } from 'node:crypto'
import type { AddressInfo } from 'node:net'
import {
  loadOAuthConfig,
  OAUTH_AUTH_ENDPOINT,
  OAUTH_TOKEN_ENDPOINT,
  OAUTH_SCOPES,
  USERINFO_ENDPOINT,
  type OAuthConfig
} from './config.js'

/**
 * Google OAuth 2.0 for the desktop app, using the loopback-redirect + PKCE
 * "installed application" flow (RFC 8252):
 *
 *   1. Generate a PKCE verifier/challenge and a random state.
 *   2. Start a throwaway HTTP server on 127.0.0.1:<random port> to catch the
 *      redirect, and open the consent screen in the user's real browser.
 *   3. Google redirects back with `code`; we verify `state`, then exchange the
 *      code (with the verifier) for access + refresh tokens.
 *
 * Nothing here persists anything — the caller owns storage. All functions throw
 * on failure with user-facing messages.
 */

export interface TokenResponse {
  accessToken: string
  refreshToken?: string
  /** Epoch ms at which the access token expires. */
  expiresAt: number
  scope?: string
}

const base64url = (buf: Buffer): string =>
  buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

function pkcePair(): { verifier: string; challenge: string } {
  const verifier = base64url(randomBytes(32))
  const challenge = base64url(createHash('sha256').update(verifier).digest())
  return { verifier, challenge }
}

const AUTH_TIMEOUT_MS = 5 * 60 * 1000

/** Minimal HTML shown in the browser tab once the redirect is received. */
function resultPage(message: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>Toggl Traction</title>
<style>body{font:16px system-ui,sans-serif;margin:0;display:grid;place-items:center;height:100vh;background:#111;color:#eee}
.card{max-width:28rem;padding:2rem;text-align:center}</style></head>
<body><div class="card"><h1>Toggl Traction</h1><p>${message}</p>
<p>You can close this tab and return to the app.</p></div></body></html>`
}

interface RedirectResult {
  code: string
  redirectUri: string
}

/**
 * Start the loopback server, open the consent screen, and resolve with the
 * authorization code once Google redirects back. Rejects on timeout, denial, or
 * a state mismatch. Always tears the server down.
 */
function awaitRedirect(
  authUrlFor: (redirectUri: string) => string,
  expectedState: string
): Promise<RedirectResult> {
  return new Promise<RedirectResult>((resolve, reject) => {
    let settled = false
    const server: Server = createServer((req, res) => {
      // Ignore favicon and any stray requests; only the redirect carries a query.
      const url = new URL(req.url ?? '/', 'http://127.0.0.1')
      if (!url.searchParams.has('code') && !url.searchParams.has('error')) {
        res.writeHead(204).end()
        return
      }
      const err = url.searchParams.get('error')
      const code = url.searchParams.get('code')
      const state = url.searchParams.get('state')

      const reply = (status: number, message: string): void => {
        res.writeHead(status, { 'Content-Type': 'text/html' })
        res.end(resultPage(message))
      }
      const fail = (userMsg: string, errMsg: string): void => {
        reply(400, userMsg)
        rejectOnce(new Error(errMsg))
      }

      if (err) return fail('Authorization was cancelled.', `Authorization error: ${err}`)
      if (state !== expectedState)
        return fail('Security check failed. Please try again.', 'OAuth state mismatch — authorization aborted.')
      if (!code)
        return fail('No authorization code was returned.', 'No authorization code was returned.')

      reply(200, 'Google Calendar connected.')
      resolveOnce({ code, redirectUri })
    })

    let redirectUri = ''
    let timer: ReturnType<typeof setTimeout>

    const cleanup = (): void => {
      clearTimeout(timer)
      server.close()
    }
    const resolveOnce = (r: RedirectResult): void => {
      if (settled) return
      settled = true
      cleanup()
      resolve(r)
    }
    const rejectOnce = (e: Error): void => {
      if (settled) return
      settled = true
      cleanup()
      reject(e)
    }

    server.on('error', (e) => rejectOnce(e instanceof Error ? e : new Error(String(e))))

    // Bind to an ephemeral port on the loopback interface only.
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo
      redirectUri = `http://127.0.0.1:${port}`
      timer = setTimeout(
        () => rejectOnce(new Error('Timed out waiting for Google authorization.')),
        AUTH_TIMEOUT_MS
      )
      void shell.openExternal(authUrlFor(redirectUri))
    })
  })
}

function buildAuthUrl(
  cfg: OAuthConfig,
  redirectUri: string,
  challenge: string,
  state: string
): string {
  const p = new URLSearchParams({
    client_id: cfg.clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: OAUTH_SCOPES.join(' '),
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state,
    access_type: 'offline',
    // Force a refresh token even on re-consent.
    prompt: 'consent'
  })
  return `${OAUTH_AUTH_ENDPOINT}?${p.toString()}`
}

async function postToken(body: URLSearchParams): Promise<TokenResponse> {
  const requestedAt = Date.now()
  const res = await fetch(OAUTH_TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString()
  })
  const text = await res.text()
  if (!res.ok) {
    let detail = text.slice(0, 200)
    try {
      const j = JSON.parse(text) as { error_description?: string; error?: string }
      detail = j.error_description ?? j.error ?? detail
    } catch {
      /* keep raw text */
    }
    throw new Error(`Google token request failed (${res.status}): ${detail}`)
  }
  const json = JSON.parse(text) as {
    access_token: string
    refresh_token?: string
    expires_in: number
    scope?: string
  }
  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token,
    // Renew a minute early to avoid using a token that expires mid-request.
    expiresAt: requestedAt + (json.expires_in - 60) * 1000,
    scope: json.scope
  }
}

/** Run the full interactive consent flow and return the token set. */
export async function runAuthFlow(): Promise<TokenResponse> {
  const cfg = loadOAuthConfig()
  if (!cfg) {
    throw new Error(
      'Google Calendar is not configured in this build. Set GOOGLE_OAUTH_CLIENT_ID to enable it.'
    )
  }
  const { verifier, challenge } = pkcePair()
  const state = base64url(randomBytes(16))

  const { code, redirectUri } = await awaitRedirect(
    (uri) => buildAuthUrl(cfg, uri, challenge, state),
    state
  )

  const body = new URLSearchParams({
    client_id: cfg.clientId,
    code,
    code_verifier: verifier,
    grant_type: 'authorization_code',
    redirect_uri: redirectUri
  })
  if (cfg.clientSecret) body.set('client_secret', cfg.clientSecret)
  return postToken(body)
}

/** Exchange a stored refresh token for a fresh access token. */
export async function refreshAccessToken(refreshToken: string): Promise<TokenResponse> {
  const cfg = loadOAuthConfig()
  if (!cfg) throw new Error('Google Calendar is not configured in this build.')
  const body = new URLSearchParams({
    client_id: cfg.clientId,
    refresh_token: refreshToken,
    grant_type: 'refresh_token'
  })
  if (cfg.clientSecret) body.set('client_secret', cfg.clientSecret)
  const tokens = await postToken(body)
  // Refresh responses omit the refresh token; keep the caller's existing one.
  return { ...tokens, refreshToken: tokens.refreshToken ?? refreshToken }
}

/** Look up the signed-in account's email for display. Best-effort. */
export async function fetchUserEmail(accessToken: string): Promise<string | undefined> {
  try {
    const res = await fetch(USERINFO_ENDPOINT, {
      headers: { Authorization: `Bearer ${accessToken}` }
    })
    if (!res.ok) return undefined
    const json = (await res.json()) as { email?: string }
    return json.email
  } catch {
    return undefined
  }
}
