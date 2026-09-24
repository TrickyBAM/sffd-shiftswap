'use client'

import { useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight, Search } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Sheet } from '@/components/ui/Sheet'
import { cn } from '@/components/ui/cn'
import { formatDate, formatMonth, monthGrid, monthOf, shiftMonth, todayPT, type Ymd } from '@/lib/sffd/dates'
import { disambiguatingDay, findTour, nextTourDays, tourWorks } from '@/lib/sffd/tours'

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

export interface TourFinderProps {
  /** Called with the tour the member confirmed. */
  onFound: (tour: number) => void
  /** Called when the member says they aren't on a numbered tour. Omit to hide that option. */
  onNoTour?: () => void
  disabled?: boolean
  className?: string
}

/**
 * "Don't know your tour?" — the member taps days they worked their regular
 * shift; we match them against the 31 real SFFD tours (never inventing a
 * pattern) and, when several tours still fit, ask "Did you work <day>?" about
 * the day that best tells them apart.
 */
export function TourFinder({ onFound, onNoTour, disabled = false, className }: TourFinderProps) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        icon={<Search aria-hidden="true" className="h-4 w-4" />}
        disabled={disabled}
        onClick={() => setOpen(true)}
        className={className}
      >
        Don&apos;t know your tour? Find it from days you worked
      </Button>
      {open ? (
        <TourFinderSheet
          onClose={() => setOpen(false)}
          onFound={(tour) => {
            setOpen(false)
            onFound(tour)
          }}
          onNoTour={
            onNoTour
              ? () => {
                  setOpen(false)
                  onNoTour()
                }
              : undefined
          }
        />
      ) : null}
    </>
  )
}

interface SheetProps {
  onClose: () => void
  onFound: (tour: number) => void
  onNoTour?: () => void
}

function TourFinderSheet({ onClose, onFound, onNoTour }: SheetProps) {
  const [today] = useState(() => todayPT())
  const [view, setView] = useState(() => monthOf(today))
  const [worked, setWorked] = useState<Ymd[]>([])
  const [notWorked, setNotWorked] = useState<Ymd[]>([])

  const result = useMemo(() => findTour(worked, notWorked), [worked, notWorked])
  const question = useMemo(
    () => (result.kind === 'ambiguous' ? disambiguatingDay(result.candidates, today, [...worked, ...notWorked]) : null),
    [result, today, worked, notWorked],
  )
  const found = result.kind === 'exact' || result.kind === 'closest' ? result.tour : null

  function toggle(day: Ymd) {
    setNotWorked((list) => list.filter((d) => d !== day))
    setWorked((list) => (list.includes(day) ? list.filter((d) => d !== day) : [...list, day]))
  }

  function answer(day: Ymd, didWork: boolean) {
    if (didWork) {
      setNotWorked((list) => list.filter((d) => d !== day))
      setWorked((list) => (list.includes(day) ? list : [...list, day]))
    } else {
      setWorked((list) => list.filter((d) => d !== day))
      setNotWorked((list) => (list.includes(day) ? list : [...list, day]))
    }
  }

  function reset() {
    setWorked([])
    setNotWorked([])
  }

  const weeks = monthGrid(view.year, view.month)
  const current = monthOf(today)
  const atCurrent = view.year === current.year && view.month === current.month

  return (
    <Sheet
      open
      onClose={onClose}
      title="Find your tour"
      description="Tap days you worked your regular shift (not trades or overtime). Two or three days from the last month or two is usually enough."
      footer={
        found != null ? (
          <Button fullWidth onClick={() => onFound(found)}>
            Use Tour {found}
          </Button>
        ) : (
          <Button fullWidth variant="secondary" onClick={onClose}>
            Close
          </Button>
        )
      }
    >
      <div className="space-y-4">
        <div className="rounded-2xl border border-line bg-elevated/60 p-3">
          <div className="mb-2 flex items-center justify-between">
            <button
              type="button"
              className="flex h-11 w-11 items-center justify-center rounded-xl text-fg-muted hover:bg-white/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-blue"
              aria-label="Previous month"
              onClick={() => setView((v) => shiftMonth(v.year, v.month, -1))}
            >
              <ChevronLeft aria-hidden="true" className="h-5 w-5" />
            </button>
            <p className="font-display text-xl tracking-wide text-fg">{formatMonth(view.year, view.month)}</p>
            <button
              type="button"
              className="flex h-11 w-11 items-center justify-center rounded-xl text-fg-muted hover:bg-white/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-blue disabled:opacity-30"
              aria-label="Next month"
              disabled={atCurrent}
              onClick={() => setView((v) => shiftMonth(v.year, v.month, 1))}
            >
              <ChevronRight aria-hidden="true" className="h-5 w-5" />
            </button>
          </div>
          <div className="calendar-grid gap-1 text-center">
            {WEEKDAYS.map((d) => (
              <span key={d} aria-hidden="true" className="pb-1 text-[11px] font-semibold uppercase text-fg-dim">
                {d}
              </span>
            ))}
            {weeks.flat().map((day) => {
              if (!day.inMonth) return <span key={day.ymd} aria-hidden="true" />
              const future = day.ymd > today
              const picked = worked.includes(day.ymd)
              const off = notWorked.includes(day.ymd)
              const predicted = found != null && !picked && tourWorks(found, day.ymd)
              return (
                <button
                  key={day.ymd}
                  type="button"
                  disabled={future}
                  aria-pressed={picked}
                  aria-label={`${formatDate(day.ymd, 'long')}${picked ? ', worked' : ''}${predicted ? `, Tour ${found} works this day` : ''}`}
                  onClick={() => toggle(day.ymd)}
                  className={cn(
                    'flex aspect-square min-h-[40px] items-center justify-center rounded-lg text-sm tabular-nums transition-colors',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-blue',
                    picked
                      ? 'bg-cal-work font-bold text-white'
                      : predicted
                        ? 'text-fg ring-2 ring-inset ring-cal-work/70'
                        : 'text-fg-muted hover:bg-white/5',
                    off && 'line-through opacity-60',
                    future && 'opacity-30',
                  )}
                >
                  {Number(day.ymd.slice(8, 10))}
                </button>
              )
            })}
          </div>
          <p className="mt-2 text-xs text-fg-dim">
            Filled red = days you tapped.{found != null ? ` Outlined = Tour ${found}'s other shifts — they should look familiar.` : ''}
          </p>
        </div>

        <div role="status" aria-live="polite" className="rounded-2xl border border-line bg-card p-4">
          <FinderResult result={result} today={today} />
          {result.kind === 'ambiguous' && question ? (
            <div className="mt-3 space-y-2">
              <p className="text-sm font-semibold text-fg">Did you work {formatDate(question, 'weekday')}?</p>
              <div className="grid grid-cols-2 gap-2">
                <Button type="button" variant="secondary" onClick={() => answer(question, true)}>
                  Yes, I worked
                </Button>
                <Button type="button" variant="secondary" onClick={() => answer(question, false)}>
                  No, I was off
                </Button>
              </div>
            </div>
          ) : null}
          {worked.length + notWorked.length > 0 ? (
            <button type="button" onClick={reset} className="mt-3 text-sm font-semibold text-accent-blue underline-offset-2 hover:underline">
              Start over
            </button>
          ) : null}
        </div>

        {onNoTour && result.kind === 'none' ? (
          <Button type="button" variant="secondary" fullWidth onClick={onNoTour}>
            I&apos;m not on a numbered tour
          </Button>
        ) : null}
      </div>
    </Sheet>
  )
}

