import { EventEmitter } from 'node:events'
import type { GoogleCalendarStatus } from '../../../shared/types.js'
import { saveSecret, loadSecret, clearSecret } from '../../store.js'
import { isConfigured } from './config.js'
import { runAuthFlow, refreshAccessToken, fetchUserEmail } from './oauth.js'
import { isPermanentAuthError } from './oauth-errors.js'

/**
 * Owns the Google Calendar connection: the persisted refresh token, a cached
 * access token, and the "connected / configured" status the UI renders. This is
 * the single object both the AppController (connect/disconnect) and the
 * suggestion source (getAccessToken) talk to, so connection state has one home.
 *
 * The refresh token is the durable credential and is stored encrypted via the
 * shared secret store, exactly like the Toggl API token. Access tokens are
 * short-lived and kept only in memory.
 */

const SECRET_NAME = 'google-calendar'

/** Transient refresh failures get a few quick retries before the poll gives up. */
const REFRESH_MAX_ATTEMPTS = 3
const REFRESH_BACKOFF_MS = [500, 1500]

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

interface StoredCredential {
  refreshToken: string
  email?: string
}

export class GoogleCalendarManager extends EventEmitter {
  private refreshToken: string | null = null
  private email: string | undefined
  private accessToken: string | null = null
  private accessTokenExpiresAt = 0
  /**
   * Set when Google has permanently rejected the stored refresh token
   * (invalid_grant): the credential has been discarded and the user must
   * reconnect. Distinguishes "never connected" from "connection went stale" so
   * the UI can prompt a reconnect instead of silently showing nothing.
   */
  private needsReauth = false
  /**
   * Bumped on every connect/disconnect. A refresh captures the epoch it started
   * under and abandons its result if the connection was reset underneath it, so
   * a late-resolving refresh can never resurrect a disconnected account or clobber
   * a freshly reconnected one.
   */
  private connectionEpoch = 0
  /** De-dupes concurrent refreshes so a burst of polls makes one token call. */
  private refreshInFlight: Promise<string> | null = null

  constructor() {
    super()
    const raw = loadSecret(SECRET_NAME)
    if (raw) {
      try {
        const parsed = JSON.parse(raw) as StoredCredential
        this.refreshToken = parsed.refreshToken || null
        this.email = parsed.email
      } catch {
        // Legacy/plain value: treat the whole string as the refresh token.
        this.refreshToken = raw
      }
    }
  }

  isConnected(): boolean {
    return this.refreshToken !== null
  }

  getStatus(): GoogleCalendarStatus {
    return {
      connected: this.isConnected(),
      email: this.email,
      configured: isConfigured(),
      needsReauth: this.needsReauth
    }
  }

  private persist(): void {
    if (!this.refreshToken) {
      clearSecret(SECRET_NAME)
      return
    }
    const cred: StoredCredential = { refreshToken: this.refreshToken, email: this.email }
    saveSecret(SECRET_NAME, JSON.stringify(cred))
  }

  private emitStatus(): void {
    this.emit('status', this.getStatus())
  }

  /** Run the interactive OAuth consent flow and persist the result. */
  async connect(): Promise<GoogleCalendarStatus> {
    const tokens = await runAuthFlow()
    if (!tokens.refreshToken) {
      throw new Error(
        'Google did not return a refresh token. Remove the app from your Google account permissions and try connecting again.'
      )
    }
    // A fresh consent supersedes any in-flight refresh of the old credential.
    this.connectionEpoch++
    this.refreshInFlight = null
    this.needsReauth = false
    this.refreshToken = tokens.refreshToken
    this.accessToken = tokens.accessToken
    this.accessTokenExpiresAt = tokens.expiresAt
    this.email = await fetchUserEmail(tokens.accessToken)
    this.persist()
    this.emitStatus()
    return this.getStatus()
  }

  /** Forget the stored credential and drop any cached access token. */
  disconnect(): void {
    this.connectionEpoch++
    this.refreshToken = null
    this.email = undefined
    this.accessToken = null
    this.accessTokenExpiresAt = 0
    this.needsReauth = false
    this.refreshInFlight = null
    this.persist()
    this.emitStatus()
  }

  /**
   * Google has permanently rejected the refresh token. Discard the dead
   * credential and flip into the "needs reconnect" state so the UI stops showing
   * a healthy connection. Guarded by epoch: if the user already disconnected or
   * reconnected while the failing refresh was in flight, we leave their current
   * state untouched.
   */
  private markReauthRequired(epoch: number): void {
    if (epoch !== this.connectionEpoch) return
    this.refreshToken = null
    this.email = undefined
    this.accessToken = null
    this.accessTokenExpiresAt = 0
    this.needsReauth = true
    this.persist()
    this.emitStatus()
  }

  /**
   * Return a valid access token, refreshing (once, shared) when the cached one
   * is missing or about to expire. Throws if the account isn't connected.
   */
  async getAccessToken(): Promise<string> {
    if (!this.refreshToken) throw new Error('Google Calendar is not connected.')
    if (this.accessToken && Date.now() < this.accessTokenExpiresAt) {
      return this.accessToken
    }
    if (this.refreshInFlight) return this.refreshInFlight

    const epoch = this.connectionEpoch
    const refreshToken = this.refreshToken
    this.refreshInFlight = (async () => {
      try {
        const tokens = await this.refreshWithRetry(refreshToken)
        // If the account was disconnected/reconnected mid-refresh, this result is
        // stale — drop it rather than write it over the current state.
        if (epoch !== this.connectionEpoch) {
          throw new Error('Google Calendar connection changed during refresh.')
        }
        this.accessToken = tokens.accessToken
        this.accessTokenExpiresAt = tokens.expiresAt
        this.needsReauth = false
        // Google may rotate the refresh token; keep the newest.
        if (tokens.refreshToken && tokens.refreshToken !== this.refreshToken) {
          this.refreshToken = tokens.refreshToken
          this.persist()
        }
        return tokens.accessToken
      } catch (err) {
        // A dead refresh token never recovers: discard it and ask the user to
        // reconnect, rather than retrying invalid_grant forever while the UI
        // still claims to be connected.
        if (isPermanentAuthError(err)) this.markReauthRequired(epoch)
        throw err
      } finally {
        this.refreshInFlight = null
      }
    })()
    return this.refreshInFlight
  }

  /**
   * Exchange the refresh token for an access token, retrying transient failures
   * (network blips, timeouts, Google 5xx) with a short backoff. A permanent
   * failure (invalid_grant) is thrown immediately — retrying it is pointless.
   */
  private async refreshWithRetry(
    refreshToken: string
  ): Promise<Awaited<ReturnType<typeof refreshAccessToken>>> {
    let lastErr: unknown
    for (let attempt = 0; attempt < REFRESH_MAX_ATTEMPTS; attempt++) {
      try {
        return await refreshAccessToken(refreshToken)
      } catch (err) {
        lastErr = err
        if (isPermanentAuthError(err)) throw err
        const backoff = REFRESH_BACKOFF_MS[attempt]
        // Stop early if the connection was reset while we were waiting/retrying.
        if (backoff === undefined || this.refreshToken !== refreshToken) break
        await sleep(backoff)
      }
    }
    throw lastErr
  }
}
