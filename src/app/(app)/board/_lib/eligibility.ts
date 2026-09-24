// "Only shifts I can take" (ARCHITECTURE §7.2 "Board"): the schedule rules the
// board query can't apply by itself, worked out from my effective schedule
// (my_schedule, §4). Pure functions. The database (shift_eligibility,
// request_shift) stays the judge of whether I can really take a shift: these
// only decide what the list shows.

import { addDays, isStarted, isYmd, type Ymd } from '@/lib/sffd/dates'
import { isShiftType } from '@/lib/sffd/shift-types'
import { isTour, tourWorks } from '@/lib/sffd/tours'
import type { ScheduleRow, Shift } from '@/lib/types/database'

/** How far ahead my schedule is read: posts and return dates are at most 180 days out. */
export const SCHEDULE_DAYS = 181

/**
 * The days of my schedule the Board reads: today and the next 180 days, which
 * covers every open post and every SwapMatch return date. A ?date= outside
 * that window (an old link) reads just that day.
 */
export function scheduleRange(today: Ymd, date: Ymd | null): { from: Ymd; to: Ymd } {
  const to = addDays(today, SCHEDULE_DAYS - 1)
  if (date && (date < today || date > to)) return { from: date, to: date }
  return { from: today, to }
}

/**
 * Days I can't take someone else's shift (YOU_WORK_THAT_DAY, ALREADY_COVERING):
 * I'm on duty — my tour day, a tour day where I gave away only the PM (I still
 * work 0800–1600), or a shift I picked up — or I have an open post that day.
 * A day I gave my whole 24-Hour away is free.
 */
export function busyDates(schedule: readonly ScheduleRow[]): Ymd[] {
  return schedule
    .filter((d) => d.working || d.pm_given_away || d.picked_up || d.open_post_id)
    .map((d) => d.date)
}

/** Days where I gave away only the PM: I'm still on duty 0800–1600. */
export function pmGivenAwayDates(schedule: readonly ScheduleRow[]): Ymd[] {
  return schedule.filter((d) => d.pm_given_away).map((d) => d.date)
}

/**
 * Days I can't give as a SwapMatch return date, whatever my tour says
 * (RETURN_NOT_YOUR_DAY): my own shift that day is already posted or traded
 * away, or I'm covering someone.
 */
export function blockedReturnDates(schedule: readonly ScheduleRow[]): Ymd[] {
  return schedule.filter((d) => d.open_post_id || d.given_away || d.picked_up).map((d) => d.date)
}

export interface ReturnDateRules {
  /** My tour; null = no tour (any day can be given). */
  tour: number | null
  /** blockedReturnDates() of my schedule. */
  blocked: readonly Ymd[]
}

/**
 * Could I give `date` back to the poster of a `shiftType` shift? Mirrors the
 * database's private.can_give_return_date: the return shift hasn't started, it
 * is one of my tour days (members with no tour can give any day), and I haven't
 * posted, traded or picked up a shift that day.
 */
export function canGiveReturnDate(date: Ymd, shiftType: string, rules: ReturnDateRules, now: Date): boolean {
  // Data we can't read is left for the database to judge.
  if (!isYmd(date)) return true
  if (isShiftType(shiftType) && isStarted(date, shiftType, now)) return false
  if (isTour(rules.tour) && !tourWorks(rules.tour, date)) return false
  return !rules.blocked.includes(date)
}

/**
 * False for a SwapMatch where none of the offered return dates is a day I
 * could give (TF-3); true for every other shift.
 */
export function offersReturnICanGive(
  shift: Pick<Shift, 'return_dates' | 'shift_type'>,
  rules: ReturnDateRules,
  now: Date,
): boolean {
  const offered = shift.return_dates ?? []
  return offered.length === 0 || offered.some((d) => canGiveReturnDate(d, shift.shift_type, rules, now))
}

/** Everything the Board needs from my schedule for "Only shifts I can take". */
export interface BoardEligibility {
  /** Days the board query leaves out (busyDates). */
  excludeDates: Ymd[]
  /** Days I gave away only the PM (for the "you still work 0800–1600" note). */
  pmDates: Ymd[]
  /** SwapMatch return-date rules. */
  returnRules: ReturnDateRules
}

/**
 * The eligibility inputs from my schedule. With `date` (?date=) only that day
 * is left out of the query, which keeps the request short.
 */
export function boardEligibility(schedule: readonly ScheduleRow[], tour: number | null, date: Ymd | null): BoardEligibility {
  const busy = busyDates(schedule)
  return {
    excludeDates: date ? busy.filter((d) => d === date) : busy,
    pmDates: pmGivenAwayDates(schedule),
    returnRules: { tour: isTour(tour) ? tour : null, blocked: blockedReturnDates(schedule) },
  }
}
