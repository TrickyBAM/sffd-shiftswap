'use client'

import { useId, useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { Button, cn } from '@/components/ui'
import { formatDate, formatMonth, monthGrid, shiftMonth, type Ymd } from '@/lib/sffd/dates'

export interface YearMonth {
  year: number
  /** 1–12 */
  month: number
}

/** How one day of the picker behaves and looks. */
export interface PickerDay {
  /** 'pick' = can be chosen; 'blocked' = shown with a reason, can't be chosen; 'plain' = just a date. */
  kind: 'pick' | 'blocked' | 'plain'
  /** Visual hint for blocked days: I'm working (red bar) or it's the shift being posted (orange ring). */
  mark?: 'work' | 'post'
  /** Read out for blocked days ("already posted"). */
  reason?: string
}

export interface MonthPickerProps {
  /** Accessible name of the day buttons group. */
  label: string
  today: Ymd
  /** First and last month the member can page to. */
  first: YearMonth
  last: YearMonth
  /** Month shown first (clamped to first…last). */
  initialMonth?: YearMonth | null
  /** When this changes (e.g. a day was picked elsewhere), the picker jumps to that month. */
  followMonth?: YearMonth | null
  selected: readonly Ymd[]
  onToggle: (ymd: Ymd) => void
  describeDay: (ymd: Ymd) => PickerDay
  /** 'date': my tour days in red, the pick solid red. 'return': my days off, picks in purple. */
  variant: 'date' | 'return'
  /** Ids of hint/error text for the group. */
  describedBy?: string
  invalid?: boolean
  className?: string
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const

function index({ year, month }: YearMonth): number {
  return year * 12 + month
}

function clamp(ym: YearMonth, first: YearMonth, last: YearMonth): YearMonth {
  if (index(ym) < index(first)) return first
  if (index(ym) > index(last)) return last
  return ym
}

/** A one-month mini calendar with prev/next, for picking one or several days. */
export function MonthPicker({
  label,
  today,
  first,
  last,
  initialMonth,
  followMonth,
  selected,
  onToggle,
  describeDay,
  variant,
  describedBy,
  invalid = false,
  className,
}: MonthPickerProps) {
  const titleId = useId()
  const [picked, setPicked] = useState<YearMonth>(() => clamp(followMonth ?? initialMonth ?? first, first, last))
  // Jump to a month chosen from outside (adjusting state while rendering, as React recommends).
  const followKey = followMonth ? index(followMonth) : null
  const [lastFollowKey, setLastFollowKey] = useState(followKey)
  if (followKey !== lastFollowKey) {
    setLastFollowKey(followKey)
    if (followMonth) setPicked(followMonth)
  }
  // Stay inside the allowed months even when "today" rolls over.
  const shown = clamp(picked, first, last)
  const prev = shiftMonth(shown.year, shown.month, -1)
  const next = shiftMonth(shown.year, shown.month, 1)
  const canPrev = index(prev) >= index(first)
  const canNext = index(next) <= index(last)
  const chosen = new Set(selected)
  const title = formatMonth(shown.year, shown.month)

  return (
    <div className={cn('rounded-2xl border border-line bg-elevated/50 p-2', invalid && 'border-sffd-red-text/70', className)}>
      <div className="mb-1 flex items-center gap-1">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setPicked(prev)}
          disabled={!canPrev}
          aria-label={`Previous month, ${formatMonth(prev.year, prev.month)}`}
        >
          <ChevronLeft size={20} aria-hidden="true" />
        </Button>
        <h3 id={titleId} aria-live="polite" className="min-w-0 flex-1 text-center font-display text-xl leading-none text-fg">
          {title}
        </h3>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setPicked(next)}
          disabled={!canNext}
          aria-label={`Next month, ${formatMonth(next.year, next.month)}`}
        >
          <ChevronRight size={20} aria-hidden="true" />
        </Button>
      </div>

      <div aria-hidden="true" className="calendar-grid">
        {WEEKDAYS.map((d) => (
          <span key={d} className="pb-1 text-center text-[11px] font-semibold uppercase tracking-wide text-fg-dim">
            {d}
          </span>
        ))}
      </div>

      <div
        role="group"
        aria-label={`${label}, ${title}`}
        aria-describedby={describedBy}
        className="calendar-grid"
      >
        {monthGrid(shown.year, shown.month)
          .flat()
          .map(({ ymd, inMonth }) => {
            if (!inMonth) return <span key={ymd} aria-hidden="true" />
            return (
              <DayButton
                key={ymd}
                ymd={ymd}
                info={describeDay(ymd)}
                selected={chosen.has(ymd)}
                isToday={ymd === today}
                variant={variant}
                onToggle={onToggle}
              />
            )
          })}
      </div>
    </div>
  )
}

interface DayButtonProps {
  ymd: Ymd
  info: PickerDay
  selected: boolean
  isToday: boolean
  variant: MonthPickerProps['variant']
  onToggle: (ymd: Ymd) => void
}

function DayButton({ ymd, info, selected, isToday, variant, onToggle }: DayButtonProps) {
  const number = Number(ymd.slice(8, 10))
  const long = `${formatDate(ymd, 'long')}${isToday ? ', today' : ''}`
  const todayMark = isToday && 'underline decoration-2 underline-offset-[3px]'

  if (info.kind === 'plain' && !selected) {
    return (
      <span aria-hidden="true" className={cn('flex h-11 items-center justify-center text-sm text-fg-dim/70', todayMark)}>
        {number}
      </span>
    )
  }

  if (info.kind === 'blocked' && !selected) {
    return (
      <button
        type="button"
        disabled
        aria-label={info.reason ? `${long}: ${info.reason}` : long}
        className="flex h-11 flex-col items-center justify-center"
      >
        <span
          className={cn(
            'flex h-9 w-9 flex-col items-center justify-center rounded-lg text-sm tabular-nums',
            info.mark === 'post'
              ? 'font-semibold text-fg ring-2 ring-inset ring-cal-open'
              : info.mark === 'work'
                ? 'text-fg-muted'
                : 'text-fg-dim line-through',
            todayMark,
          )}
        >
          {number}
          {info.mark === 'work' ? <span aria-hidden="true" className="mt-0.5 h-1 w-4 rounded-full bg-cal-work" /> : null}
        </span>
      </button>
    )
  }

  // Pickable, or selected (a selected day always stays tappable so it can be removed).
  return (
    <button
      type="button"
      aria-pressed={selected}
      aria-label={long}
      onClick={() => onToggle(ymd)}
      className="group flex h-11 items-center justify-center rounded-lg"
    >
      <span
        className={cn(
          'flex h-9 w-9 items-center justify-center rounded-lg text-sm font-semibold tabular-nums transition-colors',
          variant === 'date'
            ? selected
              ? 'bg-sffd-red text-white shadow-[0_2px_12px_rgba(211,47,47,0.45)]'
              : 'bg-cal-work/15 text-fg ring-1 ring-inset ring-cal-work/70 group-hover:bg-cal-work/30'
            : selected
              ? 'bg-cal-swap text-white shadow-[0_2px_12px_rgba(156,106,255,0.4)]'
              : 'bg-raised text-fg ring-1 ring-inset ring-line-strong group-hover:bg-white/[0.12]',
          todayMark,
        )}
      >
        {number}
      </span>
    </button>
  )
}
