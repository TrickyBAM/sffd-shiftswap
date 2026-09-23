'use client'

import type { ReactNode } from 'react'
import { Field } from '@/components/ui/Field'
import { Select } from '@/components/ui/Input'
import { cn } from '@/components/ui/cn'
import {
  formatDate,
  formatMonth,
  monthGrid,
  monthOf,
  shiftMonth,
  todayPT,
  type Ymd,
} from '@/lib/sffd/dates'
import { TOURS, isTour, nextTourDays, tourWorks } from '@/lib/sffd/tours'

export const NO_TOUR_LABEL = 'No tour (relief, detail, 40-hour)'

const NONE_VALUE = 'none'

export interface TourPickerProps {
  /**
   * 1–31, or null for "No tour" (when allowNone). Pass undefined to show a
   * "Choose your tour" placeholder until the member picks one — use it when
   * "not chosen yet" must stay different from "No tour".
   */
  value: number | null | undefined
  onChange: (tour: number | null) => void
  /** Adds "No tour (relief, detail, 40-hour)", reported as null. */
  allowNone?: boolean
  /** Shows the next two months of this tour's work days (red) under the select. */
  showPreview?: boolean
  disabled?: boolean
  /** Id of the <select>. Generated when omitted. */
  id?: string
  /** Visible label. Defaults to "Tour". */
  label?: string
  hint?: ReactNode
  /** Validation message; also marks the select invalid. */
  error?: string
  className?: string
}

/**
 * SFFD tour selector (ARCHITECTURE §4): Tour 1–31, optionally "No tour", with an
 * optional two-month preview of the chosen tour's work days starting this month.
 *
 * Renders its own label; don't wrap it in a <Field>.
 */
export function TourPicker({
  value,
  onChange,
  allowNone = false,
  showPreview = false,
  disabled = false,
  id,
  label = 'Tour',
  hint,
  error,
  className,
}: TourPickerProps) {
  let selected = ''
  if (isTour(value)) selected = String(value)
  else if (value === null && allowNone) selected = NONE_VALUE
  const chosen = selected !== ''

  return (
    <div className={cn('space-y-3', className)}>
      <Field label={label} id={id} hint={hint} error={error}>
        <Select
          value={selected}
          disabled={disabled}
          onChange={(event) => {
            const raw = event.target.value
            if (raw === NONE_VALUE) {
              if (allowNone) onChange(null)
              return
            }
            const tour = Number(raw)
            if (isTour(tour)) onChange(tour)
          }}
        >
          {!chosen ? (
            <option value="" disabled>
              Choose your tour
            </option>
          ) : null}
          {allowNone ? <option value={NONE_VALUE}>{NO_TOUR_LABEL}</option> : null}
          {TOURS.map((tour) => (
            <option key={tour} value={tour}>
              Tour {tour}
            </option>
          ))}
        </Select>
      </Field>

      {showPreview ? (
        <TourPreview tour={isTour(value) ? value : chosen ? null : undefined} />
      ) : null}
    </div>
  )
}

export interface TourPreviewProps {
  /** A tour 1–31; null = "No tour"; undefined = nothing chosen yet. */
  tour: number | null | undefined
  /** First month shown is the month of this date. Defaults to today in San Francisco. */
  from?: Ymd
  className?: string
}

/** Two mini calendars (this month and next) with the tour's work days in red. */
export function TourPreview({ tour, from, className }: TourPreviewProps) {
  const frame = cn('rounded-2xl border border-line bg-elevated/60 p-3', className)

  if (tour === undefined) {
    return (
      <p className={cn(frame, 'text-sm text-fg-muted')}>
        Pick your tour to see its work days here.
      </p>
    )
  }
  if (tour === null || !isTour(tour)) {
    return (
      <p className={cn(frame, 'text-sm text-fg-muted')}>
        No tour: ShiftSwap won&apos;t assume a schedule for you. You&apos;ll pick specific dates when you
        post a shift.
      </p>
    )
  }

  const today = from ?? todayPT()
  const first = monthOf(today)
  const second = shiftMonth(first.year, first.month, 1)
  const upcoming = nextTourDays(tour, today, 3)

  return (
    <div className={frame}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-semibold text-fg">Tour {tour} work days</p>
        <p className="flex items-center gap-1.5 text-xs text-fg-muted">
          <span aria-hidden="true" className="inline-block h-3 w-3 rounded-sm bg-cal-work" />
          Working
        </p>
      </div>
      <p className="mt-1 text-sm text-fg-muted">
        Next shifts: {upcoming.map((d) => formatDate(d, 'weekday')).join(' · ')}
      </p>
      <div className="mt-3 grid grid-cols-2 gap-3">
        <MiniMonth year={first.year} month={first.month} tour={tour} today={today} />
        <MiniMonth year={second.year} month={second.month} tour={tour} today={today} />
      </div>
    </div>
  )
}

const WEEKDAY_INITIALS = ['S', 'M', 'T', 'W', 'T', 'F', 'S']

interface MiniMonthProps {
  year: number
  month: number
  tour: number
  today: Ymd
}

function MiniMonth({ year, month, tour, today }: MiniMonthProps) {
  const weeks = monthGrid(year, month)
  const workDays = weeks.flat().filter((d) => d.inMonth && tourWorks(tour, d.ymd))
  const title = formatMonth(year, month)

  return (
    <div className="min-w-0">
      <p className="mb-1 text-center text-xs font-semibold text-fg">{title}</p>
      {/* Screen readers get the dates as text; the grid is visual only. */}
      <p className="sr-only">
        {title}: working {workDays.map((d) => formatDate(d.ymd, 'short')).join(', ')}.
      </p>
      <div aria-hidden="true" className="calendar-grid gap-0.5 text-center text-[11px] leading-none">
        {WEEKDAY_INITIALS.map((initial, i) => (
          <span key={i} className="pb-1 text-fg-dim">
            {initial}
          </span>
        ))}
        {weeks.flat().map((day) => {
          if (!day.inMonth) return <span key={day.ymd} />
          const works = tourWorks(tour, day.ymd)
          const isToday = day.ymd === today
          const past = day.ymd < today
          return (
            <span
              key={day.ymd}
              className={cn(
                'flex aspect-square items-center justify-center rounded-[5px] tabular-nums',
                works ? 'bg-cal-work font-semibold text-white' : 'text-fg-muted',
                isToday && 'ring-1 ring-fg',
                past && 'opacity-50',
              )}
            >
              {Number(day.ymd.slice(8, 10))}
            </span>
          )
        })}
      </div>
    </div>
  )
}

export default TourPicker
