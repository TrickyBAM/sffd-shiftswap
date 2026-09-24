// Pure helpers for the Calendar screen (ARCHITECTURE §7.2 "Calendar colors"):
// visible ranges, the blue "open shifts you could take" counts, the
// plain-English status lines and actions for a day, the marks drawn in each
// grid cell, the "Coming up" list and balance copy.
// No I/O and no React, so everything here is unit-tested
// (tests/unit/calendar-model.test.ts).

import { plural, tourLabel } from '@/lib/format'
import { PM_GIVEN_AWAY_HOURS, type DayTone, type ScheduleDay, type ScheduleShift } from '@/lib/schedule/effective'
import { diffDays, formatDate, isStarted, isYmd, monthGrid, type Ymd } from '@/lib/sffd/dates'
import { isShiftType, SHIFT_TYPES } from '@/lib/sffd/shift-types'
import { stationLabel } from '@/lib/sffd/stations'
import { tourWorks } from '@/lib/sffd/tours'
import type { Shift } from '@/lib/types/database'

/** Shifts can be posted up to this many days ahead (post_shift TOO_FAR_AHEAD). */
export const POST_WINDOW_DAYS = 180

export interface YearMonth {
  year: number
  /** 1–12 */
  month: number
}

/** 'YYYY-MM' — the ?month= value and the cache key for a month. */
export function monthKey({ year, month }: YearMonth): string {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}`
}

const MONTH_PARAM_RE = /^(\d{4})-(\d{2})$/

/** Parses a ?month=YYYY-MM value (2019–2100); null when missing or invalid. */
export function parseMonthParam(value: unknown): YearMonth | null {
  if (typeof value !== 'string') return null
  const m = MONTH_PARAM_RE.exec(value.trim())
  if (!m) return null
  const year = Number(m[1])
  const month = Number(m[2])
  if (month < 1 || month > 12 || year < 2019 || year > 2100) return null
  return { year, month }
}

export interface DateRange {
  from: Ymd
  to: Ymd
}

/** First and last day of the 6-week grid shown for a month. */
export function visibleRange({ year, month }: YearMonth): DateRange {
  const weeks = monthGrid(year, month)
  return { from: weeks[0][0].ymd, to: weeks[weeks.length - 1][6].ymd }
}

/** The part of `range` from today on (open shifts only exist ahead); null when it's all past. */
export function futurePart(range: DateRange, today: Ymd): DateRange | null {
  if (range.to < today) return null
  return { from: range.from < today ? today : range.from, to: range.to }
}

// ---------------------------------------------------------------------------
// Open shifts I could take (the blue counts)
// ---------------------------------------------------------------------------

/**
 * The columns of an open shift the blue counts need. The rows come from the
 * same query as the Board's "Only shifts I can take" (listBoardShifts with
 * `eligibleFor`: open, not started, my rank, not mine, within the post's
 * accept limit), across every location.
 */
export interface OpenShiftLite {
  id: string
  date: Ymd
  shift_type: string
  starts_at: string
  return_dates: Ymd[]
}

/** Keeps only what the counts need (and what the offline snapshot stores). */
export function toOpenShiftLite(shift: Pick<Shift, 'id' | 'date' | 'shift_type' | 'starts_at' | 'return_dates'>): OpenShiftLite {
  return {
    id: shift.id,
    date: shift.date,
    shift_type: shift.shift_type,
    starts_at: shift.starts_at,
    return_dates: Array.isArray(shift.return_dates) ? shift.return_dates.filter(isYmd) : [],
  }
}

export interface TakeContext {
  userId: string
  /** My tour (1–31) or null for "No tour". */
  tour: number | null
  /** My open/covered shifts (as poster or coverer) through the next 180 days. */
  myShifts: readonly ScheduleShift[]
  now: Date
}

/**
 * Could I give `ymd` back as the return date of a SwapMatch? Mirrors the
 * database's private.can_give_return_date (RETURN_NOT_YOUR_DAY): that day's
 * shift hasn't started, it's one of my tour days (any day when I have no
 * tour), and I have no post and no picked-up shift that day.
 */
export function canGiveReturnDate(ymd: Ymd, shiftType: string, ctx: TakeContext): boolean {
  if (!isYmd(ymd) || !isShiftType(shiftType)) return false
  if (isStarted(ymd, shiftType, ctx.now)) return false
  if (ctx.tour != null && !tourWorks(ctx.tour, ymd)) return false
  return !ctx.myShifts.some(
    (s) =>
      s.date === ymd &&
      ((s.poster_id === ctx.userId && (s.status === 'open' || s.status === 'covered')) ||
        (s.coverer_id === ctx.userId && s.status === 'covered')),
  )
}

/**
 * Open shifts I could take, counted per date ({ '2026-10-14': 2 }). Drops
 * shifts that have started since they were loaded and SwapMatch posts where
 * none of the offered return dates is a day I could give. The day rule (I'm
 * working, covering or have my own post that day) is applied per day by
 * computeMonthDays() and availableCount().
 */
export function takeableCounts(open: readonly OpenShiftLite[], ctx: TakeContext): Record<Ymd, number> {
  const out: Record<Ymd, number> = {}
  const seen = new Set<string>()
  const nowMs = ctx.now.getTime()
  for (const shift of open) {
    if (seen.has(shift.id) || !isYmd(shift.date)) continue
    seen.add(shift.id)
    const startsAt = Date.parse(shift.starts_at)
    if (Number.isFinite(startsAt) && startsAt <= nowMs) continue
    if (shift.return_dates.length > 0 && !shift.return_dates.some((rd) => canGiveReturnDate(rd, shift.shift_type, ctx))) {
      continue
    }
    out[shift.date] = (out[shift.date] ?? 0) + 1
  }
  return out
}

// ---------------------------------------------------------------------------
// Shift lookups
// ---------------------------------------------------------------------------

export type ShiftLookup = ReadonlyMap<string, Shift>

/** Merges shift lists into an id → row map (later lists win). */
export function indexShifts(...lists: ReadonlyArray<readonly Shift[]>): Map<string, Shift> {
  const map = new Map<string, Shift>()
  for (const list of lists) for (const s of list) map.set(s.id, s)
  return map
}

/** Ids of SwapMatch partner legs referenced by `shifts` that aren't in `known`. */
export function missingPartnerIds(shifts: readonly Shift[], known: ShiftLookup): string[] {
  const out = new Set<string>()
  for (const s of shifts) {
    for (const id of [s.return_leg_of, s.return_leg_id]) {
      if (id && !known.has(id)) out.add(id)
    }
  }
  return [...out]
}

/** The other leg of a SwapMatch, when it's loaded. */
export function partnerLeg(
  shift: Pick<Shift, 'return_leg_of' | 'return_leg_id'>,
  lookup: ShiftLookup,
): Shift | null {
  const id = shift.return_leg_of ?? shift.return_leg_id
  return id ? (lookup.get(id) ?? null) : null
}

/** Trade page for a shift; a SwapMatch return leg opens its original trade. */
export function tradeHref(shiftId: string, lookup: ShiftLookup): string {
  const original = lookup.get(shiftId)?.return_leg_of ?? shiftId
  return `/trades/${encodeURIComponent(original)}`
}

// ---------------------------------------------------------------------------
// Names & small formatting
// ---------------------------------------------------------------------------

function words(name: string | null | undefined): string[] {
  return (name ?? '').trim().split(/\s+/).filter(Boolean)
}

/** "Mike Lee" → "Mike". */
export function firstName(name: string | null | undefined): string {
  return words(name)[0] ?? 'them'
}

/** "Mike Lee" → "M. Lee" (fits in a calendar cell); one word stays as is. */
export function shortName(name: string | null | undefined): string {
  const w = words(name)
  if (w.length === 0) return ''
  if (w.length === 1) return w[0]
  return `${w[0][0]}. ${w[w.length - 1]}`
}

/** "24-Hour · 0800–0800" / "PM · 1600–0800". */
export function shiftTypeDetail(shiftType: string): string {
  return isShiftType(shiftType) ? `${shiftType} · ${SHIFT_TYPES[shiftType].description}` : shiftType
}

/** "Today", "Tomorrow" or "Wed, Oct 14". */
export function relativeDay(ymd: Ymd, today: Ymd): string {
  const d = diffDays(today, ymd)
  if (d === 0) return 'Today'
  if (d === 1) return 'Tomorrow'
  return formatDate(ymd, 'weekday')
}

// ---------------------------------------------------------------------------
// One day: status lines, actions and grid marks
// ---------------------------------------------------------------------------

export interface DayContext {
  /** My tour (1–31) or null for "No tour". */
  tour: number | null
  today: Ymd
  now: Date
  /** Every loaded shift (mine plus SwapMatch partner legs), by id. */
  lookup: ShiftLookup
}

/** Colour family of a status line / mark; matches the calendar legend. */
export type LineTone = 'working' | 'openPost' | 'available' | 'covering' | 'swap' | 'givenAway' | 'off' | 'note'

export interface StatusLine {
  tone: LineTone
  text: string
  /** Secondary text, e.g. "24-Hour · 0800–0800". */
  detail?: string
}

/** Open shifts I could request that day (none on past days or when I have my own post there). */
export function availableCount(day: ScheduleDay): number {
  if (day.isPast || day.openPost) return 0
  return day.availableCount
}

export type Postability = 'ok' | 'taken' | 'not-your-day' | 'started' | 'too-far'

/**
 * Can I post this day from the calendar? Tour members: only their own tour days
 * (post_shift NOT_YOUR_SHIFT_DAY). Members without a tour can post any day.
 * Never a day already posted, given away or picked up, one that has started
 * (the PM start is the latest a shift on that day can begin) or one more than
 * 180 days out.
 */
export function postability(day: ScheduleDay, ctx: Pick<DayContext, 'tour' | 'today' | 'now'>): Postability {
  if (day.givenAway || day.openPost || day.pickedUp) return 'taken'
  if (ctx.tour != null && !day.base) return 'not-your-day'
  if (day.ymd < ctx.today || isStarted(day.ymd, 'PM', ctx.now)) return 'started'
  if (diffDays(ctx.today, day.ymd) > POST_WINDOW_DAYS) return 'too-far'
  return 'ok'
}

/** Plain-English lines for the day sheet: what I'm doing that day and why. */
export function describeDay(day: ScheduleDay, ctx: DayContext): StatusLine[] {
  const lines: StatusLine[] = []
  const past = day.ymd < ctx.today
  const tourText = ctx.tour != null ? ` (${tourLabel(ctx.tour)})` : ''
  const onDuty = past ? 'You were on duty' : "You're on duty"

  if (day.pmGivenAway) {
    // Only the PM is covered: I still work the day part (TF-1).
    lines.push({
      tone: 'working',
      text: `${onDuty} ${PM_GIVEN_AWAY_HOURS}${tourText}.`,
      detail: `PM covered by ${day.pmGivenAway.byName || 'another member'}`,
    })
  } else if (day.base && !day.givenAway) {
    lines.push({ tone: 'working', text: `${onDuty}${tourText}.` })
  }

  if (day.openPost) {
    lines.push({
      tone: 'openPost',
      text: past ? 'Nobody took the shift you posted.' : "You posted this shift. It's open for someone to take.",
      detail: shiftTypeDetail(day.openPost.shiftType),
    })
  }

  // A plain PM give-away is fully described by the on-duty line above; a
  // SwapMatch one still needs the "you work their shift on …" part.
  if (day.givenAway && (!day.pmGivenAway || day.givenAway.isSwap)) {
    const g = day.givenAway
    const name = g.byName || 'Another member'
    const lead = `${name} ${past ? 'covered' : 'is covering'} ${day.pmGivenAway ? 'your PM' : 'you'}`
    let text = `${lead}.`
    if (g.isSwap) {
      const row = ctx.lookup.get(g.shiftId)
      const other = row ? partnerLeg(row, ctx.lookup) : null
      text = other
        ? `${lead} — SwapMatch: you ${other.date < ctx.today ? 'worked' : 'work'} ${firstName(name)}'s shift on ${formatDate(other.date, 'weekday')}.`
        : `${lead} — SwapMatch.`
    }
    lines.push({ tone: 'givenAway', text, detail: shiftTypeDetail(g.shiftType) })
  }

  if (day.pickedUp) {
    const p = day.pickedUp
    const row = ctx.lookup.get(p.shiftId)
    const name = p.forName || 'another member'
    const where = row ? ` at ${stationLabel(row.station)}` : ''
    const lead = past ? `You covered ${name}${where}` : `You're covering ${name}${where}`
    let text = `${lead}.`
    if (p.isSwap) {
      const other = row ? partnerLeg(row, ctx.lookup) : null
      text = other
        ? `${lead} — SwapMatch: ${firstName(name)} ${other.date < ctx.today ? 'covered' : 'covers'} you on ${formatDate(other.date, 'weekday')}.`
        : `${lead} — SwapMatch.`
    }
    lines.push({ tone: p.isSwap ? 'swap' : 'covering', text, detail: shiftTypeDetail(p.shiftType) })
  }

  const open = availableCount(day)
  if (open > 0) {
    lines.push({ tone: 'available', text: `${plural(open, 'open shift')} you could take.` })
  }

  if (lines.length === 0) {
    const text = ctx.tour == null ? 'Nothing scheduled.' : past ? 'You were off.' : "You're off."
    lines.push({ tone: 'off', text })
  }

  if (day.base && postability(day, ctx) === 'too-far') {
    lines.push({ tone: 'note', text: `Shifts can be posted up to ${POST_WINDOW_DAYS} days ahead.` })
  }

  return lines
}

