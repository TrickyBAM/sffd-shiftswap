'use client'

import { useCallback, useMemo, useRef, useState, type TouchEvent } from 'react'
import Link from 'next/link'
import { ChevronLeft, ChevronRight, Info } from 'lucide-react'
import AppHeader from '@/components/AppHeader'
import { OfflineRibbon } from '@/components/OfflineRibbon'
import { useProfile } from '@/components/providers/ProfileProvider'
import { Button, buttonClasses, Card, ErrorState } from '@/components/ui'
import { useRealtimeRefetch } from '@/hooks/useRealtimeRefetch'
import { computeDay, computeDays, computeMonthDays } from '@/lib/schedule/effective'
import { addDays, formatMonth, monthOf, shiftMonth, type Ymd } from '@/lib/sffd/dates'
import { stationLabel } from '@/lib/sffd/stations'
import { BalanceCard } from './BalanceCard'
import { CalendarLegend } from './CalendarLegend'
import { ComingUpCard } from './ComingUpCard'
import { DaySheet } from './DaySheet'
import { MonthGrid, MonthGridSkeleton } from './MonthGrid'
import {
  comingUp,
  indexShifts,
  monthKey,
  parseMonthParam,
  POST_WINDOW_DAYS,
  type DayContext,
  type YearMonth,
} from './calendar-model'
import { useCalendarData } from './useCalendarData'
import { useClock } from './useClock'

const MIN_MONTH: YearMonth = { year: 2019, month: 1 }
const MAX_MONTH: YearMonth = { year: 2100, month: 12 }
const SWIPE_MIN_PX = 60

function sameMonth(a: YearMonth, b: YearMonth): boolean {
  return a.year === b.year && a.month === b.month
}

function monthIndex({ year, month }: YearMonth): number {
  return year * 12 + month
}

export interface CalendarViewProps {
  /** ?month=YYYY-MM from the URL (validated here). */
  initialMonth: string | null
}

/** Home screen: my month at a glance, what's coming up and my balance. */
export function CalendarView({ initialMonth }: CalendarViewProps) {
  const { profile } = useProfile()
  const { today, now } = useClock()
  // null = follow the current month (and roll over at midnight on the 1st).
  const [picked, setPicked] = useState<YearMonth | null>(() => parseMonthParam(initialMonth))
  const ym = picked ?? monthOf(today)
  const current = monthOf(today)
  const onCurrentMonth = sameMonth(ym, current)

  const cal = useCalendarData(profile, ym, today)
  const [statsToken, setStatsToken] = useState(0)
  const [selectedYmd, setSelectedYmd] = useState<Ymd | null>(null)

  const { reload } = cal
  const refreshAll = useCallback(() => {
    reload()
    setStatsToken((t) => t + 1)
  }, [reload])

  // Any change to shifts or requests can change my calendar; refetch (debounced), never trust payloads.
  useRealtimeRefetch([{ table: 'shifts' }, { table: 'shift_requests' }], refreshAll, {
    debounceMs: 800,
    name: 'calendar',
  })

  const goTo = useCallback((next: YearMonth | null) => {
    setPicked(next)
    // Keep the month in the URL so Back from a trade returns to it (no server round trip).
    window.history.replaceState(null, '', next ? `?month=${monthKey(next)}` : window.location.pathname)
  }, [])

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

  const month = useMemo(
    () =>
      gridData
        ? computeMonthDays({
            userId: profile.id,
            tour: profile.tour,
            year: ym.year,
            month: ym.month,
            myShifts: allShifts,
            boardCounts: gridData.counts,
            today,
          })
        : null,
    [gridData, allShifts, profile.id, profile.tour, ym.year, ym.month, today],
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
        boardCounts: data.counts,
        today,
      })
    )
  }, [selectedYmd, data, month, allShifts, profile.id, profile.tour, today])

  const title = formatMonth(ym.year, ym.month)
  const prev = shiftMonth(ym.year, ym.month, -1)
  const next = shiftMonth(ym.year, ym.month, 1)
  const subtitle = [
    profile.tour != null ? `Tour ${profile.tour}` : 'No tour',
    profile.station != null ? stationLabel(profile.station) : null,
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    <>
      <AppHeader title="Calendar" subtitle={subtitle} />

      <div className="mx-auto max-w-3xl space-y-4 px-4 pb-6 pt-4 md:px-6">
        {profile.tour == null ? (
          <Card className="flex items-start gap-3 border-accent-blue/30 bg-accent-blue/[0.06]" role="note">
            <Info size={20} aria-hidden="true" className="mt-0.5 shrink-0 text-accent-blue" />
            <div className="min-w-0 flex-1">
              <p className="text-[15px] text-fg">Add your tour in Profile to see your regular schedule.</p>
              <p className="mt-0.5 text-sm text-fg-muted">For now the calendar shows your trades and posts.</p>
              <Link
                href="/profile"
                className="mt-1 inline-flex min-h-11 items-center text-sm font-semibold text-accent-blue hover:underline"
              >
                Go to Profile
              </Link>
            </div>
          </Card>
        ) : null}

        {cal.entry?.offline ? (
          <OfflineRibbon updatedAt={cal.entry.loadedAt} onRetry={refreshAll} retrying={cal.reloading} />
        ) : null}

        <Card as="section" padding="none" aria-labelledby="month-title" className="p-2 sm:p-4">
          <div className="mb-2 flex items-center gap-1 px-1 sm:px-0">
            <h2
              id="month-title"
              aria-live="polite"
              className="min-w-0 flex-1 truncate font-display text-3xl leading-none tracking-wide text-fg"
            >
              {title}
            </h2>
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
