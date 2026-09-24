'use client'

import { useEffect, useEffectEvent } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/client'

/** Tables published to Supabase Realtime (ARCHITECTURE §6.7). */
export type RealtimeTable = 'shifts' | 'shift_requests' | 'notifications' | 'messages'

export interface RealtimeWatch {
  table: RealtimeTable
  event?: '*' | 'INSERT' | 'UPDATE' | 'DELETE'
  /**
   * Realtime row filter, e.g. `user_id=eq.${userId}` or `shift_id=eq.${id}`
   * (supports eq, neq, lt, lte, gt, gte, in). Note: Realtime cannot filter DELETE events.
   */
  filter?: string
  schema?: string
}

export interface RealtimeRefetchOptions {
  /** Set false to pause (e.g. until the user id is known). Default true. */
  enabled?: boolean
  /** Bursts of changes collapse into one callback after this quiet period. Default 400 ms. */
  debounceMs?: number
  /**
   * Also fire when the tab becomes visible again, the device comes back online, or the
   * channel re-joins after a drop — events may have been missed meanwhile. Default true.
   */
  refetchOnResume?: boolean
  /** Supabase browser client; defaults to createClient() from '@/lib/supabase/client'. */
  client?: SupabaseClient
  /** Short label used in the channel name (debugging only). */
  name?: string
}

let channelCounter = 0

/**
 * A channel name no other mount can share. supabase-js returns the *existing* channel for
 * a repeated topic, which breaks when a component remounts before the old channel is gone.
 */
export function uniqueChannelName(prefix: string): string {
  channelCounter += 1
  const random = Math.random().toString(36).slice(2, 8)
  return `${prefix}:${Date.now().toString(36)}:${channelCounter}:${random}`
}

/**
 * Calls `onChange` (debounced) whenever rows change in the watched tables.
 * Realtime payloads are never used as data: the callback should refetch (ARCHITECTURE §6.7).
 *
 *   useRealtimeRefetch(
 *     [{ table: 'shifts' }, { table: 'shift_requests', filter: `requester_id=eq.${me}` }],
 *     reload,
 *   )
 *
 * `watch` may be a new array each render; the subscription only changes when its content does.
 */
export function useRealtimeRefetch(
  watch: RealtimeWatch | readonly RealtimeWatch[],
  onChange: () => void,
  options: RealtimeRefetchOptions = {},
): void {
  const { enabled = true, debounceMs = 400, refetchOnResume = true, client, name } = options
  const watchKey = JSON.stringify(Array.isArray(watch) ? watch : [watch])
  const fire = useEffectEvent(() => onChange())

  useEffect(() => {
    if (!enabled) return
    const watches = JSON.parse(watchKey) as RealtimeWatch[]
    if (watches.length === 0) return

    let sb: SupabaseClient
    try {
      sb = client ?? createClient()
    } catch {
      // Supabase isn't configured (MissingEnvError): no live updates, the view still works.
      return
    }
    let disposed = false
    let timer: ReturnType<typeof setTimeout> | undefined

    const schedule = () => {
      if (disposed) return
      clearTimeout(timer)
      timer = setTimeout(() => {
        if (!disposed) fire()
      }, debounceMs)
    }

    const label = name ?? watches.map((w) => w.table).join('+')
    const channel = sb.channel(uniqueChannelName(`rt-${label}`))
    for (const w of watches) {
      channel.on(
        'postgres_changes',
        {
          event: w.event ?? '*',
          schema: w.schema ?? 'public',
          table: w.table,
          ...(w.filter ? { filter: w.filter } : {}),
        },
        schedule,
      )
    }

    let joinedBefore = false
    channel.subscribe((status) => {
      if (status !== 'SUBSCRIBED') return
      // The first join is the initial subscribe (the caller already loaded fresh data);
      // later joins are reconnects after a drop, so catch up on anything missed.
      if (joinedBefore && refetchOnResume) schedule()
      joinedBefore = true
    })

    const onVisibility = () => {
      if (document.visibilityState === 'visible') schedule()
    }
    if (refetchOnResume) {
      document.addEventListener('visibilitychange', onVisibility)
      window.addEventListener('online', schedule)
    }

    return () => {
      disposed = true
      clearTimeout(timer)
      if (refetchOnResume) {
        document.removeEventListener('visibilitychange', onVisibility)
        window.removeEventListener('online', schedule)
      }
      void sb.removeChannel(channel)
    }
  }, [watchKey, enabled, debounceMs, refetchOnResume, client, name])
}
