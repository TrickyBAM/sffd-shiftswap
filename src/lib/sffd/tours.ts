// SFFD 31-day tour rotation (ARCHITECTURE §4).
//
// 2019-01-01 is Watch 1. Tour 1 works watches {1,4,7,11,14,17,21,24,27}; tour N
// is tour 1 shifted N−1 days. Every calendar day exactly 9 of the 31 tours are
// on duty. Verified against the public per-tour Google Calendars linked from
// sffirecu.org (tests/fixtures/tour-truth.json). Mirrored in SQL by
// public.tour_works(smallint, date) — keep the two identical.

import { assertYmd, dayNumberToYmd, ymdToDayNumber, type Ymd, addDays } from './dates'

export const TOUR_EPOCH: Ymd = '2019-01-01'
export const TOUR_COUNT = 31
export const TOUR_CYCLE_DAYS = 31
export const SHIFTS_PER_CYCLE = 9

/** Day offsets (within a 31-day cycle from the epoch) that Tour 1 works. */
export const TOUR1_OFFSETS: readonly number[] = Object.freeze([0, 3, 6, 10, 13, 16, 20, 23, 26])

/** 1 … 31. */
export const TOURS: readonly number[] = Object.freeze(Array.from({ length: TOUR_COUNT }, (_, i) => i + 1))

const EPOCH_DAY = ymdToDayNumber(TOUR_EPOCH)
const TOUR1_OFFSET_SET = new Set(TOUR1_OFFSETS)

function mod(a: number, n: number): number {
  return ((a % n) + n) % n
}

/** True for an integer tour number 1–31. */
export function isTour(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= TOUR_COUNT
}

/** Position in the cycle: 0 on Watch 1 days, … 30 on Watch 31 days. */
function cycleIndex(ymd: Ymd): number {
  return mod(ymdToDayNumber(ymd) - EPOCH_DAY, TOUR_CYCLE_DAYS)
}

/** The watch (1–31) of a date: mod(days since 2019-01-01, 31) + 1. */
export function watchOf(ymd: Ymd): number {
  return cycleIndex(ymd) + 1
}

function worksOnDayNumber(tour: number, dayNumber: number): boolean {
  return TOUR1_OFFSET_SET.has(mod(dayNumber - EPOCH_DAY - (tour - 1), TOUR_CYCLE_DAYS))
}

/**
 * Does `tour` work (base schedule) on `ymd`? Members without a tour
 * (null/undefined — relief, detail, 40-hour) have no base schedule, so this is
 * false for them; so is any value that isn't a tour number 1–31.
 */
export function tourWorks(tour: number | null | undefined, ymd: Ymd): boolean {
  if (!isTour(tour)) {
    assertYmd(ymd)
    return false
  }
  return worksOnDayNumber(tour, ymdToDayNumber(ymd))
}

/** The 9 tours on duty on `ymd`, ascending. */
export function toursOnDuty(ymd: Ymd): number[] {
  const n = ymdToDayNumber(ymd)
  return TOURS.filter((t) => worksOnDayNumber(t, n))
}

/** The watches (1–31) a tour works, ascending — as printed on the tour calendars. */
export function tourWatches(tour: number): number[] {
  if (!isTour(tour)) throw new RangeError(`Invalid tour: ${tour}`)
  return TOUR1_OFFSETS.map((o) => mod(o + tour - 1, TOUR_CYCLE_DAYS) + 1).sort((a, b) => a - b)
}

/** Every date in [fromYmd, toYmd] (inclusive) that `tour` works. Empty for no tour. */
export function tourDaysInRange(tour: number | null | undefined, fromYmd: Ymd, toYmd: Ymd): Ymd[] {
  const start = ymdToDayNumber(fromYmd)
  const end = ymdToDayNumber(toYmd)
  if (!isTour(tour) || end < start) return []
  const out: Ymd[] = []
  for (let n = start; n <= end; n++) {
    if (worksOnDayNumber(tour, n)) out.push(dayNumberToYmd(n))
  }
  return out
}

