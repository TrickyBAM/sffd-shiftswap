'use client'

// Live data for the trade detail page: the trade (both SwapMatch legs and the
// requests I may see) plus the other party's contact details. Starts from
// what the server page loaded, refreshes quietly on realtime changes and
// after actions, and falls back to the offline snapshot when the network is
// down (ARCHITECTURE §6.7, §7.2 "Offline").

import { useCallback, useEffect, useRef, useState } from 'react'
import { getTrade, getTradeContacts, type TradeDetail } from '@/lib/api'
import { toAppError, type AppError } from '@/lib/errors'
import { createClient } from '@/lib/supabase/client'
import type { TradeContact } from '@/lib/types/database'
import { isAccountError } from '@/app/(app)/board/_lib/errors'
import { currentTime } from '@/app/(app)/board/_lib/format'
import { loadTradeSnapshot, saveTradeSnapshot } from './trade-snapshot'
import { viewerRole } from './trade-model'

export interface TradeBundle {
  detail: TradeDetail
  /** The other party's contact details (empty when I'm not in this trade). */
  contacts: TradeContact[]
  /** True until contacts have been loaded at least once. */
  contactsLoading: boolean
  /** Contacts couldn't be loaded; the rest of the page still works. */
  contactsError: AppError | null
  /** When this data was loaded (epoch ms) — "now" for started/not-started checks. */
  loadedAt: number
}

export type TradeLoadState =
  | { status: 'loading' }
  | { status: 'ready'; bundle: TradeBundle; snapshotSavedAt: string | null }
  | { status: 'gone' }
  | { status: 'error'; error: AppError }

async function fetchBundle(id: string, me: string): Promise<TradeBundle | null> {
  const sb = createClient()
  const detail = await getTrade(sb, id)
  if (!detail) return null
  let contacts: TradeContact[] = []
  let contactsError: AppError | null = null
  if (viewerRole(detail, me) !== 'viewer') {
    try {
      contacts = await getTradeContacts(sb, detail.shift.id)
    } catch (err) {
      contactsError = toAppError(err)
    }
  }
  return { detail, contacts, contactsLoading: false, contactsError, loadedAt: currentTime() }
}

export interface TradeData {
  state: TradeLoadState
  /** Reload after an error (shows `retrying`). */
  retry: () => void
  retrying: boolean
  /** Quiet reload that keeps the page on screen (realtime, after an action). Resolves when done. */
  refresh: () => Promise<void>
}

/**
 * The trade `id` (either leg) for member `me`. `initial` is what the server
 * page loaded (null when it couldn't): shown right away, then refreshed with
 * the contact details.
 */
export function useTradeData(id: string, me: string, initial: TradeDetail | null): TradeData {
  const [state, setState] = useState<TradeLoadState>(() =>
    initial
      ? {
          status: 'ready',
          bundle: { detail: initial, contacts: [], contactsLoading: true, contactsError: null, loadedAt: currentTime() },
          snapshotSavedAt: null,
        }
      : { status: 'loading' },
  )
  const [retrying, setRetrying] = useState(false)
  // Only the newest load may write state.
  const seq = useRef(0)

  const run = useCallback(
    async (quiet: boolean) => {
      const mine = ++seq.current
      try {
        const bundle = await fetchBundle(id, me)
        if (mine !== seq.current) return
        if (!bundle) {
          setState({ status: 'gone' })
          return
        }
        setState({ status: 'ready', bundle, snapshotSavedAt: null })
        if (viewerRole(bundle.detail, me) !== 'viewer') {
          saveTradeSnapshot(me, id, { detail: bundle.detail, contacts: bundle.contacts })
        }
      } catch (err) {
        if (mine !== seq.current) return
        const error = toAppError(err)
        const snap = isAccountError(error) ? null : loadTradeSnapshot(me, id)
        setState((prev) => {
          if (quiet && prev.status === 'ready' && !prev.snapshotSavedAt) {
            // A quiet refresh that fails keeps the live trade already on screen.
            if (!prev.bundle.contactsLoading) return prev
            // First load after the server render: keep its (fresher) trade and
            // borrow saved contact details if there are any.
            const saved = snap?.contacts.length ? snap.contacts : null
            return {
              ...prev,
              bundle: {
                ...prev.bundle,
                contacts: saved ?? prev.bundle.contacts,
                contactsLoading: false,
                contactsError: saved ? null : error,
              },
            }
          }
          if (snap) {
            return {
              status: 'ready',
              bundle: {
                detail: snap.detail,
                contacts: snap.contacts,
                contactsLoading: false,
                contactsError: null,
                loadedAt: currentTime(),
              },
              snapshotSavedAt: snap.savedAt,
            }
          }
          return { status: 'error', error }
        })
      } finally {
        if (mine === seq.current) setRetrying(false)
      }
    },
    [id, me],
  )

  // First client load: contacts (and a fresh copy of the trade).
  const hasInitial = initial != null
  useEffect(() => {
    void run(hasInitial)
  }, [run, hasInitial])

  const retry = useCallback(() => {
    setRetrying(true)
    void run(false)
  }, [run])

  const refresh = useCallback(() => run(true), [run])

  return { state, retry, retrying, refresh }
}
