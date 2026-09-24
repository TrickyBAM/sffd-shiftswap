import { describe, expect, it } from 'vitest'
import {
  availableCount,
  balanceDetail,
  balanceHeadline,
  boardDayHref,
  canGiveReturnDate,
  comingUp,
  dayActions,
  dayAriaLabel,
  dayMarks,
  describeDay,
  firstName,
  futurePart,
  indexShifts,
  missingPartnerIds,
  monthKey,
  parseMonthParam,
  postability,
  relativeDay,
  shortName,
  takeableCounts,
  toOpenShiftLite,
  tradeHref,
  visibleRange,
  type DayContext,
  type OpenShiftLite,
  type TakeContext,
} from '@/app/(app)/calendar/_components/calendar-model'
import { computeDay, computeDays } from '@/lib/schedule/effective'
import { addDays, type Ymd } from '@/lib/sffd/dates'
import { tourWorks } from '@/lib/sffd/tours'
import type { Shift } from '@/lib/types/database'

const ME = '00000000-0000-4000-8000-000000000001'
const MIKE = '00000000-0000-4000-8000-000000000002'
const ANA = '00000000-0000-4000-8000-000000000003'

// Tour 2 works 2026-09-23 (today), 09-26, 09-29, 10-03, … (ARCHITECTURE §4 sanity check).
const TOUR = 2
const TODAY: Ymd = '2026-09-23'
// 10:00 in San Francisco (PDT): today's 24-Hour shift has started, the PM shift hasn't.
const NOW = new Date('2026-09-23T17:00:00Z')

function shift(partial: Partial<Shift> & Pick<Shift, 'id' | 'date'>): Shift {
  return {
    poster_id: ME,
    poster_name: 'Brian Machado',
    rank: 'Firefighter',
    station: 19,
    battalion: 9,
    division: 3,
    shift_type: '24-Hour',
    hours: 24,
    starts_at: `${partial.date}T15:00:00Z`,
    status: 'open',
    return_dates: [],
    accept_limit: 'anyone',
    notes: null,
    coverer_id: null,
    coverer_name: null,
    confirmed_at: null,
    return_leg_of: null,
    return_leg_id: null,
    cancel_requested_by: null,
    cancel_requested_at: null,
    cancel_reason: null,
    cancelled_at: null,
    cancelled_by: null,
    cancel_note: null,
    created_at: '2026-09-01T00:00:00Z',
    updated_at: '2026-09-01T00:00:00Z',
    ...partial,
  }
}

// I gave 09-26 away to Mike as a SwapMatch; I work Mike's shift on 10-14 in return.
const SWAP_ORIGINAL = shift({
  id: '10000000-0000-4000-8000-000000000001',
  date: '2026-09-26',
  status: 'covered',
  coverer_id: MIKE,
  coverer_name: 'Mike Lee',
  return_leg_id: '10000000-0000-4000-8000-000000000002',
  return_dates: ['2026-10-14'],
})
const SWAP_RETURN = shift({
  id: '10000000-0000-4000-8000-000000000002',
  date: '2026-10-14',
  poster_id: MIKE,
  poster_name: 'Mike Lee',
  status: 'covered',
  coverer_id: ME,
  coverer_name: 'Brian Machado',
  return_leg_of: SWAP_ORIGINAL.id,
})
// I'm covering Ana at Station 7 on 09-24 (a day off for tour 2).
const COVERING_ANA = shift({
  id: '10000000-0000-4000-8000-000000000003',
  date: '2026-09-24',
  poster_id: ANA,
  poster_name: 'Ana Cruz',
  station: 7,
  battalion: 6,
  status: 'covered',
  coverer_id: ME,
  coverer_name: 'Brian Machado',
})
// My open post on 09-29.
const OPEN_POST = shift({ id: '10000000-0000-4000-8000-000000000004', date: '2026-09-29' })

const SHIFTS = [SWAP_ORIGINAL, SWAP_RETURN, COVERING_ANA, OPEN_POST]
const LOOKUP = indexShifts(SHIFTS)
const CTX: DayContext = { tour: TOUR, today: TODAY, now: NOW, lookup: LOOKUP }

