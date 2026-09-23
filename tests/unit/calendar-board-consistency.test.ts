// The calendar's blue "open shifts you could take" counts and the Board's
// "Only shifts I can take" must agree (TF-1, TF-2, TF-3): the calendar works
// from my shift rows (src/lib/schedule/effective.ts), the Board from
// my_schedule rows (board/_lib/eligibility.ts). This builds my_schedule rows
// from the same shifts the way the SQL does, then checks that both sides
// block the same days, allow the same SwapMatch return dates, and that "See N
// available shifts" opens the Board on the query the count was made from.

import { describe, expect, it } from 'vitest'
import {
  blockedReturnDates,
  busyDates,
  canGiveReturnDate as boardCanGive,
} from '@/app/(app)/board/_lib/eligibility'
import {
  defaultBoardFilters,
  initialBoardFilters,
  isAllLocations,
  isScopeAllParam,
  parseDateParam,
  toBoardApiFilters,
  type BoardMember,
} from '@/app/(app)/board/_lib/filters'
import {
  availableCount,
  boardDayHref,
  canGiveReturnDate as calendarCanGive,
  type TakeContext,
} from '@/app/(app)/calendar/_components/calendar-model'
import { computeDays, type ScheduleDay, type ScheduleShift } from '@/lib/schedule/effective'
import { addDays, eachDay, type Ymd } from '@/lib/sffd/dates'
import type { ScheduleRow } from '@/lib/types/database'

const ME = '00000000-0000-4000-8000-000000000001'
const MIKE = '00000000-0000-4000-8000-000000000002'
const ANA = '00000000-0000-4000-8000-000000000003'

// 2026-09-23 12:00 Pacific. Tour 2 works Sep 23, 26, 29, Oct 3, 6, 9, 13, 16, 19, …
const TODAY: Ymd = '2026-09-23'
const NOW = new Date('2026-09-23T19:00:00Z')
const TOUR = 2

function shift(id: number, over: Partial<ScheduleShift>): ScheduleShift {
  return {
    id: `10000000-0000-4000-8000-${String(id).padStart(12, '0')}`,
    poster_id: ME,
    poster_name: 'Me Myself',
    coverer_id: null,
    coverer_name: null,
    date: TODAY,
    shift_type: '24-Hour',
    status: 'open',
    return_leg_of: null,
    return_leg_id: null,
    ...over,
  }
}

const SWAP_ORIGINAL = shift(6, {
  date: '2026-10-19',
  status: 'covered',
  coverer_id: MIKE,
  coverer_name: 'Mike Lee',
  return_leg_id: '10000000-0000-4000-8000-000000000007',
})

const MY_SHIFTS: ScheduleShift[] = [
  // My tour day, only the PM given away: still on duty 0800–1600.
  shift(1, { date: '2026-10-03', shift_type: 'PM', status: 'covered', coverer_id: MIKE, coverer_name: 'Mike Lee' }),
  // My tour day, the whole 24-Hour given away: free.
  shift(2, { date: '2026-10-06', status: 'covered', coverer_id: MIKE, coverer_name: 'Mike Lee' }),
  // An off day where I cover Ana.
  shift(3, { date: '2026-10-07', poster_id: ANA, poster_name: 'Ana Cruz', status: 'covered', coverer_id: ME, coverer_name: 'Me Myself' }),
  // My tour day, posted and still open.
  shift(4, { date: '2026-10-09' }),
  // SwapMatch: Mike covers my Oct 19, I work his Oct 20.
  SWAP_ORIGINAL,
  shift(7, {
    date: '2026-10-20',
    poster_id: MIKE,
    poster_name: 'Mike Lee',
    status: 'covered',
    coverer_id: ME,
    coverer_name: 'Me Myself',
    return_leg_of: SWAP_ORIGINAL.id,
  }),
]

