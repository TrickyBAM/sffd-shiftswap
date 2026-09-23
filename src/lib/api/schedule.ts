// Calendar data: my effective schedule, my shifts in a date range and the
// "open shifts I could request" counts (ARCHITECTURE §4, §7.2 "Calendar").
// src/lib/schedule/effective.ts turns these into calendar days.

import { AppError } from '@/lib/errors'
import { diffDays, isYmd, type Ymd } from '@/lib/sffd/dates'
import type { ScheduleRow, Shift } from '@/lib/types/database'
import { assertDate, assertUuid, callRpc, nowIso, resolveUserId, runList, type Sb } from './core'
import { acceptLimitFilter, type BoardViewer } from './shifts'

/** Longest range my_schedule accepts (days, inclusive). */
export const MAX_SCHEDULE_DAYS = 400

function checkRange(from: Ymd, to: Ymd): void {
  assertDate(from, 'start date')
  assertDate(to, 'end date')
  const days = diffDays(from, to) + 1
  if (days < 1) throw new AppError('INVALID_INPUT', 'Choose a valid date range.')
  if (days > MAX_SCHEDULE_DAYS) throw new AppError('INVALID_INPUT', `Choose a date range of at most ${MAX_SCHEDULE_DAYS} days.`)
}

/** My effective schedule from the database, one row per day (my_schedule; at most 400 days). */
export async function getMySchedule(sb: Sb, from: Ymd, to: Ymd): Promise<ScheduleRow[]> {
  checkRange(from, to)
  const rows = await callRpc(sb, 'my_schedule', { p_from: from, p_to: to })
  return Array.isArray(rows) ? rows : []
}

/**
 * Open and covered shifts I post or cover dated from…to (inclusive) — the
 * `myShifts` input of computeMonthDays() in src/lib/schedule/effective.ts.
 */
export async function listMyShiftsInRange(
  sb: Sb,
  range: { from: Ymd; to: Ymd; userId?: string | null },
): Promise<Shift[]> {
  checkRange(range.from, range.to)
  const me = await resolveUserId(sb, range.userId)
  return runList<Shift>(
    sb
      .from('shifts')
      .select('*')
      .or(`poster_id.eq.${me},coverer_id.eq.${me}`)
      .in('status', ['open', 'covered'])
      .gte('date', range.from)
      .lte('date', range.to)
      .order('date')
      .order('created_at')
      .order('id'),
  )
}

/**
 * How many open, not-started shifts `viewer` could request on each day from…to
 * — the blue count badges (`boardCounts` for computeMonthDays). Applies the
 * rules the database can check without the viewer's schedule: same rank, not
 * the viewer's own, within accept_limit. Days the viewer works are zeroed by
 * computeMonthDays itself. Returns { 'YYYY-MM-DD': count } (days with none omitted).
 */
export async function countOpenShiftsByDate(
  sb: Sb,
  range: { from: Ymd; to: Ymd; viewer: BoardViewer },
): Promise<Record<Ymd, number>> {
  checkRange(range.from, range.to)
  const { viewer } = range
  if (!viewer.rank) return {}
  const rows = await runList<Pick<Shift, 'date'>>(
    sb
      .from('shifts')
      .select('date')
      .eq('status', 'open')
      .gt('starts_at', nowIso())
      .gte('date', range.from)
      .lte('date', range.to)
      .eq('rank', viewer.rank)
      .neq('poster_id', assertUuid(viewer.id, 'member'))
      .or(acceptLimitFilter(viewer))
      .limit(1000),
  )
  return countByDate(rows)
}

/** Tallies rows per date: [{date:'2026-09-24'}, …] → { '2026-09-24': n }. */
export function countByDate(rows: readonly { date: Ymd }[]): Record<Ymd, number> {
  const out: Record<Ymd, number> = {}
  for (const { date } of rows) {
    if (isYmd(date)) out[date] = (out[date] ?? 0) + 1
  }
  return out
}

/** Path of my ICS calendar feed (GET /api/calendar/<token>). */
export function calendarFeedPath(token: string): string {
  return `/api/calendar/${encodeURIComponent(token)}`
}

/**
 * Subscribe links for "Add to my calendar": the https URL and the webcal://
 * form that opens the calendar app directly on iPhone and Mac.
 */
export function calendarFeedUrls(origin: string, token: string): { https: string; webcal: string } {
  const url = new URL(calendarFeedPath(token), origin)
  const https = url.toString()
  return { https, webcal: https.replace(/^https?:\/\//i, 'webcal://') }
}