function FinderResult({ result, today }: { result: ReturnType<typeof findTour>; today: Ymd }) {
  switch (result.kind) {
    case 'empty':
      return <p className="text-sm text-fg-muted">Tap a day you worked to start.</p>
    case 'ambiguous':
      return (
        <p className="text-sm text-fg-muted">
          {result.days === 1 ? 'That day fits' : 'Those days fit'} {result.candidates.length} tours (
          {result.candidates.map((t) => `Tour ${t}`).join(', ')}). Tap another day you worked, or answer the question
          below.
        </p>
      )
    case 'exact':
      return (
        <div className="space-y-1">
          <p className="font-display text-2xl tracking-wide text-fg">You&apos;re on Tour {result.tour}</p>
          <p className="text-sm text-fg-muted">
            {result.days === 1 ? 'Your day matches' : `All ${result.days} of your days match`} Tour {result.tour} and no
            other tour.
          </p>
          <p className="text-sm text-fg-muted">
            Next shifts: {nextTourDays(result.tour, today, 4).map((d) => formatDate(d, 'weekday')).join(' · ')}
          </p>
        </div>
      )
    case 'closest':
      return (
        <div className="space-y-1">
          <p className="font-display text-2xl tracking-wide text-fg">Probably Tour {result.tour}</p>
          <p className="text-sm text-fg-muted">
            {result.matched} of {result.days} days match Tour {result.tour}. One day doesn&apos;t fit — was it a trade or
            overtime? Tap it again to remove it if so.
          </p>
        </div>
      )
    case 'none':
      return (
        <p className="text-sm text-fg-muted">
          These days don&apos;t follow any regular SFFD tour. Check for a trade or overtime day you tapped by mistake —
          or, if you work relief, a detail or a 40-hour schedule, you aren&apos;t on a numbered tour.
        </p>
      )
  }
}

export default TourFinder
