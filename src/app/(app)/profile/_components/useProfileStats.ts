'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { getMyStats, listMyShiftsInRange, type Sb } from '@/lib/api'
import { errorMessage } from '@/lib/errors'
import { loadSnapshot, saveSnapshot } from '@/lib/offline-cache'
import { todayPT } from '@/lib/sffd/dates'
import { createClient } from '@/lib/supabase/client'
import type { MyStats } from '@/lib/types/database'
import { useRealtimeRefetch } from '@/hooks/useRealtimeRefetch'
import { coversInRange, monthRange, type MonthCovers } from './profile-model'

/** Offline snapshot key for the Profile stats (src/lib/offline-cache.ts). */
export const PROFILE_STATS_SNAPSHOT_KEY = 'profile-stats'

export interface ProfileStatsData {
  stats: MyStats
  /** Shifts I cover this month; null when that part couldn't be loaded. */
  month: MonthCovers | null
  /** ISO time the data was loaded. */
  loadedAt: string
}

export type ProfileStatsState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | {
      status: 'ready'
      data: ProfileStatsData
      /** Showing the saved snapshot (or older data) because the latest load failed. */
      offline: boolean
      savedAt: string
    }

async function loadProfileStats(sb: Sb, userId: string): Promise<ProfileStatsData> {
  const range = monthRange(todayPT())
  const [stats, month] = await Promise.all([
    getMyStats(sb),
    // Only feeds the friendly "covered 3 shifts this month" line: never fail the card over it.
    listMyShiftsInRange(sb, { ...range, userId }).then(
      (shifts) => coversInRange(shifts, userId, range, Date.now()),
      () => null,
    ),
  ])
  return { stats, month, loadedAt: new Date().toISOString() }
}

/**
 * My Profile numbers (my_stats), kept fresh with realtime changes to my shifts,
 * with the last snapshot as an offline fallback.
 */
export function useProfileStats(userId: string): {
  state: ProfileStatsState
  retrying: boolean
  retry: () => void
} {
  const [state, setState] = useState<ProfileStatsState>({ status: 'loading' })
  const [retrying, setRetrying] = useState(false)
  const [version, setVersion] = useState(0)
  const current = useRef<ProfileStatsState>(state)

  useEffect(() => {
    current.current = state
  }, [state])

  useEffect(() => {
    let cancelled = false
    Promise.resolve()
      .then(() => loadProfileStats(createClient(), userId))
      .then(
        (data) => {
          if (cancelled) return
          saveSnapshot(PROFILE_STATS_SNAPSHOT_KEY, userId, data)
          setState({ status: 'ready', data, offline: false, savedAt: data.loadedAt })
          setRetrying(false)
        },
        (error: unknown) => {
          if (cancelled) return
          setRetrying(false)
          const shown = current.current
          if (shown.status === 'ready') {
            setState({ ...shown, offline: true })
            return
          }
          const snapshot = loadSnapshot<ProfileStatsData>(PROFILE_STATS_SNAPSHOT_KEY, userId)
          if (snapshot) setState({ status: 'ready', data: snapshot.data, offline: true, savedAt: snapshot.savedAt })
          else setState({ status: 'error', message: errorMessage(error) })
        },
      )
    return () => {
      cancelled = true
    }
  }, [userId, version])

  const refresh = useCallback(() => setVersion((v) => v + 1), [])
  const retry = useCallback(() => {
    setRetrying(true)
    setVersion((v) => v + 1)
  }, [])

  // Realtime events only trigger a refetch (ARCHITECTURE §6.7).
  useRealtimeRefetch(
    [
      { table: 'shifts', filter: `poster_id=eq.${userId}` },
      { table: 'shifts', filter: `coverer_id=eq.${userId}` },
    ],
    refresh,
    { name: 'profile-stats', debounceMs: 800 },
  )

  return { state, retrying, retry }
}