/** What public.my_schedule returns for a day (migration 0011). */
function toScheduleRow(day: ScheduleDay): ScheduleRow {
  return {
    date: day.ymd,
    base: day.base,
    given_away: day.givenAway != null,
    pm_given_away: day.pmGivenAway != null,
    picked_up: day.pickedUp != null,
    working: day.working,
    open_post_id: day.openPost?.shiftId ?? null,
    given_shift_id: day.givenAway?.shiftId ?? null,
    picked_shift_id: day.pickedUp?.shiftId ?? null,
    is_swap: day.swap,
  }
}

const DATES = eachDay(TODAY, addDays(TODAY, 60))

describe.each([
  { label: 'on a tour', tour: TOUR },
  { label: 'with no tour', tour: null },
])('calendar and Board agree for a member $label', ({ tour }) => {
  // One open shift on every day, so the calendar's count shows exactly where
  // its day rule lets it through.
  const counts = Object.fromEntries(DATES.map((d) => [d, 1]))
  const days = computeDays({ userId: ME, tour, myShifts: MY_SHIFTS, boardCounts: counts, today: TODAY, fromYmd: DATES[0], toYmd: DATES[DATES.length - 1] })
  const rows = days.map(toScheduleRow)
  const busy = new Set(busyDates(rows))
  const takeCtx: TakeContext = { userId: ME, tour, myShifts: MY_SHIFTS, now: NOW }
  const rules = { tour, blocked: blockedReturnDates(rows) }

  it('the blue count shows on exactly the days the Board does not leave out', () => {
    for (const day of days) {
      expect({ date: day.ymd, counted: availableCount(day) > 0 }).toEqual({ date: day.ymd, counted: !busy.has(day.ymd) })
    }
  })

  it('a PM give-away day is still a work day on both; a 24-Hour give-away day is free on both', () => {
    const pmDay = days.find((d) => d.ymd === '2026-10-03')!
    expect(pmDay.working).toBe(true)
    expect(availableCount(pmDay)).toBe(0)
    expect(busy.has('2026-10-03')).toBe(true)
    const fullDay = days.find((d) => d.ymd === '2026-10-06')!
    expect(fullDay.working).toBe(false)
    expect(availableCount(fullDay)).toBe(1)
    expect(busy.has('2026-10-06')).toBe(false)
  })

  it('both allow the same SwapMatch return dates', () => {
    for (const date of DATES) {
      for (const type of ['24-Hour', 'PM'] as const) {
        expect({ date, type, ok: calendarCanGive(date, type, takeCtx) }).toEqual({
          date,
          type,
          ok: boardCanGive(date, type, rules, NOW),
        })
      }
    }
  })
})

describe('"See N available shifts" opens the query the count was made from', () => {
  const member: BoardMember = { id: ME, rank: 'Firefighter', station: 19, battalion: 9, division: 3, tour: TOUR }

  it('every location, my rank, "Only shifts I can take", that one day', () => {
    const url = new URL(boardDayHref('2026-10-14'), 'https://example.test')
    expect(url.pathname).toBe('/board')
    const date = parseDateParam(url.searchParams.get('date'))
    expect(date).toBe('2026-10-14')

    const filters = initialBoardFilters(defaultBoardFilters(member), isScopeAllParam(url.searchParams.get('scope')))
    expect(isAllLocations(filters)).toBe(true)
    expect(filters.onlyEligible).toBe(true)

    // The calendar counts listBoardShifts({ from, to, eligibleFor: me }) with no location filter.
    const api = toBoardApiFilters(filters, member, { date })
    expect(api).toMatchObject({ division: null, battalion: null, station: null, rank: null, from: date, to: date })
    expect(api.eligibleFor).toEqual({ id: ME, rank: 'Firefighter', station: 19, battalion: 9, division: 3 })
  })

  it('without ?scope=all the Board keeps its My Battalion default', () => {
    const filters = initialBoardFilters(defaultBoardFilters(member), isScopeAllParam(null))
    expect(filters.battalion).toBe(9)
  })
})