export interface DayAction {
  key: string
  kind: 'post' | 'board' | 'trade'
  label: string
  href: string
}

/**
 * The Board for one day showing the same shifts the blue count counts: every
 * location, "Only shifts I can take" on (scope=all; the Board's default is my
 * battalion).
 */
export function boardDayHref(ymd: Ymd): string {
  return `/board?date=${encodeURIComponent(ymd)}&scope=all`
}

/** Buttons for the day sheet: Post this shift, See N available shifts, View trade. */
export function dayActions(day: ScheduleDay, ctx: DayContext): DayAction[] {
  const actions: DayAction[] = []
  if (postability(day, ctx) === 'ok') {
    actions.push({
      key: 'post',
      kind: 'post',
      label: ctx.tour == null ? 'Post a shift on this day' : 'Post this shift',
      href: `/post?date=${day.ymd}`,
    })
  }
  const open = availableCount(day)
  if (open > 0) {
    actions.push({
      key: 'board',
      kind: 'board',
      label: `See ${plural(open, 'available shift')}`,
      href: boardDayHref(day.ymd),
    })
  }
  if (day.openPost) {
    actions.push({
      key: `trade-${day.openPost.shiftId}`,
      kind: 'trade',
      label: 'View your post',
      href: tradeHref(day.openPost.shiftId, ctx.lookup),
    })
  }
  if (day.givenAway) {
    actions.push({
      key: `trade-${day.givenAway.shiftId}`,
      kind: 'trade',
      label: day.givenAway.byName ? `View trade with ${day.givenAway.byName}` : 'View trade',
      href: tradeHref(day.givenAway.shiftId, ctx.lookup),
    })
  }
  if (day.pickedUp) {
    actions.push({
      key: `trade-${day.pickedUp.shiftId}`,
      kind: 'trade',
      label: day.pickedUp.forName ? `View trade with ${day.pickedUp.forName}` : 'View trade',
      href: tradeHref(day.pickedUp.shiftId, ctx.lookup),
    })
  }
  return actions
}