/** The next `count` days `tour` works, starting at (and including) `fromYmd`. */
export function nextTourDays(tour: number | null | undefined, fromYmd: Ymd, count: number): Ymd[] {
  let n = ymdToDayNumber(fromYmd)
  if (!isTour(tour) || !Number.isInteger(count) || count <= 0) return []
  const out: Ymd[] = []
  while (out.length < count) {
    if (worksOnDayNumber(tour, n)) out.push(dayNumberToYmd(n))
    n++
  }
  return out
}

// ---------------------------------------------------------------------------
// Find my tour: members who don't know their tour number tap a few days they
// worked, and we snap those days to the real rotation (never invent a pattern).
// ---------------------------------------------------------------------------

export interface TourMatch {
  tour: number
  /** Tapped days this tour works. */
  matched: number
  /** Tapped days this tour does not work. */
  missed: number
}

export type TourFinderResult =
  /** Nothing tapped yet. */
  | { kind: 'empty' }
  /** Exactly one tour works every tapped day. */
  | { kind: 'exact'; tour: number; days: number }
  /** Several tours work every tapped day — one more day will settle it. */
  | { kind: 'ambiguous'; candidates: number[]; days: number }
  /** No tour fits every day, but one misses only a single day (often a trade or overtime day). */
  | { kind: 'closest'; tour: number; matched: number; days: number }
  /** The days don't follow any numbered tour (relief, detail, 40-hour — or mis-taps). */
  | { kind: 'none'; days: number }

/**
 * Scores all 31 tours: `matched` = worked days the tour works plus not-worked days
 * it has off; `missed` = the rest. Best first, then lowest tour number.
 */
export function matchTours(worked: readonly Ymd[], notWorked: readonly Ymd[] = []): TourMatch[] {
  const on = [...new Set(worked)]
  const off = [...new Set(notWorked)].filter((d) => !on.includes(d))
  return TOURS.map((tour) => {
    const matched = on.filter((d) => tourWorks(tour, d)).length + off.filter((d) => !tourWorks(tour, d)).length
    return { tour, matched, missed: on.length + off.length - matched }
  }).sort((a, b) => b.matched - a.matched || a.tour - b.tour)
}

/**
 * Works out which tour a member is on from days they worked their regular shift
 * (and, optionally, days they confirm they did NOT work).
 *
 * SFFD's 9-shift pattern (gaps 3,3,4,3,3,4,3,3,5) nearly repeats inside the
 * 31-day cycle, so even a few weeks of consecutive shifts can fit 2–3 tours —
 * the 5-day break tells them apart. When several tours fit, ask about
 * `disambiguatingDay()` instead of making the member tap more days.
 * One day that fits no tour is tolerated once at least three days are known
 * (members often remember a trade or overtime day by mistake).
 */
export function findTour(worked: readonly Ymd[], notWorked: readonly Ymd[] = []): TourFinderResult {
  const onDays = new Set(worked)
  const days = onDays.size
  if (days === 0) return { kind: 'empty' }
  const ranked = matchTours(worked, notWorked)
  const perfect = ranked.filter((m) => m.missed === 0).map((m) => m.tour)
  if (perfect.length === 1) return { kind: 'exact', tour: perfect[0], days }
  if (perfect.length > 1) return { kind: 'ambiguous', candidates: perfect, days }
  const best = ranked[0]
  const runnerUp = ranked[1]
  const known = days + new Set(notWorked).size
  if (known >= 3 && best.missed === 1 && (!runnerUp || runnerUp.matched < best.matched)) {
    return { kind: 'closest', tour: best.tour, matched: best.matched, days }
  }
  return { kind: 'none', days }
}

/**
 * The most recent past day (within about two months, before `today`) that
 * splits the candidate tours as evenly as possible — ask the member "Did you
 * work this day?" to narrow them down. Null when no day splits them.
 */
export function disambiguatingDay(candidates: readonly number[], today: Ymd, exclude: readonly Ymd[] = []): Ymd | null {
  if (candidates.length < 2) return null
  let best: Ymd | null = null
  let bestScore = 0
  for (let back = 1; back <= 62; back++) {
    const day = addDays(today, -back)
    if (exclude.includes(day)) continue
    const working = candidates.filter((t) => tourWorks(t, day)).length
    const score = Math.min(working, candidates.length - working)
    if (score > bestScore) {
      best = day
      bestScore = score
    }
  }
  return best
}
