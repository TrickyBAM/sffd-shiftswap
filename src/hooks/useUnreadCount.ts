'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import { unreadCount } from '@/lib/api'
import { createClient } from '@/lib/supabase/client'
import { useRealtimeRefetch } from './useRealtimeRefetch'

/** Window event other screens dispatch after marking notifications read. */
export const NOTIFICATIONS_CHANGED_EVENT = 'shiftswap:notifications-changed'

/**
 * Tell every mounted unread badge to recount right away (e.g. after
 * mark_notifications_read), instead of waiting for the realtime UPDATE event.
 */
export function announceNotificationsChanged(): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(NOTIFICATIONS_CHANGED_EVENT))
}

/** Head-only count of unread notifications (src/lib/api), or null if it couldn't be read. Never throws. */
async function countUnread(client: SupabaseClient | undefined, userId: string): Promise<number | null> {
  try {
    return await unreadCount(client ?? createClient(), { userId })
  } catch {
    // Network failure or Supabase not configured.
    return null
  }
}

export interface UnreadCountState {
  count: number
  /** True until the first count has loaded. */
  loading: boolean
  /** True when the last count failed (the previous count is kept). */
  error: boolean
  refresh: () => void
}

/**
 * Number of the user's notifications with read_at null.
 *
 * Initial head-count query, then a realtime subscription on the user's notifications
 * (unique channel per mount, removed on unmount) that triggers a debounced recount;
 * also recounts when the tab becomes visible or the device comes back online.
 */
export function useUnreadCount(
  userId: string | null | undefined,
  options: { client?: SupabaseClient } = {},
): UnreadCountState {
  const { client } = options
  const [count, setCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  // Ignore responses that arrive after a newer request was started.
  const requestSeq = useRef(0)

  const refresh = useCallback(() => {
    if (!userId) return
    const seq = ++requestSeq.current
    void countUnread(client, userId).then((total) => {
      if (seq !== requestSeq.current) return
      if (total === null) {
        setError(true) // keep the last known count
      } else {
        setCount(total)
        setError(false)
      }
      setLoading(false)
    })
  }, [userId, client])

  // Initial load (and reload when the user changes).
  useEffect(() => {
    refresh()
  }, [refresh])

  // Explicit "something changed" pings from other screens.
  useEffect(() => {
    window.addEventListener(NOTIFICATIONS_CHANGED_EVENT, refresh)
    return () => window.removeEventListener(NOTIFICATIONS_CHANGED_EVENT, refresh)
  }, [refresh])

  useRealtimeRefetch(
    { table: 'notifications', filter: userId ? `user_id=eq.${userId}` : undefined },
    refresh,
    { enabled: Boolean(userId), client, name: 'unread', debounceMs: 250 },
  )

  return { count: userId ? count : 0, loading: userId ? loading : false, error, refresh }
}
