// Client-side effective schedule (ARCHITECTURE §4, §7.2). Mirrors SQL
// public.my_schedule():
//
//   base        = tour is not null and tourWorks(tour, d)
//   givenAway   = a covered shift with poster_id = me on d (either type)
//   pmGivenAway = that covered shift is a PM (1600–0800): I still work 0800–1600
//   pickedUp    = a covered shift with coverer_id = me on d
//   working     = (base and not a 24-Hour give-away) or pmGivenAway or pickedUp
//
// Only giving away a 24-Hour frees the day. Giving away the PM of a tour day
// leaves the member on duty 0800–1600, so the day stays red and they can't
// pick up another shift that day (YOU_WORK_THAT_DAY).
//
// SwapMatch return legs are ordinary covered rows, so they need no special
// casing except for the purple "swap" marker. Pure functions — no I/O.

import { eachDay, monthGrid, type Ymd } from '@/lib/sffd/dates'
import { SHIFT_TYPES, isShiftType } from '@/lib/sffd/shift-types'
import { tourWorks } from '@/lib/sffd/tours'

/** The columns of a `shifts` row this module needs (full rows are fine). */
export interface ScheduleShift {
  id: string
  poster_id: string
  poster_name: string
  coverer_id: string | null
  coverer_name: string | null
  date: Ymd
  shift_type: string
  status: 'open' | 'covered' | 'cancelled' | (string & {})
  return_leg_of?: string | null
  return_leg_id?: string | null
}

/** A covered shift I gave away on this day. */
export interface GivenAway {
  shiftId: string
  shiftType: string
  /** The member covering for me. */
  byId: string
  byName: string
  isSwap: boolean
}

/** A covered shift I'm working for someone else on this day. */
export interface PickedUp {
  shiftId: string
  shiftType: string
  /** The member I'm covering for. */
  forId: string
  forName: string
  isSwap: boolean
}

export interface OpenPost {
  shiftId: string
  shiftType: string
}

/**
 * Calendar colour for the day (§7.2), by precedence:
 * swap (purple) › covering (gray) › openPost (orange) › working (red) ›
 * givenAway (red outline) › available (blue) › off.
 */
export type DayTone = 'swap' | 'covering' | 'openPost' | 'working' | 'givenAway' | 'available' | 'off'

export interface ScheduleDay {
  ymd: Ymd
  /** False for padding days from adjacent months in a month grid. */
  inMonth: boolean
  /** One of my tour days (ignores trades). */
  base: boolean
  /** The covered shift I gave away this day (a 24-Hour or only the PM). */
  givenAway: GivenAway | null
  /**
   * Same as `givenAway` when what I gave away is only the PM (1600–0800):
   * I still work 0800–1600 that day, so `working` stays true.
   */
  pmGivenAway: GivenAway | null
  pickedUp: PickedUp | null
  /** Effective: on duty after trades (for at least part of the day). */
  working: boolean
  /** My open (not yet covered) post on this day. */
  openPost: OpenPost | null
  /** A SwapMatch leg (either direction) falls on this day. */
  swap: boolean
  /** Open shifts I could request that day (0 whenever I'm working). */
  availableCount: number
  tone: DayTone
  isToday: boolean
  isPast: boolean
}

export interface ScheduleInput {
  /** My tour (1–31) or null for "No tour". */
  tour: number | null | undefined
  /** My user id — decides which side of each shift row I'm on. */
  userId: string
  /** Shift rows involving me (as poster or coverer); other rows are ignored. */
  myShifts: readonly ScheduleShift[]
  /** Open shifts I could request, counted per date: { '2026-09-24': 3 }. */
  boardCounts?: Readonly<Record<Ymd, number>> | ReadonlyMap<Ymd, number>
  /** Today's date (todayPT()); enables isToday/isPast. */
  today?: Ymd
}

export interface MonthScheduleInput extends ScheduleInput {
  year: number
  /** 1–12 */
  month: number
}

export interface MonthSchedule {
  year: number
  month: number
  /** 6 × 7 grid, Sunday first (includes padding days). */
  weeks: ScheduleDay[][]
  /** Only the days of the month, in order. */
  days: ScheduleDay[]
}

interface DayIndex {
  given: Map<Ymd, ScheduleShift>
  picked: Map<Ymd, ScheduleShift>
  open: Map<Ymd, ScheduleShift>
}

function isSwapLeg(shift: ScheduleShift): boolean {
  return Boolean(shift.return_leg_of || shift.return_leg_id)
}

function indexShifts(userId: string, shifts: readonly ScheduleShift[]): DayIndex {
  const index: DayIndex = { given: new Map(), picked: new Map(), open: new Map() }
  for (const s of shifts) {
    if (s.status === 'covered') {
      if (s.poster_id === userId) index.given.set(s.date, s)
      else if (s.coverer_id === userId) index.picked.set(s.date, s)
    } else if (s.status === 'open' && s.poster_id === userId) {
      index.open.set(s.date, s)
    }
  }
  return index
}

function countFor(counts: ScheduleInput['boardCounts'], ymd: Ymd): number {
  if (!counts) return 0
  const n = counts instanceof Map ? counts.get(ymd) : (counts as Readonly<Record<Ymd, number>>)[ymd]
  return typeof n === 'number' && Number.isFinite(n) && n > 0 ? Math.floor(n) : 0
}

