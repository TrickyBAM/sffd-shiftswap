// Calendar-day helpers (ARCHITECTURE §3).
//
// A "date" everywhere in the app is a plain 'YYYY-MM-DD' string naming a
// calendar day in America/Los_Angeles. Never hand one to `new Date(ymd)`: that
// parses as UTC midnight and shows the previous day in California. Everything
// here works on integer day numbers (days since 1970-01-01) derived with
// Date.UTC, so results never depend on the machine's time zone.

import { SHIFT_TYPES, type ShiftType } from './shift-types'

/** A 'YYYY-MM-DD' calendar-day string. */
export type Ymd = string

export const PT_TIME_ZONE = 'America/Los_Angeles'

const DAY_MS = 86_400_000
const YMD_RE = /^(\d{4})-(\d{2})-(\d{2})$/

/** Non-negative modulo. */
function mod(a: number, n: number): number {
  return ((a % n) + n) % n
}

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

// ---------------------------------------------------------------------------
// Validation & conversion
// ---------------------------------------------------------------------------

/** True when `value` is a well-formed, real calendar date ('2026-02-30' is not). */
export function isYmd(value: unknown): value is Ymd {
  if (typeof value !== 'string') return false
  const m = YMD_RE.exec(value)
  if (!m) return false
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])]
  if (y < 1 || mo < 1 || mo > 12 || d < 1) return false
  return d <= daysInMonth(y, mo)
}

/** Returns `value` unchanged if valid, otherwise throws a RangeError. */
export function assertYmd(value: unknown, what = 'date'): Ymd {
  if (!isYmd(value)) throw new RangeError(`Invalid ${what}: ${JSON.stringify(value)} (expected YYYY-MM-DD)`)
  return value
}

/** Splits a date into numeric parts (month is 1–12). */
export function parseYmd(ymd: Ymd): { year: number; month: number; day: number } {
  assertYmd(ymd)
  return { year: Number(ymd.slice(0, 4)), month: Number(ymd.slice(5, 7)), day: Number(ymd.slice(8, 10)) }
}

/**
 * Builds a date from parts (month 1–12). Out-of-range parts roll over the way
 * Date.UTC does, e.g. makeYmd(2026, 13, 1) → '2027-01-01'.
 */
export function makeYmd(year: number, month: number, day: number): Ymd {
  return dayNumberToYmd(Math.round(Date.UTC(year, month - 1, day) / DAY_MS))
}

/** Days since 1970-01-01 (negative before). Throws on an invalid date. */
export function ymdToDayNumber(ymd: Ymd): number {
  const { year, month, day } = parseYmd(ymd)
  // Date.UTC treats years 0–99 as 1900–1999; setUTCFullYear avoids that.
  const d = new Date(Date.UTC(2000, month - 1, day))
  d.setUTCFullYear(year)
  return Math.round(d.getTime() / DAY_MS)
}

/** Inverse of ymdToDayNumber. */
export function dayNumberToYmd(n: number): Ymd {
  if (!Number.isInteger(n)) throw new RangeError(`Invalid day number: ${n}`)
  const d = new Date(n * DAY_MS)
  const y = d.getUTCFullYear()
  if (y < 1 || y > 9999) throw new RangeError(`Day number out of range: ${n}`)
  return `${String(y).padStart(4, '0')}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`
}

// ---------------------------------------------------------------------------
// Arithmetic
// ---------------------------------------------------------------------------

export function addDays(ymd: Ymd, n: number): Ymd {
  if (!Number.isInteger(n)) throw new RangeError(`addDays: n must be an integer, got ${n}`)
  return dayNumberToYmd(ymdToDayNumber(ymd) + n)
}

/**
 * Number of days from `a` to `b` (b − a): diffDays('2026-09-23', '2026-09-25') === 2.
 * Mirrors "daysBetween(a, b)" in ARCHITECTURE §4.
 */
export function diffDays(a: Ymd, b: Ymd): number {
  return ymdToDayNumber(b) - ymdToDayNumber(a)
}

/** Day of week, 0 = Sunday … 6 = Saturday. */
export function dayOfWeek(ymd: Ymd): number {
  // 1970-01-01 was a Thursday (4).
  return mod(ymdToDayNumber(ymd) + 4, 7)
}

