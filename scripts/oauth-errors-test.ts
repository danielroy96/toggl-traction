/*
 * Tests for OAuth token-error classification — the logic that decides whether a
 * refresh failure is permanent (discard the credential, prompt reconnect) or
 * transient (keep it, retry later). Getting this wrong is exactly what left the
 * app silently "connected" after Google killed the refresh token, so it's worth
 * pinning down. Electron-free; runs under plain node via scripts/run-tests.mjs.
 */
import {
  OAuthTokenError,
  isPermanentAuthError
} from '../src/main/integrations/google/oauth-errors.js'

let failures = 0
function assert(cond: boolean, msg: string): void {
  if (cond) {
    console.log(`  PASS  ${msg}`)
  } else {
    failures++
    console.log(`  FAIL  ${msg}`)
  }
}

// --- OAuthTokenError.permanent ------------------------------------------
assert(
  new OAuthTokenError('dead token', 400, 'invalid_grant').permanent === true,
  'invalid_grant is permanent (refresh token is dead)'
)
assert(
  new OAuthTokenError('rate limited', 429, 'rate_limit_exceeded').permanent === false,
  'a rate-limit error is transient'
)
assert(
  new OAuthTokenError('server error', 500, undefined).permanent === false,
  'a 5xx with no error code is transient'
)
assert(
  new OAuthTokenError('bad client', 401, 'invalid_client').permanent === false,
  'invalid_client is a build misconfig, not a dead user grant — transient'
)

// --- isPermanentAuthError -----------------------------------------------
assert(
  isPermanentAuthError(new OAuthTokenError('dead', 400, 'invalid_grant')) === true,
  'isPermanentAuthError is true for invalid_grant'
)
assert(
  isPermanentAuthError(new OAuthTokenError('blip', 503, undefined)) === false,
  'isPermanentAuthError is false for a transient OAuth error'
)
assert(
  isPermanentAuthError(new Error('network down')) === false,
  'a plain network Error is never treated as permanent'
)
assert(
  isPermanentAuthError('invalid_grant') === false,
  'a bare string is not a permanent auth error'
)
assert(isPermanentAuthError(undefined) === false, 'undefined is not a permanent auth error')

console.log(`\n${failures === 0 ? 'All oauth-error tests passed.' : `${failures} FAILURES`}`)
process.exit(failures === 0 ? 0 : 1)
