'use client'

// Loads the Board: open shifts for the current filters (keyset "Load more"),
// my request status per shift, and, for "Only shifts I can take", what my
// schedule rules out: the days I'm on duty (left out of the query) and
// SwapMatch posts whose return dates I can't give (hidden here). A live
// refresh reloads every page already loaded. Keeps an offline snapshot and
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
import { todayPT, type Ymd } from '@/lib/sffd/dates'
import { createClient } from '@/lib/supabase/client'
import type { Shift, ShiftRequest } from '@/lib/types/database'
import { boardEligibility, offersReturnICanGive, scheduleRange, type ReturnDateRules } from './eligibility'
import { isAccountError } from './errors'
import { boardQueryKey, toBoardApiFilters, type BoardFilterState, type BoardMember } from './filters'
import { currentTime, uniqueById } from './format'
import { fillPage, reloadThrough, reloadPageBudget, type BoardPageFetcher, type BoardRowFilter } from './paging'

export const BOARD_SNAPSHOT_KEY = 'board'

/** Largest page listBoardShifts() returns; live refreshes read pages this big. */
const MAX_PAGE_SIZE = 100
/** Pages a first load or "Load more" may read to fill one page of shown shifts. */
const FILL_MAX_PAGES = 5
/** Pages a live refresh may read (up to 1,000 shifts). */
const REFRESH_MAX_PAGES = 10

export interface BoardQuery {
  filters: BoardFilterState
  /** ?date=YYYY-MM-DD: only this day. */
  date: Ymd | null
}

export interface BoardData {
  /** The shifts shown, in board order. */
  items: Shift[]
  nextCursor: BoardCursor | null
  /** My latest pending or declined request per shift id. */
  requests: Record<string, ShiftRequest>
  /** Days "Only shifts I can take" leaves out (I work, cover or have a post). */
  excludeDates: Ymd[]
  /** Days I gave away only the PM (still on duty 0800–1600). */
  pmDates: Ymd[]
  /** SwapMatch return-date rules while "Only shifts I can take" is on, else null. */
  returnRules: ReturnDateRules | null
  /** When this data was fetched (epoch ms). */
  fetchedAt: number
}

/** What the offline snapshot stores. */
export interface BoardSnapshotData {
  query: BoardQuery
  items: Shift[]
  requests: Record<string, ShiftRequest>
  excludeDates: Ymd[]
  /** Missing in snapshots saved before it existed. */
  pmDates?: Ymd[]
  fetchedAt: number
}

export interface BoardSnapshotInfo {
  savedAt: string
  query: BoardQuery
}

type LoadState =
  | { key: string; status: 'ready'; data: BoardData; snapshot: BoardSnapshotInfo | null }
  | { key: string; status: 'error'; error: AppError }

/** First load (one page of shown shifts), or a refresh through what's already loaded. */
type LoadMode = { kind: 'first' } | { kind: 'refresh'; through: BoardCursor | null; maxPages: number }

const FIRST_LOAD: LoadMode = { kind: 'first' }

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

/** Which fetched rows the list shows: all of them, or only SwapMatch posts I could give a return date for. */
function rowFilter(rules: ReturnDateRules | null, now: Date): BoardRowFilter {
  return rules ? (shift) => offersReturnICanGive(shift, rules, now) : () => true
}

