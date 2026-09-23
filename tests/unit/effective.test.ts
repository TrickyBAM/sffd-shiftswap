import { describe, expect, it } from 'vitest'
import { computeDay, computeDays, computeMonthDays, type ScheduleShift } from '@/lib/schedule/effective'
import { tourDaysInRange } from '@/lib/sffd/tours'

const ME = 'me-uuid'
const MIKE = 'mike-uuid'
const ANA = 'ana-uuid'

function shift(partial: Partial<ScheduleShift> & Pick<ScheduleShift, 'id' | 'date'>): ScheduleShift {
  return {
    poster_id: ME,
    poster_name: 'Me Myself',
    coverer_id: null,
    coverer_name: null,
    shift_type: '24-Hour',
    status: 'open',
    return_leg_of: null,
    return_leg_id: null,
    ...partial,
  }
}

// Tour 2 works 2026-09-23, 26, 29, 10-03 … (watches 2,5,8,12,15,18,22,25,28).
const TOUR = 2

describe('computeMonthDays', () => {
  it('base schedule only: red on my tour days', () => {
    const month = computeMonthDays({ tour: TOUR, userId: ME, year: 2026, month: 9, myShifts: [] })
    expect(month.weeks).toHaveLength(6)
    expect(month.days).toHaveLength(30)
    const working = month.days.filter((d) => d.working).map((d) => d.ymd)
    expect(working).toEqual(tourDaysInRange(TOUR, '2026-09-01', '2026-09-30'))
    for (const d of month.days) {
      expect(d.base).toBe(d.working)
      expect(d.tone).toBe(d.working ? 'working' : 'off')
      expect(d.inMonth).toBe(true)
    }
    // Padding days are computed too, and flagged.
    expect(month.weeks[0][0]).toMatchObject({ ymd: '2026-08-30', inMonth: false })
  })

  it('applies trades, open posts, swaps and board counts', () => {
    const myShifts: ScheduleShift[] = [
      // Gave away my tour day 09-23 to Mike (plain trade).
      shift({ id: 's1', date: '2026-09-23', status: 'covered', coverer_id: MIKE, coverer_name: 'Mike Jones' }),
      // Open post on my tour day 09-26.
      shift({ id: 's2', date: '2026-09-26', status: 'open' }),
      // I'm covering Ana on 09-24 (an off day for me).
      shift({ id: 's3', date: '2026-09-24', poster_id: ANA, poster_name: 'Ana Cruz', status: 'covered', coverer_id: ME, coverer_name: 'Me Myself', shift_type: 'PM' }),
      // SwapMatch: I gave Ana 09-29 (original leg) and work her 10-01 (return leg).
      shift({ id: 's4', date: '2026-09-29', status: 'covered', coverer_id: ANA, coverer_name: 'Ana Cruz', return_leg_id: 's5' }),
      shift({ id: 's5', date: '2026-09-30', poster_id: ANA, poster_name: 'Ana Cruz', status: 'covered', coverer_id: ME, coverer_name: 'Me Myself', return_leg_of: 's4' }),
      // Cancelled rows and rows not involving me are ignored.
      shift({ id: 's6', date: '2026-09-27', status: 'cancelled' }),
      shift({ id: 's7', date: '2026-09-28', poster_id: ANA, poster_name: 'Ana Cruz', status: 'covered', coverer_id: MIKE, coverer_name: 'Mike Jones' }),
    ]
    const month = computeMonthDays({
      tour: TOUR,
      userId: ME,
      year: 2026,
      month: 9,
      myShifts,
      boardCounts: { '2026-09-25': 3, '2026-09-23': 2, '2026-09-26': 4, '2026-09-27': 0, '2026-09-28': -1 },
      today: '2026-09-24',
    })
    const day = (ymd: string) => month.days.find((d) => d.ymd === ymd)!

    // Given away: base, not working, red outline, "Covered by Mike Jones"; board count
    // still shows because I'm free that day.
    expect(day('2026-09-23')).toMatchObject({
      base: true,
      working: false,
      givenAway: { shiftId: 's1', byId: MIKE, byName: 'Mike Jones', isSwap: false, shiftType: '24-Hour' },
      pickedUp: null,
      swap: false,
      availableCount: 2,
      tone: 'givenAway',
      isPast: true,
      isToday: false,
    })

    // Covering Ana on an off day: gray.
    expect(day('2026-09-24')).toMatchObject({
      base: false,
      working: true,
      pickedUp: { shiftId: 's3', forId: ANA, forName: 'Ana Cruz', isSwap: false, shiftType: 'PM' },
      tone: 'covering',
      isToday: true,
      isPast: false,
    })

    // Off day with open shifts available: blue with count.
    expect(day('2026-09-25')).toMatchObject({ working: false, availableCount: 3, tone: 'available' })

    // My open post: still working until someone covers it; can't pick up that day.
    expect(day('2026-09-26')).toMatchObject({
      base: true,
      working: true,
      openPost: { shiftId: 's2', shiftType: '24-Hour' },
      availableCount: 0,
      tone: 'openPost',
    })

    // Cancelled post is ignored; zero/negative counts are 0.
    expect(day('2026-09-27')).toMatchObject({ openPost: null, availableCount: 0, tone: 'off' })
    expect(day('2026-09-28')).toMatchObject({ pickedUp: null, givenAway: null, availableCount: 0, tone: 'off' })

    // SwapMatch legs are purple in both directions.
    expect(day('2026-09-29')).toMatchObject({
      base: true,
      working: false,
      swap: true,
      givenAway: { shiftId: 's4', isSwap: true },
      tone: 'swap',
    })
    expect(day('2026-09-30')).toMatchObject({
      base: false,
      working: true,
      swap: true,
      pickedUp: { shiftId: 's5', isSwap: true },
      tone: 'swap',
    })
  })

  it('members with no tour only work picked-up shifts', () => {
    const myShifts = [
      shift({ id: 'x', date: '2026-09-10', poster_id: ANA, poster_name: 'Ana Cruz', status: 'covered', coverer_id: ME }),
      shift({ id: 'y', date: '2026-09-12', status: 'open' }),
    ]
    const month = computeMonthDays({ tour: null, userId: ME, year: 2026, month: 9, myShifts })
    expect(month.days.filter((d) => d.base)).toEqual([])
    expect(month.days.filter((d) => d.working).map((d) => d.ymd)).toEqual(['2026-09-10'])
    expect(month.days.find((d) => d.ymd === '2026-09-12')).toMatchObject({ working: false, tone: 'openPost' })
  })

  it('accepts board counts as a Map', () => {
    const month = computeMonthDays({
      tour: null,
      userId: ME,
      year: 2026,
      month: 9,
      myShifts: [],
      boardCounts: new Map([['2026-09-15', 5]]),
    })
    expect(month.days.find((d) => d.ymd === '2026-09-15')?.availableCount).toBe(5)
  })

  it('no today ⇒ isToday/isPast are false', () => {
    const month = computeMonthDays({ tour: 1, userId: ME, year: 2026, month: 9, myShifts: [] })
    expect(month.days.some((d) => d.isToday || d.isPast)).toBe(false)
  })
})

describe('computeDays / computeDay', () => {
  it('computes an arbitrary range', () => {
    const days = computeDays({ tour: TOUR, userId: ME, myShifts: [], fromYmd: '2026-12-30', toYmd: '2027-01-02' })
    expect(days.map((d) => d.ymd)).toEqual(['2026-12-30', '2026-12-31', '2027-01-01', '2027-01-02'])
    expect(days.every((d) => d.inMonth)).toBe(true)
  })

  it('computes one day', () => {
    const d = computeDay({
      tour: TOUR,
      userId: ME,
      ymd: '2026-09-23',
      myShifts: [shift({ id: 's1', date: '2026-09-23', status: 'covered', coverer_id: MIKE, coverer_name: 'Mike' })],
    })
    expect(d.working).toBe(false)
    expect(d.givenAway?.byName).toBe('Mike')
  })
})
