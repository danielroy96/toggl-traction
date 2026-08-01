import { safeStorage, app } from 'electron'
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { DEFAULT_SETTINGS, type AppSettings } from '../shared/types.js'

/**
 * Persistence layer.
 *
 * - Settings are plain JSON in userData.
 * - The Toggl API token is encrypted with Electron's `safeStorage` (OS keychain /
 *   DPAPI backed) and stored separately, so a leaked settings file never exposes
 *   the credential. If OS encryption is unavailable we refuse to persist the
 *   token rather than writing it in plaintext.
 */

let userDataDir = ''
function dir(): string {
  if (!userDataDir) {
    userDataDir = app.getPath('userData')
    if (!existsSync(userDataDir)) mkdirSync(userDataDir, { recursive: true })
  }
  return userDataDir
}

const settingsPath = (): string => join(dir(), 'settings.json')
/** Encrypted secrets live in `<name>.enc`; the Toggl token uses `token`. */
const secretPath = (name: string): string => join(dir(), `${name}.enc`)

export function loadSettings(): AppSettings {
  try {
    const raw = readFileSync(settingsPath(), 'utf-8')
    const parsed = JSON.parse(raw) as Partial<AppSettings>
    // Merge with defaults so newly-added settings keys always have a value.
    return {
      ...DEFAULT_SETTINGS,
      ...parsed,
      integrations: { ...DEFAULT_SETTINGS.integrations, ...(parsed.integrations ?? {}) }
    }
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}

export function saveSettings(settings: AppSettings): void {
  writeFileSync(settingsPath(), JSON.stringify(settings, null, 2), 'utf-8')
}

/**
 * Encrypt and persist a named secret (OAuth refresh tokens, API tokens, …).
 * Refuses to write when OS encryption is unavailable rather than leak plaintext.
 */
export function saveSecret(name: string, value: string): void {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error(
      'Secure storage is not available on this system, so the credential cannot be saved safely.'
    )
  }
  writeFileSync(secretPath(name), safeStorage.encryptString(value))
}

export function loadSecret(name: string): string | null {
  try {
    const path = secretPath(name)
    if (!existsSync(path)) return null
    if (!safeStorage.isEncryptionAvailable()) return null
    const buf = readFileSync(path)
    // A cleared secret is a zero-byte file; treat it as absent.
    if (buf.length === 0) return null
    return safeStorage.decryptString(buf)
  } catch {
    return null
  }
}

export function clearSecret(name: string): void {
  try {
    const path = secretPath(name)
    if (existsSync(path)) writeFileSync(path, Buffer.alloc(0))
  } catch {
    /* best effort */
  }
}

// The Toggl API token is just the canonical secret named "token".
export const saveToken = (token: string): void => saveSecret('token', token)
export const loadToken = (): string | null => loadSecret('token')
export const clearToken = (): void => clearSecret('token')