function day(ymd: Ymd, counts: Record<Ymd, number> = {}, tour: number | null = TOUR) {
  return computeDay({ ymd, userId: ME, tour, myShifts: SHIFTS, boardCounts: counts, today: TODAY })
}

describe('months and ranges', () => {
  it('parses ?month=YYYY-MM and rejects anything else', () => {
    expect(parseMonthParam('2026-09')).toEqual({ year: 2026, month: 9 })
    expect(parseMonthParam(' 2027-01 ')).toEqual({ year: 2027, month: 1 })
    for (const bad of ['2026-13', '2026-00', '2026-9', 'soon', '2018-12', '', null, undefined, 202609]) {
      expect(parseMonthParam(bad)).toBeNull()
    }
    expect(monthKey({ year: 2026, month: 9 })).toBe('2026-09')
  })

  it('covers the whole 6-week grid, Sunday first', () => {
    expect(visibleRange({ year: 2026, month: 9 })).toEqual({ from: '2026-08-30', to: '2026-10-10' })
    expect(visibleRange({ year: 2026, month: 2 })).toEqual({ from: '2026-02-01', to: '2026-03-14' })
  })

  it('keeps only the part of a range from today on', () => {
    const range = { from: '2026-08-30', to: '2026-10-10' }
    expect(futurePart(range, TODAY)).toEqual({ from: TODAY, to: '2026-10-10' })
    expect(futurePart(range, '2026-08-01')).toEqual(range)
    expect(futurePart(range, '2026-11-01')).toBeNull()
  })
})

describe('names and small copy', () => {
  it('shortens names for the grid', () => {
    expect(shortName('Mike Lee')).toBe('M. Lee')
    expect(shortName('Ana María Cruz')).toBe('A. Cruz')
    expect(shortName('Cher')).toBe('Cher')
    expect(shortName('')).toBe('')
    expect(firstName('Mike Lee')).toBe('Mike')
    expect(firstName(null)).toBe('them')
  })

  it('says today / tomorrow / weekday', () => {
    expect(relativeDay(TODAY, TODAY)).toBe('Today')
    expect(relativeDay('2026-09-24', TODAY)).toBe('Tomorrow')
    expect(relativeDay('2026-10-14', TODAY)).toBe('Wed, Oct 14')
  })
})

describe('SwapMatch legs', () => {
  it('finds partner legs that are not loaded and links return legs to the original trade', () => {
    const onlyOriginal = indexShifts([SWAP_ORIGINAL])
    expect(missingPartnerIds([SWAP_ORIGINAL], onlyOriginal)).toEqual([SWAP_RETURN.id])
    expect(missingPartnerIds(SHIFTS, LOOKUP)).toEqual([])
    expect(tradeHref(SWAP_RETURN.id, LOOKUP)).toBe(`/trades/${SWAP_ORIGINAL.id}`)
    expect(tradeHref(COVERING_ANA.id, LOOKUP)).toBe(`/trades/${COVERING_ANA.id}`)
  })
})

describe('describeDay', () => {
  it("says I'm on duty with my tour", () => {
    // 10-03 is a plain tour-2 day with nothing traded.
    expect(tourWorks(TOUR, '2026-10-03')).toBe(true)
    expect(describeDay(day('2026-10-03'), CTX)).toEqual([{ tone: 'working', text: "You're on duty (Tour 2)." }])
  })

  it('explains a SwapMatch from both sides', () => {
    const given = describeDay(day('2026-09-26'), CTX)
    expect(given).toHaveLength(1)
    expect(given[0]).toMatchObject({
      tone: 'givenAway',
      text: "Mike Lee is covering you — SwapMatch: you work Mike's shift on Wed, Oct 14.",
    })
    const back = describeDay(day('2026-10-14'), CTX)
    expect(back.map((l) => l.text)).toContain(
      "You're covering Mike Lee at Station 19 — SwapMatch: Mike covers you on Sat, Sep 26.",
    )
    expect(back.find((l) => l.text.startsWith("You're covering"))?.tone).toBe('swap')
  })

  it('names who and where when I cover someone', () => {
    const lines = describeDay(day('2026-09-24'), CTX)
    expect(lines).toEqual([
      { tone: 'covering', text: "You're covering Ana Cruz at Station 7.", detail: '24-Hour · 0800–0800' },
    ])
  })

  it('mentions my open post and open shifts I could take', () => {
    const posted = describeDay(day('2026-09-29'), CTX)
    expect(posted.map((l) => l.tone)).toEqual(['working', 'openPost'])
    const off = describeDay(day('2026-09-25', { '2026-09-25': 2 }), CTX)
    expect(off).toEqual([{ tone: 'available', text: '2 open shifts you could take.' }])
    const quiet = describeDay(day('2026-09-27'), CTX)
    expect(quiet).toEqual([{ tone: 'off', text: "You're off." }])
    const noTour = describeDay(day('2026-09-27', {}, null), { ...CTX, tour: null })
    expect(noTour).toEqual([{ tone: 'off', text: 'Nothing scheduled.' }])
  })
})