export type BarKind = 'working' | 'openPost' | 'covering' | 'swap' | 'available'

export interface DayBar {
  kind: BarKind
  /** The open-shift count for 'available'. */
  count?: number
}

export interface DayMarks {
  bars: DayBar[]
  /**
   * Someone covers my shift that day: red outline. With a red "working" bar
   * as well when they cover only the PM (I still work 0800–1600).
   */
  outlined: boolean
  /** Short name of whoever covers me ("M. Lee"), for the outlined cell. */
  coveredBy: string | null
  /** Phrases for the cell's accessible name ("on duty", "covered by Mike Lee"). */
  phrases: string[]
}

/** What a grid cell shows (ARCHITECTURE §7.2 colours; the legend explains each). */
export function dayMarks(day: ScheduleDay): DayMarks {
  const bars: DayBar[] = []
  const phrases: string[] = []

  if (day.pmGivenAway) {
    bars.push({ kind: 'working' })
    phrases.push(`on duty ${PM_GIVEN_AWAY_HOURS}`)
  } else if (day.base && !day.givenAway) {
    bars.push({ kind: 'working' })
    phrases.push('on duty')
  }
  if (day.openPost) {
    bars.push({ kind: 'openPost' })
    phrases.push('your shift is posted')
  }
  if (day.pickedUp) {
    bars.push({ kind: day.pickedUp.isSwap ? 'swap' : 'covering' })
    phrases.push(`you're covering ${day.pickedUp.forName || 'someone'}`)
    if (day.pickedUp.isSwap) phrases.push('SwapMatch')
  }
  if (day.givenAway) {
    if (day.givenAway.isSwap) bars.push({ kind: 'swap' })
    phrases.push(`${day.pmGivenAway ? 'PM covered by' : 'covered by'} ${day.givenAway.byName || 'another member'}`)
    if (day.givenAway.isSwap) phrases.push('SwapMatch')
  }
  const open = availableCount(day)
  if (open > 0) {
    bars.push({ kind: 'available', count: open })
    phrases.push(`${plural(open, 'open shift')} you could take`)
  }

  return {
    bars,
    outlined: Boolean(day.givenAway),
    coveredBy: day.givenAway ? shortName(day.givenAway.byName) || null : null,
    phrases,
  }
}

