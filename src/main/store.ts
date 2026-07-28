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
const tokenPath = (): string => join(dir(), 'token.enc')

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

export function saveToken(token: string): void {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error(
      'Secure storage is not available on this system, so the API token cannot be saved safely.'
    )
  }
  const encrypted = safeStorage.encryptString(token)
  writeFileSync(tokenPath(), encrypted)
}

export function loadToken(): string | null {
  try {
    if (!existsSync(tokenPath())) return null
    if (!safeStorage.isEncryptionAvailable()) return null
    const buf = readFileSync(tokenPath())
    return safeStorage.decryptString(buf)
  } catch {
    return null
  }
}

export function clearToken(): void {
  try {
    if (existsSync(tokenPath())) writeFileSync(tokenPath(), Buffer.alloc(0))
  } catch {
    /* best effort */
  }
}
