'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { errorMessage } from '@/lib/errors'
import { loadSnapshot, saveSnapshot } from '@/lib/offline-cache'
import { createClient } from '@/lib/supabase/client'
import { useRealtimeRefetch } from '@/hooks/useRealtimeRefetch'
import { loadTradesData, TRADES_SNAPSHOT_KEY } from './load-trades'
import type { TradesData } from './trades-model'

export type TradesState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | {
      status: 'ready'
      data: TradesData
      /** Showing cached data because the latest fetch failed. */
      offline: boolean
      /** When the data on screen was loaded (ISO). */
      savedAt: string
    }

export interface TradesDataApi {
  state: TradesState
  /** A user-started reload is running (Try again / Retry). */
  retrying: boolean
  /** Reload now, showing progress (buttons). */
  retry: () => void
  /** Reload quietly (after an action, realtime). */
  refresh: () => void
  /** Patch the data on screen (e.g. drop a withdrawn request before the refetch lands). */
  mutate: (update: (data: TradesData) => TradesData) => void
}

/**
 * Loads the Trades hub, keeps it fresh with realtime changes, and falls back to
 * the last offline snapshot (with the ribbon) when the network fails.
 */
export function useTradesData(userId: string): TradesDataApi {
  const [state, setState] = useState<TradesState>({ status: 'loading' })
  const [retrying, setRetrying] = useState(false)
  const [version, setVersion] = useState(0)
  // What's on screen, read from async callbacks (not during render).
  const current = useRef<TradesState>(state)

  useEffect(() => {
    current.current = state
  }, [state])

  useEffect(() => {
    let cancelled = false
    Promise.resolve()
      .then(() => loadTradesData(createClient(), userId))
      .then(
        (data) => {
          if (cancelled) return
          saveSnapshot(TRADES_SNAPSHOT_KEY, userId, data)
          setState({ status: 'ready', data, offline: false, savedAt: data.loadedAt })
          setRetrying(false)
        },
        (error: unknown) => {
          if (cancelled) return
          setRetrying(false)
          const shown = current.current
          if (shown.status === 'ready') {
            // Keep what's on screen; the ribbon says it may be out of date.
            setState({ ...shown, offline: true })
            return
          }
          const snapshot = loadSnapshot<TradesData>(TRADES_SNAPSHOT_KEY, userId)
          if (snapshot) {
            setState({ status: 'ready', data: snapshot.data, offline: true, savedAt: snapshot.savedAt })
          } else {
            setState({ status: 'error', message: errorMessage(error) })
          }
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
  const mutate = useCallback((update: (data: TradesData) => TradesData) => {
    setState((prev) => (prev.status === 'ready' ? { ...prev, data: update(prev.data) } : prev))
  }, [])

  // Realtime events only trigger a refetch (ARCHITECTURE §6.7). Shifts are
  // filtered to mine; requests and alerts are already limited to what I can see.
  useRealtimeRefetch(
    [
      { table: 'shifts', filter: `poster_id=eq.${userId}` },
      { table: 'shifts', filter: `coverer_id=eq.${userId}` },
      { table: 'shift_requests' },
      { table: 'notifications', filter: `user_id=eq.${userId}` },
    ],
    refresh,
    { name: 'trades', debounceMs: 600 },
  )

  return { state, retrying, retry, refresh, mutate }
}