/** Accessible name for a grid cell: "Wednesday, September 23, 2026, today: on duty, 2 open shifts you could take". */
export function dayAriaLabel(day: ScheduleDay): string {
  const { phrases } = dayMarks(day)
  const date = formatDate(day.ymd, 'long')
  const today = day.isToday ? ', today' : ''
  return phrases.length ? `${date}${today}: ${phrases.join(', ')}` : `${date}${today}`
}

// ---------------------------------------------------------------------------
// Coming up
// ---------------------------------------------------------------------------

export interface ComingUpItem {
  ymd: Ymd
  /** "Today", "Tomorrow", "Wed, Oct 14". */
  when: string
  title: string
  detail: string
  tone: DayTone
  outlined: boolean
}

/**
 * My next commitments, one row per day, soonest first: days I work (tour days
 * and pickups), days someone covers me, and my open posts.
 */
export function comingUp(days: readonly ScheduleDay[], ctx: DayContext, limit = 5): ComingUpItem[] {
  const items: ComingUpItem[] = []
  const sorted = [...days].sort((a, b) => (a.ymd < b.ymd ? -1 : a.ymd > b.ymd ? 1 : 0))
  for (const day of sorted) {
    if (items.length >= limit) break
    if (day.ymd < ctx.today) continue
    const item = comingUpItem(day, ctx)
    if (item) items.push(item)
  }
  return items
}

