import { EventEmitter } from 'node:events'
import { TogglClient, TogglError } from './toggl/client.js'
import type { StartTimerInput, TimeEntry, TimerState } from '../shared/types.js'

/**
 * Owns the running-timer state for the whole app.
 *
 * Both the main window and the always-on-top mini window read from and write to
 * this one object, so they can never disagree about whether a timer is running.
 *
 * Concurrency is the source of most "start/stop" bugs, so every mutating call is
 * funnelled through a single-slot queue: while one start/stop/toggle is in
 * flight, further calls await it instead of firing overlapping requests. This
 * makes a double-click on "Start" a no-op rather than two entries, and a
 * stop-during-start resolve in order.
 */
export class TimerManager extends EventEmitter {
  private state: TimerState = {
    running: null,
    pending: false,
    error: null,
    lastSyncedAt: null
  }

  private client: TogglClient | null = null
  private activeWorkspaceId: number | null = null
  private pollHandle: ReturnType<typeof setInterval> | null = null

  /** Serialises mutating operations so start/stop can never overlap. */
  private mutation: Promise<unknown> = Promise.resolve()

  getState(): TimerState {
    return { ...this.state }
  }

  private setState(patch: Partial<TimerState>): void {
    this.state = { ...this.state, ...patch }
    this.emit('change', this.getState())
  }

  /** Attach an authenticated client and begin background reconciliation. */
  attach(client: TogglClient, workspaceId: number): void {
    this.client = client
    this.activeWorkspaceId = workspaceId
    this.startPolling()
    void this.sync()
  }

  detach(): void {
    this.stopPolling()
    this.client = null
    this.activeWorkspaceId = null
    this.state = { running: null, pending: false, error: null, lastSyncedAt: null }
    this.emit('change', this.getState())
  }

  setWorkspace(workspaceId: number): void {
    this.activeWorkspaceId = workspaceId
  }

  private startPolling(): void {
    this.stopPolling()
    // Reconcile with Toggl periodically so entries started/stopped on other
    // devices (web, mobile) are reflected here. Skipped while a mutation is in
    // flight to avoid clobbering optimistic state.
    this.pollHandle = setInterval(() => {
      if (!this.state.pending) void this.sync()
    }, 30_000)
  }

  private stopPolling(): void {
    if (this.pollHandle) clearInterval(this.pollHandle)
    this.pollHandle = null
  }

  /** Pull the authoritative current entry from Toggl. */
  async sync(): Promise<void> {
    if (!this.client) return
    try {
      const current = await this.client.getCurrentEntry()
      // Don't overwrite an in-flight optimistic change.
      if (this.state.pending) return
      this.setState({
        running: current ?? null,
        error: null,
        lastSyncedAt: Date.now()
      })
    } catch (err) {
      this.setState({ error: describe(err) })
    }
  }

  /** Enqueue a mutation so only one runs at a time. */
  private enqueue<T>(op: () => Promise<T>): Promise<T> {
    const run = this.mutation.then(op, op)
    // Keep the chain alive even if this op rejects.
    this.mutation = run.then(
      () => undefined,
      () => undefined
    )
    return run
  }

  async start(input: StartTimerInput): Promise<TimeEntry> {
    return this.enqueue(async () => {
      if (!this.client || this.activeWorkspaceId == null) {
        throw new TogglError('Not signed in.')
      }
      const workspaceId = input.workspaceId ?? this.activeWorkspaceId
      this.setState({ pending: true, error: null })
      try {
        // If something is already running, stop it first so we never end up with
        // two concurrent running entries.
        if (this.state.running) {
          await this.client.stopTimer(this.state.running.workspace_id, this.state.running.id)
        }
        const entry = await this.client.startTimer({ ...input, workspaceId })
        this.setState({ running: entry, pending: false, lastSyncedAt: Date.now() })
        return entry
      } catch (err) {
        this.setState({ pending: false, error: describe(err) })
        // Re-sync so the UI recovers to the true server state after a failure.
        void this.sync()
        throw err
      }
    })
  }

  async stop(): Promise<void> {
    return this.enqueue(async () => {
      if (!this.client) throw new TogglError('Not signed in.')
      const running = this.state.running
      if (!running) {
        // Nothing to stop — treat as success and reconcile.
        void this.sync()
        return
      }
      this.setState({ pending: true, error: null })
      try {
        await this.client.stopTimer(running.workspace_id, running.id)
        this.setState({ running: null, pending: false, lastSyncedAt: Date.now() })
      } catch (err) {
        this.setState({ pending: false, error: describe(err) })
        void this.sync()
        throw err
      }
    })
  }

  /** Start if stopped, stop if running. Used by the mini timer & global toggle. */
  async toggle(input?: StartTimerInput): Promise<void> {
    if (this.state.running) {
      await this.stop()
    } else {
      await this.start(input ?? { description: '' })
    }
  }
}

function describe(err: unknown): string {
  if (err instanceof TogglError) return err.message
  if (err instanceof Error) return err.message
  return 'Something went wrong.'
}