describe('postability and day actions', () => {
  it('offers "Post this shift" only on my untraded tour days that have not started', () => {
    expect(postability(day('2026-10-03'), CTX)).toBe('ok')
    // Today: the 24-Hour has started but the PM shift at 16:00 has not.
    expect(postability(day(TODAY), CTX)).toBe('ok')
    expect(postability(day(TODAY), { ...CTX, now: new Date('2026-09-23T23:30:00Z') })).toBe('started')
    expect(postability(day('2026-09-26'), CTX)).toBe('taken')
    expect(postability(day('2026-09-29'), CTX)).toBe('taken')
    expect(postability(day('2026-09-24'), CTX)).toBe('taken')
    expect(postability(day('2026-09-25'), CTX)).toBe('not-your-day')
    const farTourDay = computeDays({
      userId: ME,
      tour: TOUR,
      myShifts: [],
      today: TODAY,
      fromYmd: addDays(TODAY, 181),
      toYmd: addDays(TODAY, 200),
    }).find((d) => d.base)
    expect(farTourDay && postability(farTourDay, CTX)).toBe('too-far')
    // No tour: any future day that isn't already traded.
    expect(postability(day('2026-09-27', {}, null), { ...CTX, tour: null })).toBe('ok')
  })

  it('builds the sheet actions with the right links', () => {
    expect(dayActions(day('2026-10-03'), CTX)).toEqual([
      { key: 'post', kind: 'post', label: 'Post this shift', href: '/post?date=2026-10-03' },
    ])
    expect(dayActions(day('2026-09-25', { '2026-09-25': 3 }), CTX)).toEqual([
      { key: 'board', kind: 'board', label: 'See 3 available shifts', href: '/board?date=2026-09-25&scope=all' },
    ])
    expect(dayActions(day('2026-09-26'), CTX)).toEqual([
      {
        key: `trade-${SWAP_ORIGINAL.id}`,
        kind: 'trade',
        label: 'View trade with Mike Lee',
        href: `/trades/${SWAP_ORIGINAL.id}`,
      },
    ])
    // The return leg opens the original trade.
    expect(dayActions(day('2026-10-14'), CTX).map((a) => a.href)).toEqual([`/trades/${SWAP_ORIGINAL.id}`])
    expect(dayActions(day('2026-09-29'), CTX).map((a) => a.label)).toEqual(['View your post'])
  })

  it('hides open-shift counts on past days and on days I posted', () => {
    const past = computeDay({
      ymd: '2026-09-20',
      userId: ME,
      tour: TOUR,
      myShifts: [],
      boardCounts: { '2026-09-20': 4 },
      today: TODAY,
    })
    expect(availableCount(past)).toBe(0)
    const noTourPost = computeDay({
      ymd: '2026-09-29',
      userId: ME,
      tour: null,
      myShifts: [OPEN_POST],
      boardCounts: { '2026-09-29': 4 },
      today: TODAY,
    })
    expect(availableCount(noTourPost)).toBe(0)
  })
})