async function fetchBoard(member: BoardMember, query: BoardQuery, mode: LoadMode): Promise<BoardData> {
  const sb = createClient()
  const { filters, date } = query
  const now = new Date()
  const range = scheduleRange(todayPT(now), date)
  const [schedule, myRequests] = await Promise.all([
    filters.onlyEligible ? getMySchedule(sb, range.from, range.to) : Promise.resolve([]),
    listMyRequests(sb, { userId: member.id, statuses: ['pending', 'declined'], limit: 300 }),
  ])
  const eligibility = filters.onlyEligible ? boardEligibility(schedule, member.tour, date) : null
  const excludeDates = eligibility?.excludeDates ?? []
  const returnRules = eligibility?.returnRules ?? null
  const apiFilters = toBoardApiFilters(filters, member, { date, excludeDates })
  const fetchPage: BoardPageFetcher = (after, limit) => listBoardShifts(sb, apiFilters, { after, limit })
  const keep = rowFilter(returnRules, now)
  const page =
    mode.kind === 'first'
      ? await fillPage(fetchPage, {
          after: null,
          want: BOARD_PAGE_SIZE,
          pageSize: BOARD_PAGE_SIZE,
          maxPages: FILL_MAX_PAGES,
          keep,
        })
      : await reloadThrough(fetchPage, {
          through: mode.through,
          pageSize: MAX_PAGE_SIZE,
          maxPages: mode.maxPages,
          keep,
        })
  const requests: Record<string, ShiftRequest> = {}
  for (const [shiftId, r] of latestRequestByShift(myRequests)) requests[shiftId] = requestRow(r)
  return {
    items: uniqueById(page.items),
    nextCursor: page.nextCursor,
    requests,
    excludeDates,
    pmDates: eligibility?.pmDates ?? [],
    returnRules,
    fetchedAt: currentTime(),
  }
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
      const { query, items, requests, excludeDates, pmDates, fetchedAt } = snap.data
      return {
        key,
        status: 'ready',
        data: {
          items,
          requests,
          excludeDates,
          pmDates: Array.isArray(pmDates) ? pmDates : [],
          returnRules: null,
          fetchedAt,
          nextCursor: null,
        },
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
  /** Quiet reload (realtime, after an action): keeps the list, and every page loaded, on screen. */
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
    async (q: BoardQuery, k: string, mode: LoadMode, quiet: boolean) => {
      const mine = ++seq.current
      try {
        const data = await fetchBoard(member, q, mode)
        if (mine !== seq.current) return
        setState({ key: k, status: 'ready', data, snapshot: null })
        saveSnapshot<BoardSnapshotData>(BOARD_SNAPSHOT_KEY, member.id, {
          query: q,
          items: data.items,
          requests: data.requests,
          excludeDates: data.excludeDates,
          pmDates: data.pmDates,
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
    void run(query, key, FIRST_LOAD, false)
  }, [run, query, key])

  const current = state && state.key === key ? state : null
  const live = current?.status === 'ready' && !current.snapshot ? current.data : null

  const retry = useCallback(() => {
    setRetrying(true)
    void run(query, key, FIRST_LOAD, false)
  }, [run, query, key])

  // Reload through the last row loaded so "Load more" pages stay; after an
  // error or from the offline snapshot, start over.
  const through = live ? live.nextCursor : null
  const hasLive = live != null
  const shownCount = live?.items.length ?? 0
  const refresh = useCallback(() => {
    const maxPages = through
      ? REFRESH_MAX_PAGES
      : reloadPageBudget(shownCount, { pageSize: MAX_PAGE_SIZE, extraRows: BOARD_PAGE_SIZE, maxPages: REFRESH_MAX_PAGES })
    void run(query, key, hasLive ? { kind: 'refresh', through, maxPages } : FIRST_LOAD, true)
  }, [run, query, key, hasLive, through, shownCount])

  const cursor = live?.nextCursor ?? null
  const excludeDates = live?.excludeDates ?? null
  const returnRules = live?.returnRules ?? null

  const loadMore = useCallback(async () => {
    if (!cursor || loadingMore) return
    const mine = seq.current
    setLoadingMore(true)
    try {
      const sb = createClient()
      const apiFilters = toBoardApiFilters(query.filters, member, { date: query.date, excludeDates })
      const fetchPage: BoardPageFetcher = (after, limit) => listBoardShifts(sb, apiFilters, { after, limit })
      const page = await fillPage(fetchPage, {
        after: cursor,
        want: BOARD_PAGE_SIZE,
        pageSize: BOARD_PAGE_SIZE,
        maxPages: FILL_MAX_PAGES,
        keep: rowFilter(returnRules, new Date()),
      })
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
  }, [cursor, loadingMore, query, member, excludeDates, returnRules, key])

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
