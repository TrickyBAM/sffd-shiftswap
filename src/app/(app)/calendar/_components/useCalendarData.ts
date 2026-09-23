'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { getShiftsByIds, listBoardShifts, listMyShiftsInRange, type BoardCursor, type Sb } from '@/lib/api'
import { toAppError, type AppError } from '@/lib/errors'
import { loadSnapshot, saveSnapshot } from '@/lib/offline-cache'
import { addDays, type Ymd } from '@/lib/sffd/dates'
import { createClient } from '@/lib/supabase/client'
import type { Shift } from '@/lib/types/database'
import {
  futurePart,
  indexShifts,
  missingPartnerIds,
  monthKey,
  POST_WINDOW_DAYS,
  toOpenShiftLite,
  visibleRange,
  type DateRange,
  type OpenShiftLite,
  type YearMonth,
} from './calendar-model'

/** The member whose calendar this is (a MyProfile fits). */
export interface CalendarViewer {
  id: string
  rank: string | null
  station: number | null
  battalion: number | null
  division: number | null
}

export interface CalendarData {
  /** My open/covered shifts dated inside the visible 6-week grid. */
  monthShifts: Shift[]
  /**
   * Open shifts inside the grid (today on) that pass the Board's "Only shifts
   * I can take" query, in every location. takeableCounts() turns them into the
   * blue counts.
   */
  open: OpenShiftLite[]
  /** My open/covered shifts from today through the next 180 days ("Coming up"). */
  upcomingShifts: Shift[]
  /** SwapMatch partner legs of the rows above that fall outside both ranges. */
  related: Shift[]
}

export interface CalendarEntry {
  data: CalendarData
  /** ISO time the data was loaded (or the snapshot was saved). */
  loadedAt: string
  /** True when this is an offline snapshot rather than live data. */
  offline: boolean
}

export interface CalendarState {
  /** Data for the requested month, live or from the offline snapshot. */
  entry: CalendarEntry | null
  /**
   * `entry`, or while it loads the last month that did load. Its upcoming
   * shifts don't depend on the month, so "Coming up" can stay on screen.
   */
  latest: CalendarEntry | null
  /** First load of this month still running. */
  loading: boolean
  /** Load failed and there is no snapshot to fall back on. */
  error: AppError | null
  /** A reload (retry or live update) is running. */
  reloading: boolean
  /** Refetch everything now; months not on screen are dropped and reloaded when shown. */
  reload: () => void
  /**
   * Refetch only the open shifts behind the blue counts (someone else posted,
   * took or withdrew a shift). Falls back to reload() while there is no live
   * data for this month.
   */
  reloadOpen: () => void
}

const SNAPSHOT_KEY = 'calendar'

/** Open shifts per page, and the most pages one load reads (about the old 1000-row cap). */
const OPEN_PAGE_SIZE = 100
const OPEN_MAX_PAGES = 10

interface CalendarSnapshot extends CalendarData {
  month: string
}

/**
 * The open shifts I could request dated in `range`: listBoardShifts() with
 * `eligibleFor` (open, not started, my rank, not mine, within the post's
 * accept limit) and no location filter — the Board opened with scope=all.
 */
async function fetchOpenShifts(sb: Sb, viewer: CalendarViewer, range: DateRange | null): Promise<OpenShiftLite[]> {
  if (!range || !viewer.rank) return []
  const out: OpenShiftLite[] = []
  let after: BoardCursor | null = null
  for (let i = 0; i < OPEN_MAX_PAGES; i += 1) {
    const page = await listBoardShifts(
      sb,
      { from: range.from, to: range.to, eligibleFor: viewer },
      { limit: OPEN_PAGE_SIZE, after },
    )
    for (const shift of page.items) out.push(toOpenShiftLite(shift))
    if (!page.nextCursor) break
    after = page.nextCursor
  }
  return out
}

async function fetchCalendar(sb: Sb, viewer: CalendarViewer, ym: YearMonth, today: Ymd): Promise<CalendarData> {
  const range = visibleRange(ym)
  const [monthShifts, open, upcomingShifts] = await Promise.all([
    listMyShiftsInRange(sb, { ...range, userId: viewer.id }),
    fetchOpenShifts(sb, viewer, futurePart(range, today)),
    listMyShiftsInRange(sb, { from: today, to: addDays(today, POST_WINDOW_DAYS), userId: viewer.id }),
  ])
  // The other leg of a SwapMatch may fall outside both ranges; it only adds
  // detail ("you work Mike's shift on Oct 14"), so it's best effort.
  const known = indexShifts(monthShifts, upcomingShifts)
  const missing = missingPartnerIds([...known.values()], known)
  let related: Shift[] = []
  if (missing.length) {
    try {
      related = await getShiftsByIds(sb, missing)
    } catch {
      related = []
    }
  }
  return { monthShifts, open, upcomingShifts, related }
}