describe('grid marks', () => {
  it('outlines a given-away day with who covers me', () => {
    const marks = dayMarks(day('2026-09-26'))
    expect(marks.outlined).toBe(true)
    expect(marks.coveredBy).toBe('M. Lee')
    expect(marks.bars.map((b) => b.kind)).toEqual(['swap'])
    expect(dayAriaLabel(day('2026-09-26'))).toBe('Saturday, September 26, 2026: covered by Mike Lee, SwapMatch')
  })

  it('draws one bar per thing happening, with the open-shift count', () => {
    expect(dayMarks(day('2026-10-03')).bars).toEqual([{ kind: 'working' }])
    expect(dayMarks(day('2026-09-29')).bars).toEqual([{ kind: 'working' }, { kind: 'openPost' }])
    expect(dayMarks(day('2026-09-24')).bars).toEqual([{ kind: 'covering' }])
    expect(dayMarks(day('2026-09-25', { '2026-09-25': 2 })).bars).toEqual([{ kind: 'available', count: 2 }])
    expect(dayAriaLabel(day(TODAY))).toBe('Wednesday, September 23, 2026, today: on duty')
  })
})

describe('coming up', () => {
  it('lists my next commitments in date order', () => {
    const days = computeDays({
      userId: ME,
      tour: TOUR,
      myShifts: SHIFTS,
      today: TODAY,
      fromYmd: TODAY,
      toYmd: addDays(TODAY, 30),
    })
    const items = comingUp(days, CTX, 5)
    expect(items.map((i) => [i.ymd, i.title])).toEqual([
      [TODAY, 'On duty'],
      ['2026-09-24', 'Covering Ana Cruz'],
      ['2026-09-26', 'Mike Lee is covering you'],
      ['2026-09-29', 'Your shift is posted'],
      ['2026-10-03', 'On duty'],
    ])
    expect(items[0].when).toBe('Today')
    expect(items[1]).toMatchObject({ when: 'Tomorrow', detail: 'Station 7 · 24-Hour', tone: 'covering' })
    expect(items[2]).toMatchObject({ tone: 'swap', outlined: true, detail: '24-Hour · SwapMatch' })
    expect(comingUp(days, CTX, 2)).toHaveLength(2)
  })

  it('shows only trades and posts for members without a tour', () => {
    const days = computeDays({
      userId: ME,
      tour: null,
      myShifts: SHIFTS,
      today: TODAY,
      fromYmd: TODAY,
      toYmd: addDays(TODAY, 30),
    })
    const items = comingUp(days, { ...CTX, tour: null }, 5)
    expect(items.map((i) => i.ymd)).toEqual(['2026-09-24', '2026-09-26', '2026-09-29', '2026-10-14'])
  })
})

describe('balance copy', () => {
  it('reads the balance in plain English', () => {
    expect(balanceHeadline({ covered: 3, given: 2, balance: 1 })).toBe("You're 1 shift ahead.")
    expect(balanceHeadline({ covered: 1, given: 3, balance: -2 })).toBe("You're 2 shifts behind.")
    expect(balanceHeadline({ covered: 2, given: 2, balance: 0 })).toBe("You're even.")
    expect(balanceHeadline({ covered: 0, given: 0, balance: 0 })).toBe('No trades yet.')
    expect(balanceDetail({ covered: 1, given: 3, balance: -2 })).toMatch(/Picking up a shift/)
  })
})

// ---------------------------------------------------------------------------
// TF-1: giving away only the PM of a tour day leaves me on duty 0800–1600
// ---------------------------------------------------------------------------

