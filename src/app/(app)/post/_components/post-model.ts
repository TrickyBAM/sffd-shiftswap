// Pure rules and copy for the "Post a shift" form (ARCHITECTURE §6.3 post_shift,
// §7.2 "Post"). The database is authoritative; these mirror its rules so the
// form can explain problems before anything is sent. No I/O and no React, so
// everything here is unit-tested (tests/unit/post-model.test.ts).

import type { PostShiftInput } from '@/lib/api'
import type { AppErrorCode } from '@/lib/errors'
import type { ScheduleDay } from '@/lib/schedule/effective'
import { addDays, diffDays, formatDate, isStarted, isYmd, monthOf, type Ymd } from '@/lib/sffd/dates'
import { SHIFT_TYPES, type ShiftType } from '@/lib/sffd/shift-types'
import {
  battalionLabel,
  divisionLabel,
  isStation,
  stationInfo,
  stationLabel,
  stationPathLabel,
} from '@/lib/sffd/stations'
import { tourWorks } from '@/lib/sffd/tours'
import type { AcceptLimit } from '@/lib/types/database'
import { POST_WINDOW_DAYS } from '../../calendar/_components/calendar-model'

/** Shifts can be posted (and offered back) up to this many days ahead (TOO_FAR_AHEAD). */
export { POST_WINDOW_DAYS }
/** SwapMatch return dates a post can offer. */
export const MAX_RETURN_DATES = 10
/** Longest note (characters). */
export const NOTES_MAX = 500

// ---------------------------------------------------------------------------
// Context: who is posting and what their schedule looks like
// ---------------------------------------------------------------------------

export interface PostContext {
  /** My tour (1–31) or null for "No tour". */
  tour: number | null
  /** Today in San Francisco. */
  today: Ymd
  now: Date
  /** My effective schedule for today … today + 180, by date (computeDays()). */
  days: ReadonlyMap<Ymd, ScheduleDay>
}

/** Last date a shift can be posted or offered back. */
export function lastPostableDate(today: Ymd): Ymd {
  return addDays(today, POST_WINDOW_DAYS)
}

/** The months the pickers can show: this month … the month of today + 180. */
export function pickerMonths(today: Ymd): { first: { year: number; month: number }; last: { year: number; month: number } } {
  return { first: monthOf(today), last: monthOf(lastPostableDate(today)) }
}

// ---------------------------------------------------------------------------
// The shift date
// ---------------------------------------------------------------------------

/** Why a date can't be posted. */
export type DateBlock =
  | 'invalid'
  | 'past'
  | 'started'
  | 'too-far'
  | 'posted'
  | 'given-away'
  | 'covering'
  | 'not-your-day'

export const DATE_BLOCK_MESSAGE: Readonly<Record<DateBlock, string>> = Object.freeze({
  invalid: 'Choose a valid date.',
  past: 'That day has already passed.',
  started: 'That shift has already started.',
  'too-far': `Shifts can be posted up to ${POST_WINDOW_DAYS} days ahead.`,
  posted: "You've already posted that shift.",
  'given-away': 'Someone is already covering you that day.',
  covering: "You're covering someone that day. Picked-up shifts can't be traded again.",
  'not-your-day': "That isn't one of your tour days.",
})

/** Short reason for a crossed-out day in the date picker. */
export const DATE_BLOCK_SHORT: Readonly<Record<DateBlock, string>> = Object.freeze({
  invalid: 'not available',
  past: 'already passed',
  started: 'already started',
  'too-far': 'too far ahead',
  posted: 'already posted',
  'given-away': 'already traded',
  covering: "you're covering someone",
  'not-your-day': 'not your tour day',
})

/**
 * Can I post `ymd`? null = yes (for at least the PM shift; see typeStarted()).
 * Mirrors post_shift: not started, at most 180 days out, one of my tour days
 * when I have a tour, and not already posted or traded. Picked-up days can't
 * be re-traded in v1.
 */