function isSnapshot(value: unknown): value is CalendarSnapshot {
  const v = value as Partial<CalendarSnapshot> | null
  return (
    typeof v === 'object' &&
    v !== null &&
    Array.isArray(v.monthShifts) &&
    Array.isArray(v.upcomingShifts) &&
    Array.isArray(v.related) &&
    Array.isArray(v.open)
  )
}

/**
 * The snapshot may be from another month: every shift it knows about is
 * offered to the grid (days outside the month are ignored), so tour days and
 * known trades still show for any month while offline.
 */
function entryFromSnapshot(snapshot: CalendarSnapshot, savedAt: string): CalendarEntry {
  const all = [...indexShifts(snapshot.monthShifts, snapshot.upcomingShifts, snapshot.related).values()]
  return {
    data: {
      monthShifts: all,
      open: snapshot.open,
      upcomingShifts: snapshot.upcomingShifts,
      related: snapshot.related,
    },
    loadedAt: savedAt,
    offline: true,
  }
}

/**
 * Loads my shifts for the visible month grid, the open shifts behind the blue
 * counts and my next 180 days. Months already seen show instantly and refresh
 * in the background. When a load fails the last snapshot is shown instead
 * (ARCHITECTURE §7.2 "Offline").
 */
export function useCalendarData(viewer: CalendarViewer, ym: YearMonth, today: Ymd): CalendarState {
  const key = monthKey(ym)
  const { id, rank, station, battalion, division } = viewer
  const { year, month } = ym
  const [entries, setEntries] = useState<Record<string, CalendarEntry>>({})
  const [failure, setFailure] = useState<{ key: string; error: AppError } | null>(null)
  const [lastKey, setLastKey] = useState<string | null>(null)
  const [token, setToken] = useState(0)
  const [reloading, setReloading] = useState(false)
  // Bumped whenever a full load starts, so an open-shift refresh that started
  // earlier can't overwrite the newer rows it brings.
  const generation = useRef(0)

  useEffect(() => {
    let active = true
    generation.current += 1
    const who: CalendarViewer = { id, rank, station, battalion, division }
    Promise.resolve()
      .then(() => fetchCalendar(createClient(), who, { year, month }, today))
      .then(
        (data) => {
          if (!active) return
          const loadedAt = new Date().toISOString()
          setEntries((prev) => ({ ...prev, [key]: { data, loadedAt, offline: false } }))
          setLastKey(key)
          setFailure(null)
          const snapshot: CalendarSnapshot = { month: key, ...data }
          saveSnapshot(SNAPSHOT_KEY, id, snapshot)
        },
        (err: unknown) => {
          if (!active) return
          const error = toAppError(err)
          if (error.code === 'NOT_SIGNED_IN') {
            setFailure({ key, error })
            return
          }
          setEntries((prev) => {
            const current = prev[key]
            // Keep what's on screen (it's at least as fresh as the snapshot), flagged offline.
            if (current) return { ...prev, [key]: { ...current, offline: true } }
            const snap = loadSnapshot<unknown>(SNAPSHOT_KEY, id)
            if (snap && isSnapshot(snap.data)) return { ...prev, [key]: entryFromSnapshot(snap.data, snap.savedAt) }
            return prev
          })
          setLastKey(key)
          setFailure({ key, error })
        },
      )
      .finally(() => {
        if (active) setReloading(false)
      })
    return () => {
      active = false
    }
  }, [key, year, month, today, token, id, rank, station, battalion, division])

  const reload = useCallback(() => {
    setReloading(true)
    // Other months may be stale now; drop them so they load fresh when shown.
    setEntries((prev) => (prev[key] ? { [key]: prev[key] } : {}))
    setToken((t) => t + 1)
  }, [key])

  const entry = entries[key] ?? null
  const live = Boolean(entry && !entry.offline)

  const reloadOpen = useCallback(() => {
    if (!live) {
      reload()
      return
    }
    const started = generation.current
    const who: CalendarViewer = { id, rank, station, battalion, division }
    Promise.resolve()
      .then(() => fetchOpenShifts(createClient(), who, futurePart(visibleRange({ year, month }), today)))
      .then(
        (open) => {
          if (started !== generation.current) return
          setEntries((prev) => {
            const current = prev[key]
            if (!current || current.offline) return prev
            return { ...prev, [key]: { ...current, data: { ...current.data, open } } }
          })
        },
        () => {
          // Keep the counts on screen; the next live update or reload tries again.
        },
      )
  }, [live, reload, key, year, month, today, id, rank, station, battalion, division])

  const failed = failure?.key === key ? failure.error : null
  return {
    entry,
    latest: entry ?? (lastKey ? (entries[lastKey] ?? null) : null),
    loading: !entry && !failed,
    error: entry ? null : failed,
    reloading,
    reload,
    reloadOpen,
  }
}
