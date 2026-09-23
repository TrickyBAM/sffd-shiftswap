'use client'

// One chat thread (me ↔ one other member about one shift): load, mark read,
// live updates and send. Realtime events only trigger a refetch
// (ARCHITECTURE §6.7). Also: unread counts per sender for the poster's
// thread picker.

import { useCallback, useEffect, useRef, useState } from 'react'
import { listMessages, markThreadRead, sendMessage, unreadMessagesBySender } from '@/lib/api'
import { toAppError, type AppError } from '@/lib/errors'
import { createClient } from '@/lib/supabase/client'
import type { Message } from '@/lib/types/database'
import { announceNotificationsChanged } from '@/hooks/useUnreadCount'
import { useRealtimeRefetch } from '@/hooks/useRealtimeRefetch'
import { unreadFrom } from './trade-model'

export const MESSAGE_MAX = 1000

type ThreadState =
  | { key: string; status: 'ready'; messages: Message[] }
  | { key: string; status: 'error'; error: AppError }

export interface ChatThread {
  loading: boolean
  messages: Message[] | null
  error: AppError | null
  retry: () => void
  /** Sends a message; rejects with AppError so the caller can toast it. */
  send: (body: string) => Promise<void>
}

/** The thread about `shiftId` between me and `otherId` (null = no thread). */
export function useChatThread(shiftId: string, otherId: string | null, me: string): ChatThread {
  const key = `${shiftId}:${otherId ?? ''}`
  const [state, setState] = useState<ThreadState | null>(null)
  const seq = useRef(0)
  // Unread message ids already sent to mark_thread_read (avoid repeating it).
  const marking = useRef(new Set<string>())

  const load = useCallback(
    (quiet: boolean): Promise<void> => {
      if (!otherId) return Promise.resolve()
      const mine = ++seq.current
      let sb: ReturnType<typeof createClient>
      try {
        sb = createClient()
      } catch (err) {
        return Promise.reject(toAppError(err))
      }
      return listMessages(sb, shiftId, otherId).then(
        (messages) => {
          if (mine !== seq.current) return
          setState({ key, status: 'ready', messages })
          const unread = unreadFrom(messages, me).filter((m) => !marking.current.has(m))
          if (!unread.length) return
          for (const m of unread) marking.current.add(m)
          markThreadRead(sb, shiftId, otherId)
            .then(() => announceNotificationsChanged())
            .catch(() => {
              // Best effort: they stay unread and are retried on the next load.
              for (const m of unread) marking.current.delete(m)
            })
        },
        (err: unknown) => {
          if (mine !== seq.current) return
          const error = toAppError(err)
          setState((prev) =>
            quiet && prev?.key === key && prev.status === 'ready' ? prev : { key, status: 'error', error },
          )
        },
      )
    },
    [shiftId, otherId, me, key],
  )

  useEffect(() => {
    load(false).catch(() => {
      // Supabase isn't configured: nothing to show.
    })
  }, [load])

  useRealtimeRefetch({ table: 'messages', filter: `shift_id=eq.${shiftId}` }, () => void load(true).catch(() => {}), {
    enabled: Boolean(otherId),
    name: 'chat',
    debounceMs: 250,
  })

  const retry = useCallback(() => {
    load(false).catch(() => {})
  }, [load])

  const send = useCallback(
    async (body: string) => {
      if (!otherId) return
      try {
        await sendMessage(createClient(), shiftId, otherId, body)
      } catch (err) {
        throw toAppError(err)
      }
      await load(true)
    },
    [shiftId, otherId, load],
  )

  const current = state && state.key === key ? state : null
  return {
    loading: Boolean(otherId) && !current,
    messages: current?.status === 'ready' ? current.messages : null,
    error: current?.status === 'error' ? current.error : null,
    retry,
    send,
  }
}

/**
 * Unread messages to me on this shift, counted per sender — for the poster's
 * thread picker ("Mike Lee · 2 new"). Empty on any failure (it's a hint only).
 * `enabled` false skips the query (then `loaded` is true right away).
 */
export function useUnreadBySender(
  shiftId: string,
  me: string,
  enabled: boolean,
): { counts: Record<string, number>; loaded: boolean } {
  const [counts, setCounts] = useState<{ key: string; value: Record<string, number> } | null>(null)
  const key = `${shiftId}:${me}`

  const load = useCallback((): void => {
    if (!enabled) return
    let sb: ReturnType<typeof createClient>
    try {
      sb = createClient()
    } catch {
      // Supabase isn't configured: no badges.
      return
    }
    unreadMessagesBySender(sb, shiftId, { userId: me }).then(
      (value) => setCounts({ key, value }),
      () => setCounts({ key, value: {} }),
    )
  }, [enabled, shiftId, me, key])

  useEffect(() => {
    load()
  }, [load])

  useRealtimeRefetch({ table: 'messages', filter: `shift_id=eq.${shiftId}` }, load, {
    enabled,
    name: 'chat-unread',
  })

  const loaded = !enabled || counts?.key === key
  return { counts: enabled && counts?.key === key ? counts.value : EMPTY, loaded }
}

const EMPTY: Record<string, number> = {}