function toneOf(day: Omit<ScheduleDay, 'tone'>): DayTone {
  if (day.swap) return 'swap'
  if (day.pickedUp) return 'covering'
  if (day.openPost) return 'openPost'
  if (day.working) return 'working'
  if (day.givenAway) return 'givenAway'
  if (day.availableCount > 0) return 'available'
  return 'off'
}

function buildDay(input: ScheduleInput, index: DayIndex, ymd: Ymd, inMonth: boolean): ScheduleDay {
  const base = tourWorks(input.tour, ymd)
  const given = index.given.get(ymd)
  const picked = index.picked.get(ymd)
  const open = index.open.get(ymd)

  const givenAway: GivenAway | null = given
    ? {
        shiftId: given.id,
        shiftType: given.shift_type,
        byId: given.coverer_id ?? '',
        byName: given.coverer_name ?? '',
        isSwap: isSwapLeg(given),
      }
    : null
  const pickedUp: PickedUp | null = picked
    ? {
        shiftId: picked.id,
        shiftType: picked.shift_type,
        forId: picked.poster_id,
        forName: picked.poster_name,
        isSwap: isSwapLeg(picked),
      }
    : null

  // Only a 24-Hour give-away frees the day; after giving away the PM I still
  // work 0800–1600.
  const pmGivenAway = givenAway && givenAway.shiftType === 'PM' ? givenAway : null
  const working = (base && !givenAway) || Boolean(pmGivenAway) || Boolean(pickedUp)
  const day: Omit<ScheduleDay, 'tone'> = {
    ymd,
    inMonth,
    base,
    givenAway,
    pmGivenAway,
    pickedUp,
    working,
    openPost: open ? { shiftId: open.id, shiftType: open.shift_type } : null,
    swap: Boolean(givenAway?.isSwap || pickedUp?.isSwap),
    // You can't request a shift on a day you're working (YOU_WORK_THAT_DAY).
    availableCount: working ? 0 : countFor(input.boardCounts, ymd),
    isToday: input.today !== undefined && ymd === input.today,
    isPast: input.today !== undefined && ymd < input.today,
  }
  return { ...day, tone: toneOf(day) }
}

/** Effective schedule for every day in [fromYmd, toYmd] (inclusive). */
export function computeDays(input: ScheduleInput & { fromYmd: Ymd; toYmd: Ymd }): ScheduleDay[] {
  const index = indexShifts(input.userId, input.myShifts)
  return eachDay(input.fromYmd, input.toYmd).map((ymd) => buildDay(input, index, ymd, true))
}

/** Effective schedule for one day. */
export function computeDay(input: ScheduleInput & { ymd: Ymd }): ScheduleDay {
  return buildDay(input, indexShifts(input.userId, input.myShifts), input.ymd, true)
}

/** Month view for the calendar: 6-week grid plus the in-month days. */
export function computeMonthDays(input: MonthScheduleInput): MonthSchedule {
  const index = indexShifts(input.userId, input.myShifts)
  const weeks = monthGrid(input.year, input.month).map((week) =>
    week.map(({ ymd, inMonth }) => buildDay(input, index, ymd, inMonth)),
  )
  return { year: input.year, month: input.month, weeks, days: weeks.flat().filter((d) => d.inMonth) }
}

// ---------------------------------------------------------------------------
// Plain-English duty lines (calendar day sheet, "Coming up", cell labels)
// ---------------------------------------------------------------------------

/** "0800–0800" / "1600–0800" for a shift type (the raw value if unknown). */
function typeHours(shiftType: string): string {
  return isShiftType(shiftType) ? SHIFT_TYPES[shiftType].description : shiftType
}

/** The hours of my day shift when I gave away only the PM. */
export const PM_GIVEN_AWAY_HOURS = '0800–1600'

/**
 * The hours I'm on duty that day in fire-service time, or null when I'm off:
 *   '0800–0800' my 24-hour tour day (or a picked-up 24-Hour)
 *   '0800–1600' my tour day with the PM given away
 *   '1600–0800' a picked-up PM
 */
export function dutyHours(day: Pick<ScheduleDay, 'base' | 'givenAway' | 'pmGivenAway' | 'pickedUp' | 'working'>): string | null {
  if (!day.working) return null
  if (day.pmGivenAway) return PM_GIVEN_AWAY_HOURS
  if (day.base && !day.givenAway) return typeHours('24-Hour')
  if (day.pickedUp) return typeHours(day.pickedUp.shiftType)
  return null
}

/**
 * One line for what I'm doing that day, or null on a plain day off:
 *   "You work 0800–0800"
 *   "You work 0800–1600 · PM covered by Mike Lee"
 *   "Off · 24-Hour covered by Mike Lee"
 *   "You work 1600–0800 · covering Ana Cruz"
 * `past` switches to "You worked …".
 */
export function dutySummary(
  day: Pick<ScheduleDay, 'base' | 'givenAway' | 'pmGivenAway' | 'pickedUp' | 'working'>,
  options: { past?: boolean } = {},
): string | null {
  const work = options.past ? 'You worked' : 'You work'
  const hours = dutyHours(day)
  if (day.pmGivenAway) {
    return `${work} ${hours} · PM covered by ${day.pmGivenAway.byName || 'another member'}`
  }
  if (day.pickedUp && hours && !(day.base && !day.givenAway)) {
    return `${work} ${hours} · covering ${day.pickedUp.forName || 'another member'}`
  }
  if (hours) return `${work} ${hours}`
  if (day.givenAway) {
    return `Off · ${day.givenAway.shiftType} covered by ${day.givenAway.byName || 'another member'}`
  }
  return null
}
