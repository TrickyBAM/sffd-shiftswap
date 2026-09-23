'use client'

import type { MonthSchedule, ScheduleDay } from '@/lib/schedule/effective'
import { cn, Skeleton } from '@/components/ui'
import { BarMark } from './BarMark'
import { dayAriaLabel, dayMarks } from './calendar-model'
import { CELL_TINT } from './tones'

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const

function WeekdayRow() {
  // Every day button carries its full date, so this row is visual only.
  return (
    <div aria-hidden="true" className="calendar-grid mb-1 gap-0.5 sm:gap-1">
      {WEEKDAYS.map((d) => (
        <div key={d} className="py-1 text-center text-xs font-semibold uppercase tracking-wide text-fg-dim">
          {d}
        </div>
      ))}
    </div>
  )
}

export interface MonthGridProps {
  month: MonthSchedule
  /** Accessible name of the grid, e.g. "September 2026". */
  label: string
  onSelect: (day: ScheduleDay) => void
}

/** 6 × 7 month grid, Sunday first. Each day is a button that opens the day sheet. */
export function MonthGrid({ month, label, onSelect }: MonthGridProps) {
  return (
    <div>
      <WeekdayRow />
      <div role="group" aria-label={label} className="space-y-0.5 sm:space-y-1">
        {month.weeks.map((week) => (
          <div key={week[0].ymd} className="calendar-grid gap-0.5 sm:gap-1">
            {week.map((day) => (
              <DayCell key={day.ymd} day={day} onSelect={onSelect} />
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}

function DayCell({ day, onSelect }: { day: ScheduleDay; onSelect: (day: ScheduleDay) => void }) {
  const marks = dayMarks(day)
  const dayNumber = Number(day.ymd.slice(8, 10))
  // Past days fade as a whole (the number stays about 5.5:1). Days from the
  // next/previous month keep a readable dim number (about 5.5:1, UX-13) and
  // only soften their marks.
  const pastFade = day.inMonth && day.isPast ? 'opacity-55' : undefined
  const marksFade = !day.inMonth ? 'opacity-70' : undefined

  return (
    <button
      type="button"
      onClick={() => onSelect(day)}
      aria-label={dayAriaLabel(day)}
      aria-current={day.isToday ? 'date' : undefined}
      className={cn(
        'relative flex min-h-14 min-w-0 flex-col items-stretch rounded-xl p-1 text-left transition-colors sm:min-h-[4.5rem] sm:p-1.5',
        'hover:bg-white/[0.06] active:bg-white/[0.08]',
        day.inMonth && !day.isPast ? CELL_TINT[day.tone] : undefined,
        marks.outlined && 'ring-2 ring-inset ring-cal-work',
      )}
    >
      <span className={cn('flex min-w-0 flex-1 flex-col', pastFade)}>
        <span
          className={cn(
            'flex h-6 w-6 items-center justify-center self-center rounded-full text-sm font-semibold sm:self-start',
            day.isToday ? 'bg-fg text-surface ring-2 ring-fg ring-offset-2 ring-offset-card' : 'text-fg',
            !day.inMonth && !day.isToday && 'text-fg-dim',
          )}
        >
          {dayNumber}
        </span>

        {marks.coveredBy ? (
          <span
            className={cn(
              'mt-0.5 truncate text-center text-[10px] font-semibold leading-3 text-sffd-red-text sm:text-left',
              marksFade,
            )}
          >
            {marks.coveredBy}
          </span>
        ) : null}

        <span className={cn('mt-auto flex flex-col gap-0.5 pt-1', marksFade)}>
          {marks.bars.map((bar, i) => (
            <BarMark key={`${bar.kind}-${i}`} kind={bar.kind} count={bar.count} className="w-full" />
          ))}
        </span>
      </span>
    </button>
  )
}

/** Placeholder grid with the same size as the real one. */
export function MonthGridSkeleton() {
  return (
    <div role="status" aria-live="polite">
      <span className="sr-only">Loading your calendar…</span>
      <WeekdayRow />
      <div aria-hidden="true" className="space-y-0.5 sm:space-y-1">
        {Array.from({ length: 6 }, (_, w) => (
          <div key={w} className="calendar-grid gap-0.5 sm:gap-1">
            {Array.from({ length: 7 }, (_, d) => (
              <Skeleton key={d} className="min-h-14 rounded-xl sm:min-h-[4.5rem]" />
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}
