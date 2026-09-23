// Throttle for realtime-driven reloads of the Calendar (NEXT-03). Realtime
// events only say "something changed", so each one costs a refetch; with a
// whole department watching, a busy trade day would otherwise set off a
// refetch storm. This module decides when a reload actually runs:
//
//   - requests arriving close together are merged into one reload;
//   - 'all' (my own shifts or requests changed) beats 'open' (only the open
//     shifts behind the blue counts, i.e. someone else's post changed);
//   - reloads keep a minimum gap, longer for 'open' than for 'all';
//   - nothing runs while the page is hidden: the request waits for resume().
//
// Plain timers, no React, so it is unit-tested with fake timers
// (tests/unit/calendar-live-refresh.test.ts).

export type RefreshScope = 'open' | 'all'

/** Least time between two live reloads (ms): my own changes, and everyone else's posts. */
export const LIVE_MIN_INTERVAL_MS: Readonly<Record<RefreshScope, number>> = Object.freeze({
  all: 3_000,
  open: 10_000,
})

/** Requests this close together become one reload (ms). */
export const LIVE_GATHER_MS = 250

export interface RefreshThrottleOptions {
  run: (scope: RefreshScope) => void
  /** Least time from the previous reload (of either scope) before a reload of this scope. */
  minIntervalMs?: Readonly<Record<RefreshScope, number>>
  gatherMs?: number
  /** True while the page is hidden; a due reload then waits for resume(). */
  isHidden?: () => boolean
}

export interface RefreshThrottle {
  /** Ask for a reload of `scope` (merged with any reload still waiting). */
  request(scope: RefreshScope): void
  /** The page is visible again: run a reload that waited while it was hidden. */
  resume(): void
  /** Stop: cancels anything waiting. */
  dispose(): void
}

function merge(a: RefreshScope | null, b: RefreshScope): RefreshScope {
  return a === 'all' || b === 'all' ? 'all' : 'open'
}

export function createRefreshThrottle(options: RefreshThrottleOptions): RefreshThrottle {
  const { run, minIntervalMs = LIVE_MIN_INTERVAL_MS, gatherMs = LIVE_GATHER_MS, isHidden = () => false } = options
  let pending: RefreshScope | null = null
  let lastRun = Number.NEGATIVE_INFINITY
  let timer: ReturnType<typeof setTimeout> | undefined
  let dueAt = Number.POSITIVE_INFINITY
  let disposed = false

  /** Milliseconds until the pending reload may run (at least the gather window). */
  function waitFor(scope: RefreshScope): number {
    return Math.max(gatherMs, lastRun + minIntervalMs[scope] - Date.now())
  }

  /** Makes sure a timer fires within `ms` (keeps an earlier one). */
  function arm(ms: number) {
    const at = Date.now() + ms
    if (timer !== undefined && dueAt <= at) return
    clearTimeout(timer)
    dueAt = at
    timer = setTimeout(fire, ms)
  }

  function fire() {
    timer = undefined
    dueAt = Number.POSITIVE_INFINITY
    if (disposed || pending === null || isHidden()) return
    const wait = lastRun + minIntervalMs[pending] - Date.now()
    if (wait > 0) {
      arm(wait)
      return
    }
    const scope = pending
    pending = null
    lastRun = Date.now()
    run(scope)
  }

  return {
    request(scope) {
      if (disposed) return
      pending = merge(pending, scope)
      arm(waitFor(pending))
    },
    resume() {
      if (disposed || pending === null) return
      arm(waitFor(pending))
    },
    dispose() {
      disposed = true
      pending = null
      clearTimeout(timer)
      timer = undefined
    },
  }
}
