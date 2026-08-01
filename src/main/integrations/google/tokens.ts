import { EventEmitter } from 'node:events'
import type { GoogleCalendarStatus } from '../../../shared/types.js'
import { saveSecret, loadSecret, clearSecret } from '../../store.js'
import { isConfigured } from './config.js'
import { runAuthFlow, refreshAccessToken, fetchUserEmail } from './oauth.js'

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

interface StoredCredential {
  refreshToken: string
  email?: string
}

export class GoogleCalendarManager extends EventEmitter {
  private refreshToken: string | null = null
  private email: string | undefined
  private accessToken: string | null = null
  private accessTokenExpiresAt = 0
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
      configured: isConfigured()
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
    this.refreshToken = null
    this.email = undefined
    this.accessToken = null
    this.accessTokenExpiresAt = 0
    this.refreshInFlight = null
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

    const refreshToken = this.refreshToken
    this.refreshInFlight = (async () => {
      try {
        const tokens = await refreshAccessToken(refreshToken)
        this.accessToken = tokens.accessToken
        this.accessTokenExpiresAt = tokens.expiresAt
        // Google may rotate the refresh token; keep the newest.
        if (tokens.refreshToken && tokens.refreshToken !== this.refreshToken) {
          this.refreshToken = tokens.refreshToken
          this.persist()
        }
        return tokens.accessToken
      } finally {
        this.refreshInFlight = null
      }
    })()
    return this.refreshInFlight
  }
}
