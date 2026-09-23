// Shifts: posting, cancelling a post, the Board and single-shift reads
// (ARCHITECTURE §6.3 "Shifts & trades", §7.2 "Board").

import { AppError } from '@/lib/errors'
import { isYmd, todayPT, type Ymd } from '@/lib/sffd/dates'
import type { AcceptLimit, Rank, Shift, ShiftType } from '@/lib/types/database'
import {
  assertDate,
  assertUuid,
  blankToNull,
  callRpc,
  clampLimit,
  isUuid,
  nowIso,
  quoteFilterValue,
  runList,
  runMaybe,
  type Page,
  type Sb,
} from './core'

// ---------------------------------------------------------------------------
// Posting
// ---------------------------------------------------------------------------

export interface PostShiftInput {
  date: Ymd
  shiftType: ShiftType
  /** Where the shift is worked; null/omitted = my own station. */
  station?: number | null
  /** SwapMatch dates I'd work in return (0–10, my off days). */
  returnDates?: readonly Ymd[] | null
  /** Who may request it, relative to the shift's station; default 'anyone'. */
  acceptLimit?: AcceptLimit | null
  /** Up to 500 characters. */
  notes?: string | null
}

/**
 * Posts one of my shifts (post_shift). Returns the new shift id. Eligible
 * members get a `new_shift` alert. Rule failures throw AppError with the
 * database's message (ACK_REQUIRED, STARTED, TOO_FAR_AHEAD, NOT_YOUR_SHIFT_DAY,
 * ALREADY_POSTED, POSTER_WORKS_RETURN_DAY, RETURN_DATE_INVALID, INVALID_INPUT).
 */
export async function postShift(sb: Sb, input: PostShiftInput): Promise<string> {
  const returnDates = input.returnDates?.length ? [...input.returnDates] : null
  return callRpc(
    sb,
    'post_shift',
    {
      p_date: input.date,
      p_shift_type: input.shiftType,
      p_station: input.station ?? null,
      p_return_dates: returnDates,
      p_accept_limit: input.acceptLimit ?? null,
      p_notes: blankToNull(input.notes),
    },
    { flush: true },
  )
}

