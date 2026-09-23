import { describe, expect, it } from 'vitest'
import {
  blockedReturnDates,
  boardEligibility,
  busyDates,
  canGiveReturnDate,
  offersReturnICanGive,
  pmGivenAwayDates,
  scheduleRange,
  type ReturnDateRules,
} from '@/app/(app)/board/_lib/eligibility'
import { tourWorks } from '@/lib/sffd/tours'
import type { ScheduleRow } from '@/lib/types/database'

// 2026-09-23 12:00 Pacific (PDT, UTC−7). 2026-09-23 is Watch 2, so Tour 2
// works Sep 23, Sep 26, Sep 29, Oct 3, Oct 6, Oct 9, Oct 13, Oct 16, Oct 19 (ARCHITECTURE §4).
const NOW = new Date('2026-09-23T19:00:00Z')
const TOUR = 2
const POST_ID = '10000000-0000-4000-8000-000000000001'

function day(date: string, overrides: Partial<ScheduleRow> = {}): ScheduleRow {
  return {
    date,
    base: tourWorks(TOUR, date),
    given_away: false,
    pm_given_away: false,
    picked_up: false,
    working: tourWorks(TOUR, date),
    open_post_id: null,
    given_shift_id: null,
    picked_shift_id: null,
    is_swap: false,
    ...overrides,
  }
}

describe('the tour fixture', () => {
  it('matches the rotation', () => {
    expect(['2026-09-23', '2026-10-03', '2026-10-16'].every((d) => tourWorks(TOUR, d))).toBe(true)
    expect(['2026-10-04', '2026-10-20'].some((d) => tourWorks(TOUR, d))).toBe(false)
  })
})

describe('scheduleRange', () => {
  it('reads today and the next 180 days, which covers every post and return date', () => {
    expect(scheduleRange('2026-09-23', null)).toEqual({ from: '2026-09-23', to: '2027-03-22' })
    expect(scheduleRange('2026-09-23', '2026-10-14')).toEqual({ from: '2026-09-23', to: '2027-03-22' })
  })

  it('reads just the day for a ?date= outside that window', () => {
    expect(scheduleRange('2026-09-23', '2027-06-01')).toEqual({ from: '2027-06-01', to: '2027-06-01' })
    expect(scheduleRange('2026-09-23', '2026-09-01')).toEqual({ from: '2026-09-01', to: '2026-09-01' })
  })
})

describe('days I can’t take a shift (TF-1)', () => {
  const schedule = [
    day('2026-10-03', { given_away: true, pm_given_away: true, given_shift_id: POST_ID }), // PM given away: still on 0800–1600
    day('2026-10-06', { given_away: true, working: false, given_shift_id: POST_ID }), // whole 24-Hour given away: free
    day('2026-10-07', { picked_up: true, working: true, picked_shift_id: POST_ID }),
    day('2026-10-08', { open_post_id: POST_ID }), // no-tour style work day: an open post
    day('2026-10-09'), // tour day
    day('2026-10-10'), // off
  ]

  it('leaves out tour days, PM-only give-aways, pick-ups and days with an open post', () => {
    expect(busyDates(schedule)).toEqual(['2026-10-03', '2026-10-07', '2026-10-08', '2026-10-09'])
  })

  it('treats a PM-only give-away as a work day even from a schedule that says otherwise', () => {
    // A database without migration 0011 reported working = false here.
    expect(busyDates([day('2026-10-03', { given_away: true, pm_given_away: true, working: false })])).toEqual(['2026-10-03'])
  })

  it('remembers PM-only give-aways for the "you still work 0800–1600" note', () => {
    expect(pmGivenAwayDates(schedule)).toEqual(['2026-10-03'])
  })

  it('with ?date= only that day goes into the query', () => {
    expect(boardEligibility(schedule, TOUR, '2026-10-03').excludeDates).toEqual(['2026-10-03'])
    expect(boardEligibility(schedule, TOUR, '2026-10-10').excludeDates).toEqual([])
    expect(boardEligibility(schedule, TOUR, null).excludeDates).toHaveLength(4)
  })
})

describe('SwapMatch return dates I could give (TF-3)', () => {
  const schedule = [
    day('2026-10-03', { given_away: true, pm_given_away: true, given_shift_id: POST_ID }),
    day('2026-10-06', { open_post_id: POST_ID }),
    day('2026-10-13', { picked_up: true, picked_shift_id: POST_ID }),
    day('2026-10-16'),
  ]
  const rules: ReturnDateRules = boardEligibility(schedule, TOUR, null).returnRules

  it('blocks days already posted, traded or picked up', () => {
    expect(blockedReturnDates(schedule)).toEqual(['2026-10-03', '2026-10-06', '2026-10-13'])
    expect(rules).toEqual({ tour: TOUR, blocked: ['2026-10-03', '2026-10-06', '2026-10-13'] })
  })

  it('needs one of my untraded tour days that hasn’t started', () => {
    expect(canGiveReturnDate('2026-10-16', '24-Hour', rules, NOW)).toBe(true)
    expect(canGiveReturnDate('2026-10-20', '24-Hour', rules, NOW)).toBe(false) // not my tour day
    expect(canGiveReturnDate('2026-10-06', '24-Hour', rules, NOW)).toBe(false) // already posted
    expect(canGiveReturnDate('2026-10-03', 'PM', rules, NOW)).toBe(false) // already traded
    expect(canGiveReturnDate('2026-10-13', '24-Hour', rules, NOW)).toBe(false) // covering someone
    // Today (a tour day): the 24-Hour started at 08:00, the PM starts at 16:00.
    expect(canGiveReturnDate('2026-09-23', '24-Hour', rules, NOW)).toBe(false)
    expect(canGiveReturnDate('2026-09-23', 'PM', rules, NOW)).toBe(true)
  })

  it('lets a member with no tour give any day they haven’t traded', () => {
    const noTour: ReturnDateRules = { tour: null, blocked: ['2026-10-06'] }
    expect(canGiveReturnDate('2026-10-20', '24-Hour', noTour, NOW)).toBe(true)
    expect(canGiveReturnDate('2026-10-06', '24-Hour', noTour, NOW)).toBe(false)
    expect(boardEligibility([], null, null).returnRules).toEqual({ tour: null, blocked: [] })
  })

  it('hides a SwapMatch only when none of its return dates work', () => {
    const swap = (return_dates: string[]) => ({ shift_type: '24-Hour' as const, return_dates })
    expect(offersReturnICanGive(swap([]), rules, NOW)).toBe(true) // not a SwapMatch
    expect(offersReturnICanGive(swap(['2026-10-20']), rules, NOW)).toBe(false)
    expect(offersReturnICanGive(swap(['2026-10-20', '2026-10-06']), rules, NOW)).toBe(false)
    expect(offersReturnICanGive(swap(['2026-10-20', '2026-10-16']), rules, NOW)).toBe(true)
  })
})