export function dateBlock(ymd: unknown, ctx: PostContext): DateBlock | null {
  if (!isYmd(ymd)) return 'invalid'
  if (ymd < ctx.today) return 'past'
  if (diffDays(ctx.today, ymd) > POST_WINDOW_DAYS) return 'too-far'
  // Only today's shifts can have started; PM (16:00) is the latest a shift on a day can start.
  if (ymd === ctx.today && isStarted(ymd, 'PM', ctx.now)) return 'started'
  const day = ctx.days.get(ymd)
  if (day?.openPost) return 'posted'
  if (day?.givenAway) return 'given-away'
  if (day?.pickedUp) return 'covering'
  if (ctx.tour != null && !tourWorks(ctx.tour, ymd)) return 'not-your-day'
  return null
}

/** My tour days I can post, today … today + 180 (empty for "No tour"). */
export function postableTourDays(ctx: PostContext): Ymd[] {
  if (ctx.tour == null) return []
  const out: Ymd[] = []
  const last = lastPostableDate(ctx.today)
  for (let d = ctx.today; d <= last; d = addDays(d, 1)) {
    if (tourWorks(ctx.tour, d) && dateBlock(d, ctx) === null) out.push(d)
  }
  return out
}

/** True when this type's shift on `ymd` has already started (e.g. today's 24-Hour after 08:00). */
export function typeStarted(ymd: Ymd | null, shiftType: ShiftType, now: Date): boolean {
  return ymd !== null && isYmd(ymd) && isStarted(ymd, shiftType, now)
}

/**
 * The shift type to use after picking `ymd`: keeps the current one unless it
 * has already started and the other hasn't (today after 08:00 ⇒ PM).
 */
export function typeForDate(ymd: Ymd, current: ShiftType, now: Date): ShiftType {
  if (!typeStarted(ymd, current, now)) return current
  const other: ShiftType = current === '24-Hour' ? 'PM' : '24-Hour'
  return typeStarted(ymd, other, now) ? current : other
}

/** Result of reading ?date= from the URL. */
export interface DateParam {
  date: Ymd | null
  /** Why the date wasn't used (shown above the form), or null. */
  notice: string | null
}

/** Validates a ?date=YYYY-MM-DD prefill against the posting rules. */
export function parseDateParam(value: string | null | undefined, ctx: PostContext): DateParam {
  if (value == null || value === '') return { date: null, notice: null }
  if (!isYmd(value)) return { date: null, notice: "That link's date isn't valid. Pick a day below." }
  const block = dateBlock(value, ctx)
  if (block) {
    return { date: null, notice: `${formatDate(value, 'long')} can't be posted. ${DATE_BLOCK_MESSAGE[block]}` }
  }
  return { date: value, notice: null }
}

// ---------------------------------------------------------------------------
// SwapMatch return dates
// ---------------------------------------------------------------------------

/** Why a day can't be offered as a SwapMatch return date. */
export type ReturnBlock = 'invalid' | 'past' | 'too-far' | 'post-date' | 'working' | 'posted' | 'given-away'

export const RETURN_BLOCK_MESSAGE: Readonly<Record<ReturnBlock, string>> = Object.freeze({
  invalid: 'not a valid date',
  past: 'already passed',
  'too-far': `more than ${POST_WINDOW_DAYS} days ahead`,
  'post-date': "that's the shift you're posting",
  working: "you're working that day",
  posted: "you've posted a shift that day",
  'given-away': 'someone is covering you that day',
})

/**
 * Can I offer `ymd` as a return date? null = yes. It must be one of my days
 * off (I'd work their shift then), not the posted date, in the future for this
 * shift type and at most 180 days out. Days I've posted or traded away are out
 * too: confirming the swap would fail (POSTER_WORKS_RETURN_DAY).
 */
export function returnDateBlock(
  ymd: unknown,
  ctx: PostContext,
  opts: { postDate: Ymd | null; shiftType: ShiftType },
): ReturnBlock | null {
  if (!isYmd(ymd)) return 'invalid'
  if (ymd < ctx.today || (ymd === ctx.today && isStarted(ymd, opts.shiftType, ctx.now))) return 'past'
  if (diffDays(ctx.today, ymd) > POST_WINDOW_DAYS) return 'too-far'
  if (ymd === opts.postDate) return 'post-date'
  const day = ctx.days.get(ymd)
  const working = day ? day.working : tourWorks(ctx.tour, ymd)
  if (working) return 'working'
  if (day?.openPost) return 'posted'
  if (day?.givenAway) return 'given-away'
  return null
}