function comingUpItem(day: ScheduleDay, ctx: DayContext): ComingUpItem | null {
  const base = { ymd: day.ymd, when: relativeDay(day.ymd, ctx.today), outlined: false }
  if (day.pickedUp) {
    const p = day.pickedUp
    const row = ctx.lookup.get(p.shiftId)
    const parts = [row ? stationLabel(row.station) : null, p.shiftType, p.isSwap ? 'SwapMatch' : null]
    return {
      ...base,
      title: `Covering ${p.forName || 'another member'}`,
      detail: parts.filter(Boolean).join(' · '),
      tone: p.isSwap ? 'swap' : 'covering',
    }
  }
  if (day.openPost) {
    return {
      ...base,
      title: 'Your shift is posted',
      detail: `${day.openPost.shiftType} · waiting for someone to take it`,
      tone: 'openPost',
    }
  }
  if (day.pmGivenAway) {
    // I still work the day part; only the PM is covered (TF-1).
    const g = day.pmGivenAway
    return {
      ...base,
      title: `On duty ${PM_GIVEN_AWAY_HOURS}`,
      detail: [`PM covered by ${g.byName || 'another member'}`, g.isSwap ? 'SwapMatch' : null].filter(Boolean).join(' · '),
      tone: g.isSwap ? 'swap' : 'working',
      outlined: true,
    }
  }
  if (day.givenAway) {
    const g = day.givenAway
    return {
      ...base,
      title: `${g.byName || 'Another member'} is covering you`,
      detail: [g.shiftType, g.isSwap ? 'SwapMatch' : null].filter(Boolean).join(' · '),
      tone: g.isSwap ? 'swap' : 'givenAway',
      outlined: true,
    }
  }
  if (day.base) {
    return { ...base, title: 'On duty', detail: ctx.tour != null ? tourLabel(ctx.tour) : 'Your shift', tone: 'working' }
  }
  return null
}

// ---------------------------------------------------------------------------
// Balance
// ---------------------------------------------------------------------------

export interface BalanceNumbers {
  covered: number
  given: number
  balance: number
}

/** "You're 1 shift ahead." / "You're 2 shifts behind." / "You're even." / "No trades yet." */
export function balanceHeadline({ covered, given, balance }: BalanceNumbers): string {
  if (covered === 0 && given === 0) return 'No trades yet.'
  if (balance > 0) return `You're ${plural(balance, 'shift')} ahead.`
  if (balance < 0) return `You're ${plural(-balance, 'shift')} behind.`
  return "You're even."
}

/** One supportive sentence under the headline. */
export function balanceDetail({ covered, given, balance }: BalanceNumbers): string {
  if (covered === 0 && given === 0) return 'Shifts you cover and give away will be counted here.'
  if (balance > 0) return "You've covered more shifts than others have covered for you."
  if (balance < 0) return 'Others have covered more for you. Picking up a shift evens it out.'
  return "You've covered as many shifts as you've given away."
}
