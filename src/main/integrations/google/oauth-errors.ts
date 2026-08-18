/**
 * Classification of Google OAuth token-endpoint failures, split out so it carries
 * no Electron imports and can be unit-tested under plain node.
 *
 * The distinction that matters for connection health is *permanent* vs
 * *transient*:
 *
 *  - Permanent: the stored refresh token will never work again — the user must
 *    re-consent. Google signals this with an HTTP 400 and `error: invalid_grant`
 *    (refresh token expired, revoked, or superseded). Retrying is pointless and
 *    the credential should be discarded so the UI can prompt a reconnect.
 *  - Transient: a network blip, timeout, or Google 5xx. The refresh token is
 *    almost certainly still good; keep it and retry later.
 *
 * We deliberately do NOT treat `invalid_client` / `unauthorized_client` as
 * permanent-for-the-user: those mean *this build's* OAuth client is misconfigured
 * (wrong/missing client id or secret), not that the user's grant is dead. Nuking
 * a perfectly good refresh token over a build misconfiguration would force a
 * needless reconnect the user can't complete anyway, so those stay transient.
 */

/** Google `error` codes that mean the refresh token is permanently unusable. */
const PERMANENT_ERROR_CODES = new Set(['invalid_grant'])

/** Error thrown by the token endpoint, tagged with Google's machine-readable code. */
export class OAuthTokenError extends Error {
  constructor(
    message: string,
    /** HTTP status from the token endpoint, when the request completed. */
    readonly status: number | undefined,
    /** Google's `error` field (e.g. `invalid_grant`), when present. */
    readonly code: string | undefined
  ) {
    super(message)
    this.name = 'OAuthTokenError'
  }

  /** True when re-authentication is required — the refresh token is dead. */
  get permanent(): boolean {
    return this.code !== undefined && PERMANENT_ERROR_CODES.has(this.code)
  }
}

/**
 * Should this failure force the user to reconnect? Only a genuine
 * `OAuthTokenError` flagged permanent qualifies; every other error (network,
 * timeout, generic `Error`) is treated as transient so a blip never discards a
 * still-valid credential.
 */
export function isPermanentAuthError(err: unknown): boolean {
  return err instanceof OAuthTokenError && err.permanent
}
