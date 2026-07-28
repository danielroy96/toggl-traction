/*
 * Focused tests for the TimerManager concurrency guarantees — the logic behind
 * the "starting/stopping bugs" and double-start races. Run via:
 *   node scripts/run-tests.mjs
 * (which bundles this with esbuild first).
 */
import { TimerManager } from '../src/main/timer.js'
import type { StartTimerInput, TimeEntry } from '../src/shared/types.js'

let failures = 0
function assert(cond: boolean, msg: string): void {
  if (cond) {
    console.log(`  PASS  ${msg}`)
  } else {
    failures++
    console.log(`  FAIL  ${msg}`)
  }
}

const delay = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/** A fake Toggl client recording call order and simulating latency. */
class FakeClient {
  starts = 0
  stops = 0
  order: string[] = []
  private seq = 1
  current: TimeEntry | null = null
  latency = 20

  async getCurrentEntry(): Promise<TimeEntry | null> {
    return this.current
  }
  async startTimer(input: StartTimerInput & { workspaceId: number }): Promise<TimeEntry> {
    this.order.push('start:begin')
    await delay(this.latency)
    this.starts++
    const entry: TimeEntry = {
      id: this.seq++,
      workspace_id: input.workspaceId,
      description: input.description,
      project_id: input.projectId ?? null,
      start: new Date().toISOString(),
      stop: null,
      duration: -1
    }
    this.current = entry
    this.order.push('start:end')
    return entry
  }
  async stopTimer(_ws: number, id: number): Promise<TimeEntry> {
    this.order.push('stop:begin')
    await delay(this.latency)
    this.stops++
    const stopped: TimeEntry = {
      ...(this.current as TimeEntry),
      id,
      stop: new Date().toISOString(),
      duration: 100
    }
    this.current = null
    this.order.push('stop:end')
    return stopped
  }
}

async function run(): Promise<void> {
  console.log('== TimerManager concurrency ==')

  // 1. Double-start does not create two running entries; the first is stopped.
  {
    const fake = new FakeClient()
    const tm = new TimerManager()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    tm.attach(fake as any, 1)
    await delay(5) // let initial sync settle
    const p1 = tm.start({ description: 'A' })
    const p2 = tm.start({ description: 'B' })
    await Promise.all([p1, p2])
    assert(fake.starts === 2, 'two sequential starts issued (not dropped)')
    assert(fake.stops === 1, 'first entry auto-stopped before second start')
    // The two operations must not interleave (start:end before next start:begin).
    const interleaved =
      fake.order.indexOf('start:begin', fake.order.indexOf('start:begin') + 1) <
      fake.order.indexOf('start:end')
    assert(!interleaved, 'start operations are serialized, not interleaved')
    assert(tm.getState().running?.description === 'B', 'final running entry is the second one')
    tm.detach()
  }

  // 2. Rapid start-then-stop resolves in order and ends stopped.
  {
    const fake = new FakeClient()
    const tm = new TimerManager()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    tm.attach(fake as any, 1)
    await delay(5)
    const s = tm.start({ description: 'X' })
    const st = tm.stop()
    await Promise.all([s, st])
    assert(tm.getState().running === null, 'timer is stopped after start+stop race')
    assert(fake.stops >= 1, 'stop was actually issued')
    tm.detach()
  }

  // 3. Stopping when nothing runs is a safe no-op (no throw, no phantom stop).
  {
    const fake = new FakeClient()
    const tm = new TimerManager()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    tm.attach(fake as any, 1)
    await delay(5)
    await tm.stop()
    assert(fake.stops === 0, 'stop with no running entry issues no request')
    assert(tm.getState().error === null, 'no error surfaced for no-op stop')
    tm.detach()
  }

  // 4. pending flag is true during a mutation and false after.
  {
    const fake = new FakeClient()
    fake.latency = 40
    const tm = new TimerManager()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    tm.attach(fake as any, 1)
    await delay(5)
    const p = tm.start({ description: 'P' })
    await delay(10)
    assert(tm.getState().pending === true, 'pending is true while start is in flight')
    await p
    assert(tm.getState().pending === false, 'pending clears after start resolves')
    tm.detach()
  }

  console.log(`\n${failures === 0 ? 'All timer tests passed.' : `${failures} FAILURES`}`)
  process.exit(failures === 0 ? 0 : 1)
}

void run()