/** Withdraws my open, not-started post (cancel_post). Pending requesters are told. */
export async function cancelPost(sb: Sb, shiftId: string): Promise<void> {
  await callRpc(sb, 'cancel_post', { p_shift_id: shiftId }, { flush: true })
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/** One shift by id, or null if it doesn't exist (or isn't visible, or the id is malformed). */
export async function getShift(sb: Sb, shiftId: string): Promise<Shift | null> {
  if (!isUuid(shiftId)) return null
  return runMaybe<Shift>(sb.from('shifts').select('*').eq('id', shiftId).maybeSingle())
}

/** Several shifts by id (unknown ids are skipped), ordered by date. */
export async function getShiftsByIds(sb: Sb, shiftIds: readonly string[]): Promise<Shift[]> {
  const ids = [...new Set(shiftIds)].filter(isUuid)
  if (!ids.length) return []
  return runList<Shift>(
    sb.from('shifts').select('*').in('id', ids).order('date').order('created_at').order('id'),
  )
}

// ---------------------------------------------------------------------------
// Board (open shifts, "Load more" keyset pagination by date, created_at, id)
// ---------------------------------------------------------------------------

/** The member looking at the board — a Profile row fits. */
export interface BoardViewer {
  id: string
  rank: Rank | string | null
  station: number | null
  battalion: number | null
  division: number | null
}

export interface BoardFilters {
  /** Location cascade (Division ▸ Battalion ▸ Station); each narrows by equality. */
  division?: number | null
  battalion?: number | null
  station?: number | null
  /** Only this rank. */
  rank?: Rank | null
  /** First date shown; default today (Pacific). */
  from?: Ymd | null
  /** Last date shown (inclusive); default no limit. */
  to?: Ymd | null
  /** Hide this member's own posts. */
  excludePosterId?: string | null
  /**
   * "Only shifts I can take": same rank as the viewer, not their own, and
   * within each shift's accept_limit relative to the viewer's station. The
   * schedule rules (working / covering that day) are applied with
   * `excludeDates`, since the board query can't see the viewer's schedule.
   */
  eligibleFor?: BoardViewer | null
  /** Leave out these dates (e.g. days the viewer works or is covering). */
  excludeDates?: readonly Ymd[] | null
}

/** Position after the last shift of a board page. */
export interface BoardCursor {
  date: Ymd
  created_at: string
  id: string
}

export interface PageRequest<C> {
  /** Page size (default 20, max 100). */
  limit?: number
  /** Cursor from the previous page's `nextCursor`; omit for the first page. */
  after?: C | null
}

export const BOARD_PAGE_SIZE = 20

/**
 * Open, not-started shifts for the Board, ordered by (date, created_at, id),
 * one page at a time. Pass the returned `nextCursor` as `after` to load more.
 */
export async function listBoardShifts(
  sb: Sb,
  filters: BoardFilters = {},
  page: PageRequest<BoardCursor> = {},
): Promise<Page<Shift, BoardCursor>> {
  const limit = clampLimit(page.limit, BOARD_PAGE_SIZE, 100)
  const viewer = filters.eligibleFor ?? null
  // A viewer without a rank (not onboarded) can't take anything.
  if (viewer && !viewer.rank) return { items: [], nextCursor: null }

  const from = filters.from ?? todayPT()
  let query = sb
    .from('shifts')
    .select('*')
    .eq('status', 'open')
    .gt('starts_at', nowIso())
    .gte('date', assertDate(from, 'start date'))

  if (filters.to) query = query.lte('date', assertDate(filters.to, 'end date'))
  if (filters.division != null) query = query.eq('division', filters.division)
  if (filters.battalion != null) query = query.eq('battalion', filters.battalion)
  if (filters.station != null) query = query.eq('station', filters.station)
  if (filters.rank) query = query.eq('rank', filters.rank)
  if (filters.excludePosterId) query = query.neq('poster_id', assertUuid(filters.excludePosterId, 'member'))
  if (viewer) {
    query = query
      .eq('rank', viewer.rank as string)
      .neq('poster_id', assertUuid(viewer.id, 'member'))
      .or(acceptLimitFilter(viewer))
  }
  const excluded = (filters.excludeDates ?? []).filter(isYmd)
  if (excluded.length) query = query.not('date', 'in', `(${[...new Set(excluded)].join(',')})`)
  // Repeated or=(…) parameters are combined with AND by PostgREST.
  if (page.after) query = query.or(boardCursorFilter(page.after))

  const rows = await runList<Shift>(query.order('date').order('created_at').order('id').limit(limit + 1))
  const items = rows.slice(0, limit)
  const last = items[items.length - 1]
  return { items, nextCursor: rows.length > limit && last ? boardCursorOf(last) : null }
}

/** The cursor that continues a board listing after `shift`. */
export function boardCursorOf(shift: Pick<Shift, 'date' | 'created_at' | 'id'>): BoardCursor {
  return { date: shift.date, created_at: shift.created_at, id: shift.id }
}

/**
 * PostgREST `or` filter for rows strictly after `cursor` in (date, created_at, id)
 * order. Throws AppError INVALID_INPUT for a malformed cursor.
 */
export function boardCursorFilter(cursor: BoardCursor): string {
  const date = assertDate(cursor.date)
  const id = assertUuid(cursor.id)
  if (typeof cursor.created_at !== 'string' || !cursor.created_at || Number.isNaN(Date.parse(cursor.created_at))) {
    throw new AppError('INVALID_INPUT', "Couldn't load more shifts. Refresh and try again.")
  }
  const at = quoteFilterValue(cursor.created_at)
  return [
    `date.gt.${date}`,
    `and(date.eq.${date},created_at.gt.${at})`,
    `and(date.eq.${date},created_at.eq.${at},id.gt.${id})`,
  ].join(',')
}

/**
 * PostgREST `or` filter matching shifts whose accept_limit lets `viewer`
 * request them (relative to the shift's station, as request_shift checks).
 */
export function acceptLimitFilter(viewer: Pick<BoardViewer, 'station' | 'battalion' | 'division'>): string {
  const parts = ['accept_limit.eq.anyone']
  if (Number.isInteger(viewer.division)) parts.push(`and(accept_limit.eq.division,division.eq.${viewer.division})`)
  if (Number.isInteger(viewer.battalion)) parts.push(`and(accept_limit.eq.battalion,battalion.eq.${viewer.battalion})`)
  if (Number.isInteger(viewer.station)) parts.push(`and(accept_limit.eq.station,station.eq.${viewer.station})`)
  return parts.join(',')
}

/** Client-side mirror of the accept_limit rule (OUTSIDE_LIMIT) for one shift. */
export function withinAcceptLimit(
  shift: Pick<Shift, 'accept_limit' | 'station' | 'battalion' | 'division'>,
  viewer: Pick<BoardViewer, 'station' | 'battalion' | 'division'>,
): boolean {
  switch (shift.accept_limit) {
    case 'station':
      return viewer.station === shift.station
    case 'battalion':
      return viewer.battalion === shift.battalion
    case 'division':
      return viewer.division === shift.division
    default:
      return true
  }
}
