'use client'

import { useCallback, useMemo, useRef, useState, type TouchEvent } from 'react'
import Link from 'next/link'
import { usePathname, useSearchParams } from 'next/navigation'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import AlertsNudge from '@/components/AlertsNudge'
import AppHeader from '@/components/AppHeader'
import { OfflineRibbon } from '@/components/OfflineRibbon'
import { useProfile } from '@/components/providers/ProfileProvider'
import { Button, buttonClasses, Card, ErrorState } from '@/components/ui'
import { useRealtimeRefetch } from '@/hooks/useRealtimeRefetch'
import { tourLabel } from '@/lib/format'
import { computeDay, computeDays, computeMonthDays } from '@/lib/schedule/effective'
import { addDays, formatMonth, monthOf, shiftMonth, type Ymd } from '@/lib/sffd/dates'
import { stationLabel } from '@/lib/sffd/stations'
import { BalanceCard } from './BalanceCard'
import { CalendarLegend } from './CalendarLegend'
import { ComingUpCard } from './ComingUpCard'
import { DaySheet } from './DaySheet'
import type { RefreshScope } from './live-refresh'
import { MonthGrid, MonthGridSkeleton } from './MonthGrid'
import { NoTourNote } from './NoTourNote'
import {
  comingUp,
  indexShifts,
  monthKey,
  parseMonthParam,
  POST_WINDOW_DAYS,
  takeableCounts,
  type DayContext,
  type TakeContext,
  type YearMonth,
} from './calendar-model'
import { useCalendarData } from './useCalendarData'
import { useClock } from './useClock'
import { useLiveRefresh } from './useLiveRefresh'

const MIN_MONTH: YearMonth = { year: 2019, month: 1 }
const MAX_MONTH: YearMonth = { year: 2100, month: 12 }
const SWIPE_MIN_PX = 60
/** Realtime events arriving this close together are one change (ms). */
const LIVE_DEBOUNCE_MS = 1000

function sameMonth(a: YearMonth, b: YearMonth): boolean {
  return a.year === b.year && a.month === b.month
}

function monthIndex({ year, month }: YearMonth): number {
  return year * 12 + month
}

/**
 * Home screen: my month at a glance, what's coming up and my balance.
 * The month shown is ?month=YYYY-MM (read with useSearchParams, so Back from
 * a trade returns to it); without it the calendar follows the current month.
 */
