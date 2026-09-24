import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createRefreshThrottle,
  LIVE_GATHER_MS,
  LIVE_MIN_INTERVAL_MS,
  type RefreshScope,
} from '@/app/(app)/calendar/_components/live-refresh'

describe('calendar live reload throttle (NEXT-03)', () => {
  let runs: RefreshScope[]
  let hidden: boolean

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-23T17:00:00Z'))
    runs = []
    hidden = false
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  function throttle() {
    return createRefreshThrottle({ run: (scope) => runs.push(scope), isHidden: () => hidden })
  }

  it('waits at least 3 s between reloads and 10 s after one for other members’ posts', () => {
    expect(LIVE_MIN_INTERVAL_MS.all).toBeGreaterThanOrEqual(3_000)
    expect(LIVE_MIN_INTERVAL_MS.open).toBeGreaterThanOrEqual(LIVE_MIN_INTERVAL_MS.all)
  })

  it('merges a burst into one reload, and my own change wins over an open-shift change', () => {
    const t = throttle()
    t.request('open')
    t.request('all')
    t.request('open')
    vi.advanceTimersByTime(LIVE_GATHER_MS)
    expect(runs).toEqual(['all'])
    vi.advanceTimersByTime(60_000)
    expect(runs).toEqual(['all'])
  })

  it('spaces reloads out and runs the waiting one when its gap is over', () => {
    const t = throttle()
    t.request('all')
    vi.advanceTimersByTime(LIVE_GATHER_MS)
    expect(runs).toEqual(['all'])

    // Department-wide change right after: waits 10 s from the last reload.
    t.request('open')
    vi.advanceTimersByTime(LIVE_MIN_INTERVAL_MS.open - 1)
    expect(runs).toEqual(['all'])
    vi.advanceTimersByTime(1)
    expect(runs).toEqual(['all', 'open'])

    // My own change: 3 s after the last reload.
    t.request('all')
    vi.advanceTimersByTime(LIVE_MIN_INTERVAL_MS.all - 1)
    expect(runs).toEqual(['all', 'open'])
    vi.advanceTimersByTime(1)
    expect(runs).toEqual(['all', 'open', 'all'])
  })

  it('brings a waiting reload forward when my own change arrives', () => {
    const t = throttle()
    t.request('open')
    vi.advanceTimersByTime(LIVE_GATHER_MS)
    t.request('open') // would wait 10 s from the last reload
    vi.advanceTimersByTime(1_000)
    t.request('all') // only needs 3 s from the last reload
    vi.advanceTimersByTime(LIVE_MIN_INTERVAL_MS.all - 1_000 - 1)
    expect(runs).toEqual(['open'])
    vi.advanceTimersByTime(1)
    expect(runs).toEqual(['open', 'all'])
    vi.advanceTimersByTime(60_000)
    expect(runs).toEqual(['open', 'all'])
  })

  it('does nothing while the app is hidden and catches up on resume', () => {
    const t = throttle()
    hidden = true
    t.request('open')
    t.request('all')
    vi.advanceTimersByTime(60_000)
    expect(runs).toEqual([])
    hidden = false
    t.resume()
    vi.advanceTimersByTime(LIVE_GATHER_MS)
    expect(runs).toEqual(['all'])
    t.resume()
    vi.advanceTimersByTime(60_000)
    expect(runs).toEqual(['all'])
  })

  it('stops after dispose', () => {
    const t = throttle()
    t.request('all')
    t.dispose()
    t.request('all')
    vi.advanceTimersByTime(60_000)
    expect(runs).toEqual([])
  })
})
