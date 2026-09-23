'use client'

import { useMemo, useState } from 'react'
import { usePathname, useSearchParams } from 'next/navigation'
import { CalendarDays, ClipboardList, SearchX, X } from 'lucide-react'
import { Button, EmptyState, ErrorState, LoadingBlock, useToast } from '@/components/ui'
import { OfflineRibbon } from '@/components/OfflineRibbon'
import { useProfile } from '@/components/providers/ProfileProvider'
import { useRealtimeRefetch } from '@/hooks/useRealtimeRefetch'
import { isUuid } from '@/lib/api'
import { formatDate, todayPT, type Ymd } from '@/lib/sffd/dates'
import type { Shift } from '@/lib/types/database'
import { toastActionError } from '../_lib/errors'
import {
  boardQueryKey,
  defaultBoardFilters,
  describeFilters,
  isAllLocations,
  parseDateParam,
  withAllLocations,
  type BoardFilterState,
  type BoardMember,
} from '../_lib/filters'
import { dayHeading, groupByDate, plural } from '../_lib/format'
import { useBoardData, type BoardQuery } from '../_lib/useBoardData'
import { BoardFilterBar } from './BoardFilterBar'
import { RequestSheet } from './RequestSheet'
import { ShiftCard } from './ShiftCard'

/**
 * Updates the query string without a server round trip (Next.js syncs
 * useSearchParams with the native History API) — works offline too.
 */
function replaceQuery(pathname: string, params: URLSearchParams) {
  const qs = params.toString()
  window.history.replaceState(null, '', qs ? `${pathname}?${qs}` : pathname)
}

/** The Board: filters, open shifts grouped by day, "Load more", and the request sheet. */
export function BoardView() {
  const { profile } = useProfile()
  const toast = useToast()
  const pathname = usePathname() ?? '/board'
  const searchParams = useSearchParams()
  const date = parseDateParam(searchParams.get('date'))
  const shiftParam = searchParams.get('shift')

  const member = useMemo<BoardMember>(
    () => ({
      id: profile.id,
      rank: profile.rank,
      station: profile.station,
      battalion: profile.battalion,
      division: profile.division,
      tour: profile.tour,
    }),
    [profile.id, profile.rank, profile.station, profile.battalion, profile.division, profile.tour],
  )
  const defaults = useMemo(() => defaultBoardFilters(member), [member])
  const [filters, setFilters] = useState<BoardFilterState>(defaults)
  const query = useMemo<BoardQuery>(() => ({ filters, date }), [filters, date])
  const board = useBoardData(member, query)

  useRealtimeRefetch(
    [{ table: 'shifts' }, { table: 'shift_requests', filter: `requester_id=eq.${profile.id}` }],
    board.refresh,
    { name: 'board', debounceMs: 600 },
  )

  // The request sheet: a tapped card, or ?shift=<id> from an alert or a link.
  const [picked, setPicked] = useState<Shift | null>(null)
  const paramShiftId = shiftParam && isUuid(shiftParam) ? shiftParam : null
  const sheetShiftId = picked?.id ?? paramShiftId
  const sheetSeed = picked ?? board.data?.items.find((s) => s.id === sheetShiftId) ?? null

  function closeSheet() {
    setPicked(null)
    if (searchParams.has('shift')) {
      const next = new URLSearchParams(searchParams.toString())
      next.delete('shift')
      replaceQuery(pathname, next)
    }
  }

  function showAllDates() {
    const next = new URLSearchParams(searchParams.toString())
    next.delete('date')
    replaceQuery(pathname, next)
  }

  async function loadMore() {
    try {
      await board.loadMore()
    } catch (err) {
      toastActionError(toast, err, "Couldn't load more shifts")
    }
  }

  const data = board.data
  const today = data ? todayPT(new Date(data.fetchedAt)) : null
  const groups = useMemo(() => groupByDate(data?.items ?? []), [data])
  const snapshotDiffers =
    board.snapshot != null &&
    boardQueryKey(board.snapshot.query.filters, board.snapshot.query.date) !== boardQueryKey(filters, date)

  return (
    <div className="space-y-4">
      <BoardFilterBar filters={filters} onChange={setFilters} defaults={defaults} memberRank={profile.rank} />

      {date ? (
        <div className="flex min-h-11 items-center justify-between gap-2 rounded-xl border border-accent-blue/30 bg-accent-blue/10 py-0.5 pl-3 pr-1">
          <span className="flex items-center gap-2 text-sm font-semibold text-fg">
            <CalendarDays size={16} aria-hidden="true" className="shrink-0 text-accent-blue" />
            Showing {formatDate(date, 'weekday')}
          </span>
          <button
            type="button"
            onClick={showAllDates}
            className="inline-flex min-h-11 items-center gap-1 rounded-lg px-3 text-sm font-semibold text-accent-blue hover:bg-white/[0.06]"
          >
            <X size={15} aria-hidden="true" />
            Show all
          </button>
        </div>
      ) : null}

      {board.snapshot ? (
        <div className="space-y-1.5">
          <OfflineRibbon updatedAt={board.snapshot.savedAt} onRetry={board.retry} retrying={board.retrying} />
          {snapshotDiffers ? (
            <p className="text-sm text-fg-muted">
              This is the last board you loaded ({describeFilters(board.snapshot.query.filters, profile.rank)}
              {board.snapshot.query.date ? `, ${formatDate(board.snapshot.query.date, 'weekday')}` : ''}). Your
              filters apply once you&apos;re back online.
            </p>
          ) : null}
        </div>
      ) : null}

      <p className="sr-only" aria-live="polite">
        {board.loading ? '' : data ? `${plural(data.items.length, 'open shift')} shown.` : ''}
      </p>

      {board.loading ? (
        <LoadingBlock label="Loading open shifts…" cards={3} />
      ) : board.error ? (
        <ErrorState
          title="Couldn't load the board"
          message={board.error.message}
          onRetry={board.retry}
          retrying={board.retrying}
        />
      ) : data && data.items.length === 0 ? (
        <BoardEmpty
          filters={filters}
          date={date}
          excludedDay={date != null && filters.onlyEligible && data.excludeDates.includes(date)}
          onAllLocations={() => setFilters(withAllLocations(filters))}
          onShowAllShifts={() => setFilters({ ...filters, onlyEligible: false })}
          onShowAllDates={showAllDates}
        />
      ) : data && today ? (
        <div className="space-y-5">
          {groups.map((group) => (
            <section key={group.date} aria-labelledby={`board-day-${group.date}`}>
              <h2
                id={`board-day-${group.date}`}
                className="sticky top-[calc(var(--safe-top)_+_4rem_+_1px)] z-10 -mx-4 mb-2 flex items-baseline justify-between gap-2 bg-surface/95 px-4 py-2 backdrop-blur-md md:-mx-6 md:px-6"
              >
                <span className="font-display text-xl tracking-wide text-fg">{dayHeading(group.date, today)}</span>
                <span className="text-xs text-fg-dim">{plural(group.items.length, 'shift')}</span>
              </h2>
              <ul className="space-y-3">
                {group.items.map((shift) => (
                  <ShiftCard
                    key={shift.id}
                    shift={shift}
                    isMine={shift.poster_id === profile.id}
                    myRequest={data.requests[shift.id] ?? null}
                    nowMs={data.fetchedAt}
                    onOpen={setPicked}
                  />
                ))}
              </ul>
            </section>
          ))}

          {data.nextCursor ? (
            <Button variant="secondary" fullWidth loading={board.loadingMore} onClick={loadMore}>
              Load more shifts
            </Button>
          ) : data.items.length > 3 ? (
            <p className="py-2 text-center text-sm text-fg-dim">That&apos;s every open shift that matches.</p>
          ) : null}
        </div>
      ) : null}

      {sheetShiftId ? (
        <RequestSheet
          key={sheetShiftId}
          shiftId={sheetShiftId}
          initialShift={sheetSeed}
          onClose={closeSheet}
          onChanged={board.refresh}
        />
      ) : null}
    </div>
  )
}

