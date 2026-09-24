// Helpers for the subscribable calendar feed (GET /api/calendar/[token]).
// Kept out of route.ts (which may only export HTTP handlers and route config).

import type { IcsEvent } from '@/lib/ics'
import { isYmd } from '@/lib/sffd/dates'
import type { CalendarFeedRow } from '@/lib/types/database'

/** Right-hand side of every event UID: `<date>-<kind>@sffd-shiftswap`. */
export const CALENDAR_UID_DOMAIN = 'sffd-shiftswap'
export const CALENDAR_BASE_NAME = 'ShiftSwap'
export const CALENDAR_DESCRIPTION =
  'Your ShiftSwap work days and trades. Unofficial: TeleStaff is the official schedule.'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MAX_FIRST_NAME_CHARS = 40

/**
 * The token from the URL segment, lower-cased, or null if it isn't a UUID.
 * A trailing `.ics` is accepted (some calendar apps like the URL to end in it).
 */
export function normalizeCalendarToken(raw: string | null | undefined): string | null {
  let value = (raw ?? '').trim()
  try {
    value = decodeURIComponent(value)
  } catch {
    return null
  }
  value = value.replace(/\.ics$/i, '')
  return UUID_RE.test(value) ? value.toLowerCase() : null
}

/** First word of a full name ('Brian Machado' → 'Brian'), or null. */
export function firstNameOf(fullName: string | null | undefined): string | null {
  const first = (fullName ?? '').trim().split(/\s+/)[0] ?? ''
  if (!first) return null
  const chars = Array.from(first)
  return chars.length > MAX_FIRST_NAME_CHARS ? chars.slice(0, MAX_FIRST_NAME_CHARS).join('') : first
}

/** 'ShiftSwap - Brian', or just 'ShiftSwap' when the name is unknown. */
export function calendarNameFor(fullName: string | null | undefined): string {
  const first = firstNameOf(fullName)
  return first ? `${CALENDAR_BASE_NAME} - ${first}` : CALENDAR_BASE_NAME
}

/**
 * One all-day event per feed row, with a UID that stays the same across
 * refreshes (`<date>-<kind>@sffd-shiftswap`) so calendar apps update events in
 * place. Rows with a malformed date are skipped; a repeated UID gets a suffix.
 */
export function feedToEvents(rows: readonly CalendarFeedRow[], appUrl?: string | null): IcsEvent[] {
  const seen = new Map<string, number>()
  const events: IcsEvent[] = []
  for (const row of rows) {
    if (!isYmd(row.date)) continue
    const base = `${row.date}-${row.kind}`
    const count = (seen.get(base) ?? 0) + 1
    seen.set(base, count)
    events.push({
      uid: `${count > 1 ? `${base}-${count}` : base}@${CALENDAR_UID_DOMAIN}`,
      date: row.date,
      title: row.title,
      description: row.details || null,
      url: appUrl ?? null,
    })
  }
  return events
}
