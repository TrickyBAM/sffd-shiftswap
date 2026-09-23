'use client'

// Loads the Board: open shifts for the current filters (keyset "Load more"),
// my request status per shift, and — for "Only shifts I can take" — the days
// I work, which the board query leaves out. Keeps an offline snapshot and
// falls back to it when the live fetch fails (ARCHITECTURE §7.2 "Offline").

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  BOARD_PAGE_SIZE,
  getMySchedule,
  latestRequestByShift,
  listBoardShifts,
  listMyRequests,
  type BoardCursor,
} from '@/lib/api'
import { toAppError, type AppError } from '@/lib/errors'
import { loadSnapshot, saveSnapshot } from '@/lib/offline-cache'
import { addDays, todayPT, type Ymd } from '@/lib/sffd/dates'
import { createClient } from '@/lib/supabase/client'
import type { Shift, ShiftRequest } from '@/lib/types/database'
import { isAccountError } from './errors'
import { boardQueryKey, toBoardApiFilters, type BoardFilterState, type BoardMember } from './filters'
import { currentTime, uniqueById } from './format'

export const BOARD_SNAPSHOT_KEY = 'board'

/** How far ahead my schedule is checked (posts can be up to 180 days out). */
const SCHEDULE_DAYS = 181

/** Largest page a live refresh reloads in one go (listBoardShifts max). */
const MAX_REFRESH_LIMIT = 100

export interface BoardQuery {
  filters: BoardFilterState
  /** ?date=YYYY-MM-DD: only this day. */
  date: Ymd | null
}

export interface BoardData {
  items: Shift[]
  nextCursor: BoardCursor | null
  /** My latest pending or declined request per shift id. */
  requests: Record<string, ShiftRequest>
  /** Days "Only shifts I can take" leaves out (I work, cover or have a post). */
  excludeDates: Ymd[]
  /** When this data was fetched (epoch ms). */
  fetchedAt: number
}

/** What the offline snapshot stores. */
export interface BoardSnapshotData {
  query: BoardQuery
  items: Shift[]
  requests: Record<string, ShiftRequest>
  excludeDates: Ymd[]
  fetchedAt: number
}

export interface BoardSnapshotInfo {
  savedAt: string
  query: BoardQuery
}

type LoadState =
  | { key: string; status: 'ready'; data: BoardData; snapshot: BoardSnapshotInfo | null }
  | { key: string; status: 'error'; error: AppError }

function requestRow(r: ShiftRequest): ShiftRequest {
  return {
    id: r.id,
    shift_id: r.shift_id,
    requester_id: r.requester_id,
    requester_name: r.requester_name,
    requester_rank: r.requester_rank,
    requester_station: r.requester_station,
    return_date: r.return_date,
    message: r.message,
    status: r.status,
    decided_at: r.decided_at,
    created_at: r.created_at,
  }
}

async function fetchBoard(member: BoardMember, query: BoardQuery, limit: number): Promise<BoardData> {
  const sb = createClient()
  const { filters, date } = query
  const today = todayPT()
  const [schedule, myRequests] = await Promise.all([
    filters.onlyEligible
      ? getMySchedule(sb, date ?? today, date ?? addDays(today, SCHEDULE_DAYS - 1))
      : Promise.resolve([]),
    listMyRequests(sb, { userId: member.id, statuses: ['pending', 'declined'], limit: 300 }),
  ])
  // YOU_WORK_THAT_DAY also covers a day I have an open post; ALREADY_COVERING is `picked_up` (inside `working`).
  const excludeDates = schedule.filter((d) => d.working || d.open_post_id).map((d) => d.date)
  const page = await listBoardShifts(sb, toBoardApiFilters(filters, member, { date, excludeDates }), { limit })
  const requests: Record<string, ShiftRequest> = {}
  for (const [shiftId, r] of latestRequestByShift(myRequests)) requests[shiftId] = requestRow(r)
  return { items: page.items, nextCursor: page.nextCursor, requests, excludeDates, fetchedAt: currentTime() }
}

function isSnapshotData(value: unknown): value is BoardSnapshotData {
  const v = value as Partial<BoardSnapshotData> | null
  return Boolean(v && Array.isArray(v.items) && v.query && typeof v.requests === 'object' && Array.isArray(v.excludeDates))
}