function BoardEmpty({
  filters,
  date,
  excludedDay,
  onAllLocations,
  onShowAllShifts,
  onShowAllDates,
}: {
  filters: BoardFilterState
  date: Ymd | null
  excludedDay: boolean
  onAllLocations: () => void
  onShowAllShifts: () => void
  onShowAllDates: () => void
}) {
  if (excludedDay && date) {
    return (
      <EmptyState
        icon={<CalendarDays size={28} />}
        title="You're on duty that day"
        description={`You're working (or already covering) on ${formatDate(date, 'weekday')}, so there's nothing there you can take.`}
        action={
          <div className="flex flex-wrap justify-center gap-2">
            <Button variant="secondary" onClick={onShowAllDates}>
              Show all dates
            </Button>
            <Button variant="ghost" onClick={onShowAllShifts}>
              Show shifts anyway
            </Button>
          </div>
        }
      />
    )
  }
  if (!isAllLocations(filters)) {
    return (
      <EmptyState
        icon={<SearchX size={28} />}
        title="No open shifts match"
        description={
          date
            ? `Nothing open on ${formatDate(date, 'weekday')} here. Try All battalions.`
            : 'Try All battalions to see shifts from the whole department.'
        }
        action={<Button onClick={onAllLocations}>Show all battalions</Button>}
      />
    )
  }
  if (filters.onlyEligible) {
    return (
      <EmptyState
        icon={<ClipboardList size={28} />}
        title="Nothing you can take right now"
        description="When someone posts a shift you can take, you'll get an alert. You can also look at every open shift."
        action={
          <Button variant="secondary" onClick={onShowAllShifts}>
            Show every open shift
          </Button>
        }
      />
    )
  }
  return (
    <EmptyState
      icon={<ClipboardList size={28} />}
      title="No open shifts"
      description={
        date ? `Nobody has posted a shift for ${formatDate(date, 'weekday')}.` : 'Nobody has a shift posted right now.'
      }
      action={
        date ? (
          <Button variant="secondary" onClick={onShowAllDates}>
            Show all dates
          </Button>
        ) : undefined
      }
    />
  )
}
