import { EventEmitter } from 'node:events'
import type { AppSettings, TrackingSuggestion } from '../../shared/types.js'
import { WindowDetectionSource } from './window-detect.js'
import { JiraSource } from './jira.js'
import { GoogleCalendarSource } from './calendar.js'
import { GoogleCalendarManager } from './google/tokens.js'

/**
 * A source that can propose time-tracking entries (e.g. the active IntelliJ
 * window, an assigned Jira ticket, or an upcoming calendar meeting).
 *
 * Sources are intentionally decoupled: each one is enabled/disabled
 * independently via settings, and emits suggestions through the shared engine.
 * The concrete data-gathering for each is stubbed for this iteration — the
 * interfaces and wiring are real so the features can be filled in without
 * touching the rest of the app.
 */
export interface SuggestionSource {
  readonly id: string
  start(): void
  stop(): void
  /** Produce the current set of suggestions on demand. */
  poll(): Promise<TrackingSuggestion[]>
}

export class SuggestionEngine extends EventEmitter {
  private sources: SuggestionSource[]
  private latest = new Map<string, TrackingSuggestion[]>()
  /** Owns the Google Calendar OAuth connection; exposed for connect/disconnect. */
  readonly googleCalendar = new GoogleCalendarManager()

  constructor() {
    super()
    this.sources = [
      new WindowDetectionSource((s) => this.ingest('window-detection', s)),
      new JiraSource((s) => this.ingest('jira', s)),
      new GoogleCalendarSource((s) => this.ingest('google-calendar', s), this.googleCalendar)
    ]
  }

  /** Re-poll a single source on demand (e.g. right after connecting an account). */
  async refreshSource(id: string): Promise<void> {
    const source = this.sources.find((s) => s.id === id)
    if (!source) return
    this.ingest(id, await source.poll())
  }

  private ingest(sourceId: string, suggestions: TrackingSuggestion[]): void {
    this.latest.set(sourceId, suggestions)
    this.emit('change', this.getSuggestions())
  }

  getSuggestions(): TrackingSuggestion[] {
    return [...this.latest.values()]
      .flat()
      .sort((a, b) => b.confidence - a.confidence)
  }

  /** Turn sources on/off to match the user's settings. */
  applySettings(settings: AppSettings): void {
    const map: Record<string, boolean> = {
      'window-detection': settings.integrations.windowDetection,
      jira: settings.integrations.jira,
      'google-calendar': settings.integrations.googleCalendar
    }
    for (const source of this.sources) {
      const enabled = map[source.id] ?? false
      if (enabled) source.start()
      else {
        source.stop()
        this.latest.delete(source.id)
      }
    }
    this.emit('change', this.getSuggestions())
  }

  stopAll(): void {
    for (const s of this.sources) s.stop()
  }
}