/** -1 / 0 / 1 ordering of two dates (works as an Array.sort comparator). */
export function compareYmd(a: Ymd, b: Ymd): -1 | 0 | 1 {
  assertYmd(a)
  assertYmd(b)
  return a < b ? -1 : a > b ? 1 : 0
}

/** True when from <= ymd <= to (inclusive). */
export function isBetween(ymd: Ymd, from: Ymd, to: Ymd): boolean {
  return compareYmd(ymd, from) >= 0 && compareYmd(ymd, to) <= 0
}

export function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0
}

/** Days in a month (month 1–12). */
export function daysInMonth(year: number, month: number): number {
  if (month === 2) return isLeapYear(year) ? 29 : 28
  return [4, 6, 9, 11].includes(month) ? 30 : 31
}

/** { year, month } of a date (month 1–12). */
export function monthOf(ymd: Ymd): { year: number; month: number } {
  const { year, month } = parseYmd(ymd)
  return { year, month }
}

/** Moves a (year, month) pair by `delta` months: shiftMonth(2026, 12, 1) → { 2027, 1 }. */
export function shiftMonth(year: number, month: number, delta: number): { year: number; month: number } {
  const index = year * 12 + (month - 1) + delta
  return { year: Math.floor(index / 12), month: mod(index, 12) + 1 }
}

/** Every date from `from` to `to`, inclusive. Empty when to < from. */
export function eachDay(from: Ymd, to: Ymd): Ymd[] {
  const start = ymdToDayNumber(from)
  const end = ymdToDayNumber(to)
  const out: Ymd[] = []
  for (let n = start; n <= end; n++) out.push(dayNumberToYmd(n))
  return out
}

// ---------------------------------------------------------------------------
// Month grid (Sunday-first, always 6 weeks so the calendar never jumps height)
// ---------------------------------------------------------------------------

export interface GridDay {
  ymd: Ymd
  /** False for the leading/trailing days that belong to the adjacent months. */
  inMonth: boolean
}

export function monthGrid(year: number, month: number): GridDay[][] {
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    throw new RangeError(`monthGrid: invalid year/month ${year}-${month}`)
  }
  const first = makeYmd(year, month, 1)
  const start = ymdToDayNumber(first) - dayOfWeek(first)
  const weeks: GridDay[][] = []
  for (let w = 0; w < 6; w++) {
    const week: GridDay[] = []
    for (let d = 0; d < 7; d++) {
      const ymd = dayNumberToYmd(start + w * 7 + d)
      week.push({ ymd, inMonth: Number(ymd.slice(5, 7)) === month && Number(ymd.slice(0, 4)) === year })
    }
    weeks.push(week)
  }
  return weeks
}

// ---------------------------------------------------------------------------
// Pacific-time instants
// ---------------------------------------------------------------------------

let ptPartsFormatter: Intl.DateTimeFormat | undefined

