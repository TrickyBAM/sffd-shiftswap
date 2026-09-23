// Calendar data: my effective schedule and my shifts in a date range
// (ARCHITECTURE §4, §7.2 "Calendar"). src/lib/schedule/effective.ts turns
// these into calendar days. The blue "open shifts I could take" counts use
// the Board's own query (listBoardShifts with `eligibleFor`, loaded by the
// calendar's useCalendarData), so a count and the Board it opens agree.

import { AppError } from '@/lib/errors'
import { diffDays, type Ymd } from '@/lib/sffd/dates'
import type { ScheduleRow, Shift } from '@/lib/types/database'
import { assertDate, callRpc, resolveUserId, runList, type Sb } from './core'

/** Longest range my_schedule accepts (days, inclusive). */
export const MAX_SCHEDULE_DAYS = 400

function checkRange(from: Ymd, to: Ymd): void {
  assertDate(from, 'start date')
  assertDate(to, 'end date')
  const days = diffDays(from, to) + 1
  if (days < 1) throw new AppError('INVALID_INPUT', 'Choose a valid date range.')
  if (days > MAX_SCHEDULE_DAYS) throw new AppError('INVALID_INPUT', `Choose a date range of at most ${MAX_SCHEDULE_DAYS} days.`)
}

/**
 * My effective schedule from the database, one row per day (my_schedule; at
 * most 400 days). A day where I gave away only the PM has `pm_given_away` and
 * stays `working` (I still work 0800–1600).
 */
export async function getMySchedule(sb: Sb, from: Ymd, to: Ymd): Promise<ScheduleRow[]> {
  checkRange(from, to)
  const rows = await callRpc(sb, 'my_schedule', { p_from: from, p_to: to })
  if (!Array.isArray(rows)) return []
  // A database without migration 0011 has no pm_given_away column yet.
  return rows.map((row) => ({ ...row, pm_given_away: row.pm_given_away === true }))
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
