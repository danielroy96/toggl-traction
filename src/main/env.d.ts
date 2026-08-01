/**
 * Build-time constants injected by Vite's `define` (see electron.vite.config.ts).
 * They hold the Google OAuth client credentials baked into release builds, and
 * are the empty string in builds where none were provided. Accessed defensively
 * via `typeof` so code that runs outside the bundled main process (e.g. tests)
 * never hits a ReferenceError.
 */
declare const __GOOGLE_OAUTH_CLIENT_ID__: string
declare const __GOOGLE_OAUTH_CLIENT_SECRET__: string
