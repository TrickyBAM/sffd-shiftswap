'use client'

import { useCallback, useEffect, useState } from 'react'
import { countOpenShiftsByDate, getShiftsByIds, listMyShiftsInRange, type Sb } from '@/lib/api'
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
  visibleRange,
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
  /** Open shifts I could request, per date, inside the grid (today on). */
  counts: Record<Ymd, number>
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
  /** Refetch now; months not on screen are dropped and reloaded when shown. */
  reload: () => void
}

const SNAPSHOT_KEY = 'calendar'

interface CalendarSnapshot extends CalendarData {
  month: string
}

async function fetchCalendar(sb: Sb, viewer: CalendarViewer, ym: YearMonth, today: Ymd): Promise<CalendarData> {
  const range = visibleRange(ym)
  const ahead = futurePart(range, today)
  const [monthShifts, counts, upcomingShifts] = await Promise.all([
    listMyShiftsInRange(sb, { ...range, userId: viewer.id }),
    ahead ? countOpenShiftsByDate(sb, { ...ahead, viewer }) : Promise.resolve<Record<Ymd, number>>({}),
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
  return { monthShifts, counts, upcomingShifts, related }
}

function isSnapshot(value: unknown): value is CalendarSnapshot {
  const v = value as Partial<CalendarSnapshot> | null
  return (
    typeof v === 'object' &&
    v !== null &&
    Array.isArray(v.monthShifts) &&
    Array.isArray(v.upcomingShifts) &&
    Array.isArray(v.related) &&
    typeof v.counts === 'object' &&
    v.counts !== null
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
      counts: snapshot.counts,
      upcomingShifts: snapshot.upcomingShifts,
      related: snapshot.related,
    },
    loadedAt: savedAt,
    offline: true,
  }
}

/**
 * Loads my shifts for the visible month grid, the open-shift counts and my
 * next 180 days. Months already seen show instantly and refresh in the
 * background. When a load fails the last snapshot is shown instead
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

  useEffect(() => {
    let active = true
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
  const failed = failure?.key === key ? failure.error : null
  return {
    entry,
    latest: entry ?? (lastKey ? (entries[lastKey] ?? null) : null),
    loading: !entry && !failed,
    error: entry ? null : failed,
    reloading,
    reload,
  }
}