/** The saved snapshot (if any) standing in for a failed load, else the error. */
function fallbackState(userId: string, key: string, error: AppError): LoadState {
  if (!isAccountError(error)) {
    const snap = loadSnapshot<unknown>(BOARD_SNAPSHOT_KEY, userId)
    if (snap && isSnapshotData(snap.data)) {
      const { query, items, requests, excludeDates, fetchedAt } = snap.data
      return {
        key,
        status: 'ready',
        data: { items, requests, excludeDates, fetchedAt, nextCursor: null },
        snapshot: { savedAt: snap.savedAt, query },
      }
    }
  }
  return { key, status: 'error', error }
}

export interface BoardDataState {
  /** True until data (or an error) for the current filters has arrived. */
  loading: boolean
  data: BoardData | null
  /** Set when `data` is the offline snapshot rather than live data. */
  snapshot: BoardSnapshotInfo | null
  error: AppError | null
  retrying: boolean
  loadingMore: boolean
  /** Reload after an error (shows `retrying`). */
  retry: () => void
  /** Quiet reload (realtime, after an action): keeps the list on screen. */
  refresh: () => void
  /** Next keyset page. Rejects with AppError so the caller can toast it. */
  loadMore: () => Promise<void>
}

/**
 * Board data for `query` (memoise it: a new object means new filters).
 * `member` must be memoised too.
 */
export function useBoardData(member: BoardMember, query: BoardQuery): BoardDataState {
  const key = boardQueryKey(query.filters, query.date)
  const [state, setState] = useState<LoadState | null>(null)
  const [retrying, setRetrying] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  // Only the newest load may write state; older responses are dropped.
  const seq = useRef(0)

  const run = useCallback(
    async (q: BoardQuery, k: string, limit: number, quiet: boolean) => {
      const mine = ++seq.current
      try {
        const data = await fetchBoard(member, q, limit)
        if (mine !== seq.current) return
        setState({ key: k, status: 'ready', data, snapshot: null })
        saveSnapshot<BoardSnapshotData>(BOARD_SNAPSHOT_KEY, member.id, {
          query: q,
          items: data.items,
          requests: data.requests,
          excludeDates: data.excludeDates,
          fetchedAt: data.fetchedAt,
        })
      } catch (err) {
        if (mine !== seq.current) return
        const error = toAppError(err)
        setState((prev) =>
          // A quiet refresh that fails keeps the live list already on screen.
          quiet && prev && prev.key === k && prev.status === 'ready' && !prev.snapshot
            ? prev
            : fallbackState(member.id, k, error),
        )
      } finally {
        if (mine === seq.current) setRetrying(false)
      }
    },
    [member],
  )

  useEffect(() => {
    void run(query, key, BOARD_PAGE_SIZE, false)
  }, [run, query, key])

  const current = state && state.key === key ? state : null
  const loadedCount = current?.status === 'ready' ? current.data.items.length : 0

  const retry = useCallback(() => {
    setRetrying(true)
    void run(query, key, BOARD_PAGE_SIZE, false)
  }, [run, query, key])

  const refresh = useCallback(() => {
    const limit = Math.min(MAX_REFRESH_LIMIT, Math.max(BOARD_PAGE_SIZE, loadedCount))
    void run(query, key, limit, true)
  }, [run, query, key, loadedCount])

  const cursor = current?.status === 'ready' ? current.data.nextCursor : null
  const excludeDates = current?.status === 'ready' ? current.data.excludeDates : null

  const loadMore = useCallback(async () => {
    if (!cursor || loadingMore) return
    const mine = seq.current
    setLoadingMore(true)
    try {
      const page = await listBoardShifts(
        createClient(),
        toBoardApiFilters(query.filters, member, { date: query.date, excludeDates }),
        { after: cursor, limit: BOARD_PAGE_SIZE },
      )
      if (mine !== seq.current) return
      setState((prev) =>
        prev && prev.key === key && prev.status === 'ready'
          ? {
              ...prev,
              data: {
                ...prev.data,
                items: uniqueById([...prev.data.items, ...page.items]),
                nextCursor: page.nextCursor,
              },
            }
          : prev,
      )
    } catch (err) {
      throw toAppError(err)
    } finally {
      setLoadingMore(false)
    }
  }, [cursor, loadingMore, query, member, excludeDates, key])

  return {
    loading: !current,
    data: current?.status === 'ready' ? current.data : null,
    snapshot: current?.status === 'ready' ? current.snapshot : null,
    error: current?.status === 'error' ? current.error : null,
    retrying,
    loadingMore,
    retry,
    refresh,
    loadMore,
  }
}
