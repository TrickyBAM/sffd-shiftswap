'use client'

import { useMemo, useSyncExternalStore } from 'react'
import { todayPT, type Ymd } from '@/lib/sffd/dates'

// A coarse clock for date-driven screens (calendar, post form): "today" in San
// Francisco and the current minute. It ticks every 30 s and when the app comes
// back to the foreground, so a phone left open overnight rolls over to the new
// day without a reload. Shared by /calendar and /post.

const TICK_MS = 30_000

function currentMinute(): number {
  return Math.floor(Date.now() / 60_000)
}

function subscribe(onChange: () => void): () => void {
  const timer = setInterval(onChange, TICK_MS)
  const onVisible = () => {
    if (document.visibilityState === 'visible') onChange()
  }
  document.addEventListener('visibilitychange', onVisible)
  window.addEventListener('focus', onChange)
  return () => {
    clearInterval(timer)
    document.removeEventListener('visibilitychange', onVisible)
    window.removeEventListener('focus', onChange)
  }
}

export interface Clock {
  /** Today's date in San Francisco. */
  today: Ymd
  /** The current time, rounded down to the minute. */
  now: Date
}

export function useClock(): Clock {
  const minute = useSyncExternalStore(subscribe, currentMinute, currentMinute)
  return useMemo(() => {
    const now = new Date(minute * 60_000)
    return { today: todayPT(now), now }
  }, [minute])
}