/** Sorted, de-duplicated copy of a date list. */
export function sortDates(dates: readonly Ymd[]): Ymd[] {
  return [...new Set(dates)].sort()
}

/** Adds or removes `ymd` (never more than MAX_RETURN_DATES). */
export function toggleReturnDate(dates: readonly Ymd[], ymd: Ymd): Ymd[] {
  if (dates.includes(ymd)) return dates.filter((d) => d !== ymd)
  if (dates.length >= MAX_RETURN_DATES) return [...dates]
  return sortDates([...dates, ymd])
}

// ---------------------------------------------------------------------------
// Who can take it
// ---------------------------------------------------------------------------

export const ACCEPT_LIMIT_ORDER: readonly AcceptLimit[] = Object.freeze(['anyone', 'division', 'battalion', 'station'])

/**
 * Segment label. The limit is relative to the shift's station, so it reads
 * "My Battalion" while the shift is at my station and "Battalion 9" otherwise.
 */
export function acceptLimitLabel(limit: AcceptLimit, station: number | null, myStation: number | null): string {
  if (limit === 'anyone') return 'Anyone'
  const info = station != null ? stationInfo(station) : null
  const mine = !info || station === myStation
  if (limit === 'division') return mine ? 'My Division' : divisionLabel(info.division)
  if (limit === 'battalion') return mine ? 'My Battalion' : battalionLabel(info.battalion)
  return mine ? 'My Station' : stationLabel(info.station)
}

/** "Firefighter" → "Firefighters"; null → "members". */
export function rankPlural(rank: string | null | undefined): string {
  return rank ? `${rank}s` : 'members'
}

/** One line under the "Who can take it" control. */
export function acceptLimitExplanation(limit: AcceptLimit, station: number | null, rank: string | null): string {
  const who = rankPlural(rank)
  const info = station != null ? stationInfo(station) : null
  if (limit === 'anyone' || !info) return `Any ${rank ?? 'member'} in the department can ask for it.`
  if (limit === 'division') return `Only ${who} in ${divisionLabel(info.division)} can ask for it.`
  if (limit === 'battalion') return `Only ${who} in ${battalionLabel(info.battalion)} can ask for it.`
  return `Only ${who} assigned to ${stationLabel(info.station)} can ask for it.`
}

// ---------------------------------------------------------------------------
// The whole form
// ---------------------------------------------------------------------------

export interface PostDraft {
  date: Ymd | null
  shiftType: ShiftType
  station: number | null
  swapMatch: boolean
  returnDates: Ymd[]
  acceptLimit: AcceptLimit
  notes: string
}

export type PostField = 'date' | 'shiftType' | 'station' | 'returnDates' | 'notes'

export type PostErrors = Partial<Record<PostField, string>>

/** Field order on screen (for focusing the first problem). */
export const POST_FIELD_ORDER: readonly PostField[] = Object.freeze(['date', 'shiftType', 'station', 'returnDates', 'notes'])

function shiftTypeWord(type: ShiftType): string {
  return type === '24-Hour' ? '24-hour' : 'PM'
}

/** Client-side check of the post_shift rules; {} when everything looks right. */
export function validatePost(draft: PostDraft, ctx: PostContext): PostErrors {
  const errors: PostErrors = {}

  if (!draft.date) {
    errors.date = ctx.tour == null ? 'Choose the date of the shift you want to post.' : 'Choose the shift you want to post.'
  } else {
    const block = dateBlock(draft.date, ctx)
    if (block) errors.date = DATE_BLOCK_MESSAGE[block]
    else if (typeStarted(draft.date, draft.shiftType, ctx.now)) {
      errors.shiftType = `That day's ${shiftTypeWord(draft.shiftType)} shift has already started. Choose ${
        draft.shiftType === '24-Hour' ? 'PM' : '24-Hour'
      } or another day.`
    }
  }

  if (!isStation(draft.station)) errors.station = 'Choose the station where the shift is.'

  if (draft.swapMatch) {
    if (draft.returnDates.length === 0) {
      errors.returnDates = 'Pick at least one day you could work in return, or turn SwapMatch off.'
    } else if (new Set(draft.returnDates).size > MAX_RETURN_DATES) {
      errors.returnDates = `You can offer up to ${MAX_RETURN_DATES} days.`
    } else {
      for (const d of sortDates(draft.returnDates)) {
        const block = returnDateBlock(d, ctx, { postDate: draft.date, shiftType: draft.shiftType })
        if (block) {
          errors.returnDates = isYmd(d)
            ? `${formatDate(d, 'weekday')} can't be offered: ${RETURN_BLOCK_MESSAGE[block]}.`
            : 'One of your return dates is not valid.'
          break
        }
      }
    }
  }

  if (draft.notes.length > NOTES_MAX) errors.notes = `Notes can be up to ${NOTES_MAX} characters.`

  return errors
}