describe('a tour day with only the PM given away', () => {
  // 10-03 is a tour-2 day; Mike covers the PM (1600–0800).
  const PM_GIVEN = shift({
    id: '10000000-0000-4000-8000-000000000010',
    date: '2026-10-03',
    shift_type: 'PM',
    hours: 16,
    status: 'covered',
    coverer_id: MIKE,
    coverer_name: 'Mike Lee',
  })
  // 10-06 is a tour-2 day whose PM went to Mike as a SwapMatch (I work his 10-14).
  const PM_SWAP = shift({
    id: '10000000-0000-4000-8000-000000000011',
    date: '2026-10-06',
    shift_type: 'PM',
    hours: 16,
    status: 'covered',
    coverer_id: MIKE,
    coverer_name: 'Mike Lee',
    return_dates: ['2026-10-14'],
    return_leg_id: '10000000-0000-4000-8000-000000000012',
  })
  const PM_SWAP_RETURN = shift({
    id: '10000000-0000-4000-8000-000000000012',
    date: '2026-10-14',
    shift_type: 'PM',
    hours: 16,
    poster_id: MIKE,
    poster_name: 'Mike Lee',
    status: 'covered',
    coverer_id: ME,
    coverer_name: 'Brian Machado',
    return_leg_of: PM_SWAP.id,
  })
  const MINE = [PM_GIVEN, PM_SWAP, PM_SWAP_RETURN]
  const PM_CTX: DayContext = { ...CTX, lookup: indexShifts(MINE) }

  function pmDay(ymd: Ymd, counts: Record<Ymd, number> = {}, tour: number | null = TOUR, today: Ymd = TODAY) {
    return computeDay({ ymd, userId: ME, tour, myShifts: MINE, boardCounts: counts, today })
  }

  it('stays a working day that says who covers the PM', () => {
    expect(tourWorks(TOUR, '2026-10-06')).toBe(true)
    const day = pmDay('2026-10-03', { '2026-10-03': 3 })
    expect(day).toMatchObject({ working: true, tone: 'working', availableCount: 0 })
    expect(describeDay(day, PM_CTX)).toEqual([
      { tone: 'working', text: "You're on duty 0800–1600 (Tour 2).", detail: 'PM covered by Mike Lee' },
    ])
    const later = pmDay('2026-10-03', {}, TOUR, '2026-10-05')
    expect(describeDay(later, { ...PM_CTX, today: '2026-10-05' })[0].text).toBe('You were on duty 0800–1600 (Tour 2).')
  })

  it('explains a PM SwapMatch as well', () => {
    const lines = describeDay(pmDay('2026-10-06'), PM_CTX)
    expect(lines.map((l) => l.tone)).toEqual(['working', 'givenAway'])
    expect(lines[1]).toMatchObject({
      text: "Mike Lee is covering your PM — SwapMatch: you work Mike's shift on Wed, Oct 14.",
      detail: 'PM · 1600–0800',
    })
  })

  it('keeps the red bar with the outline and never offers posting or open shifts', () => {
    const day = pmDay('2026-10-03', { '2026-10-03': 3 })
    const marks = dayMarks(day)
    expect(marks.bars).toEqual([{ kind: 'working' }])
    expect(marks.outlined).toBe(true)
    expect(marks.coveredBy).toBe('M. Lee')
    expect(dayAriaLabel(day)).toBe('Saturday, October 3, 2026: on duty 0800–1600, PM covered by Mike Lee')
    expect(availableCount(day)).toBe(0)
    expect(postability(day, PM_CTX)).toBe('taken')
    expect(dayActions(day, PM_CTX)).toEqual([
      {
        key: `trade-${PM_GIVEN.id}`,
        kind: 'trade',
        label: 'View trade with Mike Lee',
        href: `/trades/${PM_GIVEN.id}`,
      },
    ])
    expect(dayMarks(pmDay('2026-10-06')).bars).toEqual([{ kind: 'working' }, { kind: 'swap' }])
  })

  it('shows as on duty in Coming up', () => {
    const days = computeDays({
      userId: ME,
      tour: TOUR,
      myShifts: MINE,
      today: TODAY,
      fromYmd: '2026-10-03',
      toYmd: '2026-10-06',
    })
    expect(comingUp(days, PM_CTX, 5)).toEqual([
      {
        ymd: '2026-10-03',
        when: 'Sat, Oct 3',
        title: 'On duty 0800–1600',
        detail: 'PM covered by Mike Lee',
        tone: 'working',
        outlined: true,
      },
      {
        ymd: '2026-10-06',
        when: 'Tue, Oct 6',
        title: 'On duty 0800–1600',
        detail: 'PM covered by Mike Lee · SwapMatch',
        tone: 'swap',
        outlined: true,
      },
    ])
  })

  it('counts as a working day for members without a tour too', () => {
    const noTour = pmDay('2026-10-03', { '2026-10-03': 2 }, null)
    expect(noTour.working).toBe(true)
    expect(describeDay(noTour, { ...PM_CTX, tour: null })[0].text).toBe("You're on duty 0800–1600.")
    expect(availableCount(noTour)).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// TF-2 / TF-3: the blue counts use the Board's "Only shifts I can take" rules
// ---------------------------------------------------------------------------

describe('open shifts I could take', () => {
  function open(id: string, date: Ymd, extra: Partial<OpenShiftLite> = {}): OpenShiftLite {
    return { id, date, shift_type: '24-Hour', starts_at: `${date}T15:00:00Z`, return_dates: [], ...extra }
  }
  // Tour 2 works 09-26, 09-29, 10-03, 10-06; it's off 09-24, 09-25, 09-27, 09-28.
  const TAKE: TakeContext = { userId: ME, tour: TOUR, myShifts: SHIFTS, now: NOW }

  it('opens the Board on that day across every location', () => {
    expect(boardDayHref('2026-10-14')).toBe('/board?date=2026-10-14&scope=all')
  })

  it('keeps only the columns it needs', () => {
    const row = shift({ id: 'x', date: '2026-10-01', return_dates: ['2026-10-03', 'bad'] })
    expect(toOpenShiftLite(row)).toEqual({
      id: 'x',
      date: '2026-10-01',
      shift_type: '24-Hour',
      starts_at: '2026-10-01T15:00:00Z',
      return_dates: ['2026-10-03'],
    })
  })

  it('counts plain posts per day, once each, and drops ones that have started', () => {
    const counts = takeableCounts(
      [
        open('a', '2026-09-27'),
        open('b', '2026-09-27'),
        open('b', '2026-09-27'),
        open('c', '2026-09-28'),
        // Today's 24-Hour started at 08:00 (it's 10:00); the PM hasn't.
        open('d', TODAY, { starts_at: '2026-09-23T15:00:00Z' }),
        open('e', TODAY, { shift_type: 'PM', starts_at: '2026-09-23T23:00:00Z' }),
      ],
      TAKE,
    )
    expect(counts).toEqual({ '2026-09-27': 2, '2026-09-28': 1, [TODAY]: 1 })
  })

  it('counts a SwapMatch only when I could give one of its return dates', () => {
    const counts = takeableCounts(
      [
        // 10-06 is a free tour day of mine: I can give it.
        open('ok', '2026-09-27', { return_dates: ['2026-09-28', '2026-10-06'] }),
        // 09-28 isn't a tour day (RETURN_NOT_YOUR_DAY).
        open('notTour', '2026-09-27', { return_dates: ['2026-09-28'] }),
        // 09-29 has my open post; 09-26 is already given away (SwapMatch with Mike).
        open('taken', '2026-09-28', { return_dates: ['2026-09-29', '2026-09-26'] }),
        // Today's 24-Hour has started, so today can't be given back.
        open('started', '2026-09-28', { return_dates: [TODAY] }),
      ],
      TAKE,
    )
    expect(counts).toEqual({ '2026-09-27': 1 })
  })

  it('follows the database rule for each return date', () => {
    expect(canGiveReturnDate('2026-10-06', '24-Hour', TAKE)).toBe(true)
    expect(canGiveReturnDate('2026-09-28', '24-Hour', TAKE)).toBe(false)
    expect(canGiveReturnDate('2026-09-29', '24-Hour', TAKE)).toBe(false)
    // Today: the PM hasn't started yet, the 24-Hour has.
    expect(canGiveReturnDate(TODAY, 'PM', TAKE)).toBe(true)
    expect(canGiveReturnDate(TODAY, '24-Hour', TAKE)).toBe(false)
    // No tour: any day without a post or pickup of mine.
    const noTour: TakeContext = { ...TAKE, tour: null }
    expect(canGiveReturnDate('2026-09-28', '24-Hour', noTour)).toBe(true)
    expect(canGiveReturnDate('2026-09-24', '24-Hour', noTour)).toBe(false)
    expect(canGiveReturnDate('2026-09-29', '24-Hour', noTour)).toBe(false)
    expect(canGiveReturnDate('not-a-date', '24-Hour', noTour)).toBe(false)
  })
})