export function CalendarView() {
  const { profile } = useProfile()
  const { today, now } = useClock()
  const pathname = usePathname() ?? '/calendar'
  const searchParams = useSearchParams()
  const monthParam = searchParams.get('month')
  const picked = useMemo(() => parseMonthParam(monthParam), [monthParam])
  const current = useMemo(() => monthOf(today), [today])
  const ym = picked ?? current
  const onCurrentMonth = sameMonth(ym, current)

  const cal = useCalendarData(profile, ym, today)
  const [statsToken, setStatsToken] = useState(0)
  const [selectedYmd, setSelectedYmd] = useState<Ymd | null>(null)

  const { reload, reloadOpen } = cal
  const refreshAll = useCallback(() => {
    reload()
    setStatsToken((t) => t + 1)
  }, [reload])

  // Live updates (NEXT-03), never trusting payloads: a change to my own shifts
  // or requests reloads everything (and my balance); any other shift change
  // only reloads the open shifts behind the blue counts. Both go through a
  // throttle that merges bursts, spaces reloads out and waits while the app
  // is in the background.
  const requestLive = useLiveRefresh((scope: RefreshScope) => {
    if (scope === 'all') refreshAll()
    else reloadOpen()
  })
  useRealtimeRefetch([{ table: 'shifts' }], () => requestLive('open'), {
    debounceMs: LIVE_DEBOUNCE_MS,
    // Coming back to the app is handled by the "mine" subscription below.
    refetchOnResume: false,
    name: 'calendar-open',
  })
  useRealtimeRefetch(
    [
      { table: 'shifts', filter: `poster_id=eq.${profile.id}` },
      { table: 'shifts', filter: `coverer_id=eq.${profile.id}` },
      // Undoing a trade I cover clears coverer_id, but my accepted request changes too.
      { table: 'shift_requests', filter: `requester_id=eq.${profile.id}` },
    ],
    () => requestLive('all'),
    { debounceMs: LIVE_DEBOUNCE_MS, name: 'calendar-mine' },
  )

  const goTo = useCallback(
    (next: YearMonth | null) => {
      const params = new URLSearchParams(searchParams.toString())
      if (next) params.set('month', monthKey(next))
      else params.delete('month')
      const qs = params.toString()
      // Next.js syncs useSearchParams with the native History API: no server
      // round trip, and Back from a trade comes back to this month.
      window.history.replaceState(null, '', qs ? `${pathname}?${qs}` : pathname)
    },
    [pathname, searchParams],
  )

  const step = useCallback(
    (delta: number) => {
      const next = shiftMonth(ym.year, ym.month, delta)
      if (monthIndex(next) < monthIndex(MIN_MONTH) || monthIndex(next) > monthIndex(MAX_MONTH)) return
      goTo(sameMonth(next, current) ? null : next)
    },
    [ym, current, goTo],
  )

  // Swipe left/right on the grid to change month.
  const touchStart = useRef<{ x: number; y: number } | null>(null)
  const onTouchStart = (event: TouchEvent) => {
    const t = event.touches[0]
    touchStart.current = t ? { x: t.clientX, y: t.clientY } : null
  }
  const onTouchEnd = (event: TouchEvent) => {
    const start = touchStart.current
    touchStart.current = null
    const t = event.changedTouches[0]
    if (!start || !t) return
    const dx = t.clientX - start.x
    const dy = t.clientY - start.y
    if (Math.abs(dx) >= SWIPE_MIN_PX && Math.abs(dx) > Math.abs(dy) * 1.5) step(dx < 0 ? 1 : -1)
  }

  // The grid needs this month's data; "Coming up" and the day sheet can use the
  // last loaded month while a new one loads (upcoming shifts don't depend on it).
  const gridData = cal.entry?.data ?? null
  const data = cal.latest?.data ?? null
  const lookup = useMemo(
    () => (data ? indexShifts(data.monthShifts, data.upcomingShifts, data.related) : indexShifts()),
    [data],
  )
  const allShifts = useMemo(() => [...lookup.values()], [lookup])
  const ctx: DayContext = useMemo(() => ({ tour: profile.tour, today, now, lookup }), [profile.tour, today, now, lookup])

  // Blue counts: the Board's "Only shifts I can take" rules (TF-2, TF-3).
  const takeCtx: TakeContext = useMemo(
    () => ({ userId: profile.id, tour: profile.tour, myShifts: allShifts, now }),
    [profile.id, profile.tour, allShifts, now],
  )
  const gridCounts = useMemo(() => (gridData ? takeableCounts(gridData.open, takeCtx) : {}), [gridData, takeCtx])
  const counts = useMemo(() => (data ? takeableCounts(data.open, takeCtx) : {}), [data, takeCtx])

  const month = useMemo(
    () =>
      gridData
        ? computeMonthDays({
            userId: profile.id,
            tour: profile.tour,
            year: ym.year,
            month: ym.month,
            myShifts: allShifts,
            boardCounts: gridCounts,
            today,
          })
        : null,
    [gridData, gridCounts, allShifts, profile.id, profile.tour, ym.year, ym.month, today],
  )

  const upcoming = useMemo(() => {
    if (!data) return null
    const days = computeDays({
      userId: profile.id,
      tour: profile.tour,
      myShifts: allShifts,
      today,
      fromYmd: today,
      toYmd: addDays(today, POST_WINDOW_DAYS),
    })
    return comingUp(days, ctx, 5)
  }, [data, allShifts, profile.id, profile.tour, today, ctx])

  const selectedDay = useMemo(() => {
    if (!selectedYmd || !data) return null
    const inGrid = month?.weeks.flat().find((d) => d.ymd === selectedYmd)
    return (
      inGrid ??
      computeDay({
        ymd: selectedYmd,
        userId: profile.id,
        tour: profile.tour,
        myShifts: allShifts,
        boardCounts: counts,
        today,
      })
    )
  }, [selectedYmd, data, month, allShifts, counts, profile.id, profile.tour, today])

  const title = formatMonth(ym.year, ym.month)
  const prev = shiftMonth(ym.year, ym.month, -1)
  const next = shiftMonth(ym.year, ym.month, 1)
  const subtitle = [tourLabel(profile.tour), profile.station != null ? stationLabel(profile.station) : null]
    .filter(Boolean)
    .join(' · ')

  return (
    <>
      <AppHeader title="Calendar" subtitle={subtitle} />

      <div className="mx-auto max-w-3xl space-y-4 px-4 pb-6 pt-4 md:px-6">
        {/* Push alerts are the core of trading; iPhone members only get the offer here (UX-03). */}
        <AlertsNudge />

        {profile.tour == null ? <NoTourNote userId={profile.id} /> : null}

        {cal.entry?.offline ? (
          <OfflineRibbon updatedAt={cal.entry.loadedAt} onRetry={refreshAll} retrying={cal.reloading} />
        ) : null}

        <Card as="section" padding="none" aria-labelledby="month-title" className="p-2 sm:p-4">
          {/* The longest name ("SEPTEMBER 2026") fits beside the buttons from 360 px up; on
              narrower screens the buttons wrap to their own row. The name is never cut off. */}
          <div className="mb-2 flex flex-wrap items-center gap-x-1 gap-y-1 px-1 sm:px-0">
            <h2
              id="month-title"
              aria-live="polite"
              className="mr-auto whitespace-nowrap font-display text-[1.375rem] leading-none tracking-wide text-fg min-[400px]:text-[1.75rem] sm:text-3xl"
            >
              {title}
            </h2>
            <div className="ml-auto flex items-center gap-1">
              <Button variant="secondary" size="sm" onClick={() => goTo(null)} disabled={onCurrentMonth}>
                Today
              </Button>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => step(-1)}
                aria-label={`Previous month, ${formatMonth(prev.year, prev.month)}`}
                disabled={monthIndex(prev) < monthIndex(MIN_MONTH)}
              >
                <ChevronLeft size={22} aria-hidden="true" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => step(1)}
                aria-label={`Next month, ${formatMonth(next.year, next.month)}`}
                disabled={monthIndex(next) > monthIndex(MAX_MONTH)}
              >
                <ChevronRight size={22} aria-hidden="true" />
              </Button>
            </div>
          </div>

          <div onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
            {month ? (
              <MonthGrid month={month} label={title} onSelect={(day) => setSelectedYmd(day.ymd)} />
            ) : cal.error ? (
              <ErrorState
                title="Couldn't load your calendar"
                message={cal.error.message}
                onRetry={refreshAll}
                retrying={cal.reloading}
                action={
                  cal.error.code === 'NOT_SIGNED_IN' ? (
                    <Link href="/login?next=/calendar" className={buttonClasses({ variant: 'primary' })}>
                      Sign in
                    </Link>
                  ) : undefined
                }
                className="my-2"
              />
            ) : (
              <MonthGridSkeleton />
            )}
          </div>

          <CalendarLegend className="mt-4 border-t border-line px-1 pt-3 sm:px-0" />
        </Card>

        <ComingUpCard
          items={upcoming}
          loading={!data && !cal.error}
          errorMessage={cal.error?.message ?? null}
          onRetry={refreshAll}
          retrying={cal.reloading}
          onOpenDay={setSelectedYmd}
        />

        <BalanceCard userId={profile.id} reloadToken={statsToken} />
      </div>

      <DaySheet
        day={selectedDay}
        ctx={ctx}
        offline={Boolean(cal.entry?.offline)}
        onClose={() => setSelectedYmd(null)}
      />
    </>
  )
}