function ptParts(instant: Date) {
  ptPartsFormatter ??= new Intl.DateTimeFormat('en-US', {
    timeZone: PT_TIME_ZONE,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
  const parts: Record<string, number> = {}
  for (const p of ptPartsFormatter.formatToParts(instant)) {
    if (p.type !== 'literal') parts[p.type] = Number(p.value)
  }
  return {
    year: parts.year,
    month: parts.month,
    day: parts.day,
    hour: parts.hour === 24 ? 0 : parts.hour,
    minute: parts.minute,
    second: parts.second,
  }
}

/** Today's date in San Francisco. Pass `now` in tests. */
export function todayPT(now: Date = new Date()): Ymd {
  const p = ptParts(now)
  return `${String(p.year).padStart(4, '0')}-${pad2(p.month)}-${pad2(p.day)}`
}

/** Offset of Pacific time from UTC at `instant`, in minutes (−480 PST, −420 PDT). */
function ptOffsetMinutes(instant: Date): number {
  const p = ptParts(instant)
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second)
  return Math.round((asUtc - Math.floor(instant.getTime() / 1000) * 1000) / 60_000)
}

/**
 * The instant a wall-clock time on `ymd` occurs in America/Los_Angeles.
 * `time` is 'HH:MM' (24-hour). DST-correct for every time the app uses
 * (08:00 and 16:00 are never inside a DST transition).
 */
export function ptWallTimeToDate(ymd: Ymd, time: string): Date {
  const { year, month, day } = parseYmd(ymd)
  const m = /^(\d{2}):(\d{2})$/.exec(time)
  if (!m) throw new RangeError(`Invalid time: ${JSON.stringify(time)} (expected HH:MM)`)
  const wall = Date.UTC(year, month - 1, day, Number(m[1]), Number(m[2]))
  // Two passes settle the offset even when the first guess lands across a DST change.
  let utc = wall - ptOffsetMinutes(new Date(wall)) * 60_000
  utc = wall - ptOffsetMinutes(new Date(utc)) * 60_000
  return new Date(utc)
}

/** When a shift starts: 08:00 (24-Hour) or 16:00 (PM) Pacific on its date. */
export function shiftStartsAt(ymd: Ymd, shiftType: ShiftType): Date {
  const info = SHIFT_TYPES[shiftType]
  if (!info) throw new RangeError(`Unknown shift type: ${JSON.stringify(shiftType)}`)
  return ptWallTimeToDate(ymd, info.startTime)
}

/** ISO-8601 (UTC, 'Z') start instant — same value as SQL public.shift_starts_at(). */
export function startsAtISO(ymd: Ymd, shiftType: ShiftType): string {
  return shiftStartsAt(ymd, shiftType).toISOString()
}

/** "Started"/"past" means starts_at <= now (ARCHITECTURE §3). */
export function isStarted(ymd: Ymd, shiftType: ShiftType, now: Date = new Date()): boolean {
  return shiftStartsAt(ymd, shiftType).getTime() <= now.getTime()
}

// ---------------------------------------------------------------------------
// Display
// ---------------------------------------------------------------------------

export type DateStyle = 'short' | 'medium' | 'long' | 'weekday' | 'monthYear'

const DATE_STYLE_OPTIONS: Record<DateStyle, Intl.DateTimeFormatOptions> = {
  short: { month: 'short', day: 'numeric' }, //                        Sep 23
  medium: { month: 'short', day: 'numeric', year: 'numeric' }, //      Sep 23, 2026
  long: { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }, // Wednesday, September 23, 2026
  weekday: { weekday: 'short', month: 'short', day: 'numeric' }, //    Wed, Sep 23
  monthYear: { month: 'long', year: 'numeric' }, //                    September 2026
}

const dateFormatters = new Map<DateStyle, Intl.DateTimeFormat>()

/**
 * Formats a calendar date for display (en-US). The date is built at UTC
 * midnight and formatted in UTC, so the output never shifts a day.
 */
export function formatDate(ymd: Ymd, style: DateStyle = 'medium'): string {
  const options = DATE_STYLE_OPTIONS[style]
  if (!options) throw new RangeError(`Unknown date style: ${style}`)
  let fmt = dateFormatters.get(style)
  if (!fmt) {
    fmt = new Intl.DateTimeFormat('en-US', { ...options, timeZone: 'UTC' })
    dateFormatters.set(style, fmt)
  }
  return fmt.format(new Date(ymdToDayNumber(ymd) * DAY_MS))
}

/** Month name + year for a (year, month) pair, e.g. 'September 2026'. */
export function formatMonth(year: number, month: number): string {
  return formatDate(makeYmd(year, month, 1), 'monthYear')
}

let timeFormatter: Intl.DateTimeFormat | undefined

/** Clock time in Pacific time, e.g. '3:45 PM' (for "updated HH:MM" ribbons). */
export function formatTimePT(instant: Date | string | number): string {
  const d = instant instanceof Date ? instant : new Date(instant)
  if (Number.isNaN(d.getTime())) throw new RangeError(`Invalid instant: ${String(instant)}`)
  timeFormatter ??= new Intl.DateTimeFormat('en-US', { timeZone: PT_TIME_ZONE, hour: 'numeric', minute: '2-digit' })
  // Newer ICU versions put a narrow no-break space before AM/PM; normalise it so
  // server- and browser-rendered text match.
  return timeFormatter.format(d).replace(/[  ]/g, ' ')
}