export function hasErrors(errors: PostErrors): boolean {
  return Object.values(errors).some(Boolean)
}

/** The first field with a problem, in screen order. */
export function firstErrorField(errors: PostErrors): PostField | null {
  return POST_FIELD_ORDER.find((f) => errors[f]) ?? null
}

/** The API input for a valid draft. */
export function toPostInput(draft: PostDraft): PostShiftInput {
  if (!draft.date) throw new RangeError('toPostInput: the draft has no date')
  return {
    date: draft.date,
    shiftType: draft.shiftType,
    station: draft.station,
    returnDates: draft.swapMatch ? sortDates(draft.returnDates) : [],
    acceptLimit: draft.acceptLimit,
    notes: draft.notes.trim() || null,
  }
}

/** Which part of the form a post_shift error belongs to ('form' = general). */
export function errorField(code: AppErrorCode): PostField | 'form' {
  switch (code) {
    case 'ALREADY_POSTED':
    case 'NOT_YOUR_SHIFT_DAY':
    case 'TOO_FAR_AHEAD':
    case 'STARTED':
      return 'date'
    case 'POSTER_WORKS_RETURN_DAY':
    case 'RETURN_DATE_INVALID':
      return 'returnDates'
    default:
      return 'form'
  }
}

/** Errors after which my schedule should be reloaded (it changed elsewhere). */
export function shouldReloadAfter(code: AppErrorCode): boolean {
  return code === 'ALREADY_POSTED' || code === 'POSTER_WORKS_RETURN_DAY' || code === 'NOT_YOUR_SHIFT_DAY'
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

export interface SummaryRow {
  label: string
  value: string
  /** True while the member still has to fill this in. */
  missing?: boolean
}

/** "24-Hour · 0800–0800 (24 hours)". */
export function shiftTypeLine(type: ShiftType): string {
  const info = SHIFT_TYPES[type]
  return `${info.label} · ${info.description} (${info.hours} hours)`
}

/** "Oct 1, Oct 4 and Oct 9". */
export function listDates(dates: readonly Ymd[]): string {
  const labels = sortDates(dates).map((d) => formatDate(d, 'short'))
  if (labels.length <= 1) return labels.join('')
  return `${labels.slice(0, -1).join(', ')} and ${labels[labels.length - 1]}`
}

/** The live "Here's what you're posting" rows. */
export function summaryRows(draft: PostDraft, rank: string | null): SummaryRow[] {
  const rows: SummaryRow[] = [
    draft.date
      ? { label: 'Shift', value: `${formatDate(draft.date, 'long')} · ${shiftTypeLine(draft.shiftType)}` }
      : { label: 'Shift', value: 'Pick a date', missing: true },
    isStation(draft.station)
      ? { label: 'Where', value: stationPathLabel(draft.station) }
      : { label: 'Where', value: 'Pick a station', missing: true },
  ]

  if (!draft.swapMatch) {
    rows.push({ label: 'In return', value: 'Nothing. Someone covers you and you owe them a shift.' })
  } else if (draft.returnDates.length === 0) {
    rows.push({ label: 'In return', value: 'SwapMatch: pick the days you could work', missing: true })
  } else {
    rows.push({
      label: 'In return',
      value: `SwapMatch: they pick ${draft.returnDates.length === 1 ? '' : 'one of '}${listDates(draft.returnDates)} and you work their shift that day.`,
    })
  }

  rows.push({ label: 'Who can take it', value: acceptLimitExplanation(draft.acceptLimit, draft.station, rank) })

  const notes = draft.notes.trim()
  rows.push({ label: 'Notes', value: notes ? (notes.length > 120 ? `${notes.slice(0, 117)}…` : notes) : 'None' })
  return rows
}
