import type { TrackingSuggestion } from '../../shared/types.js'
import type { SuggestionSource } from './index.js'
import { extractTicketRef } from './enrich.js'

/**
 * Suggests tracking based on the active editor window (e.g. IntelliJ IDEA).
 *
 * IntelliJ puts the project and often the VCS branch in the window title, and
 * branch names commonly embed a ticket ref like `feature/PROJ-123-thing`. We
 * parse that ref out and offer it as a suggestion.
 *
 * SCAFFOLD: the real implementation reads the foreground window title with a
 * cross-platform helper (recommended: the `active-win` npm package, which uses
 * the Win32 API on Windows and the Accessibility API on macOS — the latter
 * requires the user to grant Screen Recording / Accessibility permission).
 * That native dependency and its permission prompts are deferred, so for now
 * this source polls a no-op provider and emits nothing. Swap `readActiveWindow`
 * for the real call to light it up.
 */

interface ActiveWindow {
  title: string
  owner: string
}

// Deferred: replace with `active-win`. Returns null so no suggestions surface.
async function readActiveWindow(): Promise<ActiveWindow | null> {
  return null
}

const IDE_OWNERS = ['idea', 'intellij', 'webstorm', 'pycharm', 'goland', 'rider', 'code']

export class WindowDetectionSource implements SuggestionSource {
  readonly id = 'window-detection'
  private handle: ReturnType<typeof setInterval> | null = null

  constructor(private emit: (s: TrackingSuggestion[]) => void) {}

  start(): void {
    if (this.handle) return
    this.handle = setInterval(() => void this.tick(), 5000)
    void this.tick()
  }

  stop(): void {
    if (this.handle) clearInterval(this.handle)
    this.handle = null
  }

  async poll(): Promise<TrackingSuggestion[]> {
    const win = await readActiveWindow()
    if (!win) return []
    const isIde = IDE_OWNERS.some((o) => win.owner.toLowerCase().includes(o))
    if (!isIde) return []

    const ticket = extractTicketRef(win.title)
    const description = ticket ? `Work on ${ticket}` : win.title
    return [
      {
        id: `window:${ticket ?? win.title}`,
        source: 'window-detection',
        description,
        ticketRef: ticket,
        confidence: ticket ? 0.8 : 0.4
      }
    ]
  }

  private async tick(): Promise<void> {
    this.emit(await this.poll())
  }
}
