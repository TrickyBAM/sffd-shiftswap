// Minimal RFC 5545 (iCalendar) writer for the subscribable calendar feed
// (/api/calendar/[token]). Only all-day events are needed: every shift is
// shown on its start date. Output uses CRLF line endings, folds lines longer
// than 75 octets, and escapes TEXT values.

import { addDays, assertYmd, type Ymd } from '@/lib/sffd/dates'

export interface IcsEvent {
  /** Globally unique and stable across refreshes, e.g. `work-2026-09-23@sffd-shiftswap`. */
  uid: string
  /** All-day date (YYYY-MM-DD). */
  date: Ymd
  title: string
  description?: string | null
  /** Optional link back into the app. */
  url?: string | null
}

export interface BuildIcsOptions {
  calendarName: string
  calendarDescription?: string
  events: readonly IcsEvent[]
  /** DTSTAMP for every event; defaults to now. Pass a fixed value in tests. */
  now?: Date
}

export const ICS_PRODID = '-//SFFD ShiftSwap//Shift Calendar 1.0//EN'
/** How often subscribing apps should re-fetch the feed. */
export const ICS_REFRESH_INTERVAL = 'PT12H'

const CRLF = '\r\n'
const MAX_LINE_OCTETS = 75
const encoder = new TextEncoder()

/** Escapes a TEXT value: backslash, semicolon, comma and newlines. */
export function escapeIcsText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r\n|\r|\n/g, '\\n')
}

/**
 * Folds a content line so no physical line exceeds 75 octets (UTF-8), never
 * splitting a multi-byte character. Continuation lines start with one space.
 */
export function foldIcsLine(line: string): string {
  if (encoder.encode(line).length <= MAX_LINE_OCTETS) return line
  const parts: string[] = []
  let current = ''
  let currentOctets = 0
  let limit = MAX_LINE_OCTETS
  for (const ch of line) {
    const octets = encoder.encode(ch).length
    if (currentOctets + octets > limit) {
      parts.push(current)
      current = ''
      currentOctets = 0
      limit = MAX_LINE_OCTETS - 1 // the leading space counts toward the 75
    }
    current += ch
    currentOctets += octets
  }
  parts.push(current)
  return parts.join(`${CRLF} `)
}

/** 'YYYY-MM-DD' → 'YYYYMMDD'. */
function icsDate(ymd: Ymd): string {
  return assertYmd(ymd).replace(/-/g, '')
}

/** UTC date-time in basic format, e.g. 20260923T184500Z. */
function icsDateTime(d: Date): string {
  return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
}

/** UIDs and URIs are not TEXT; strip anything that would break the line. */
function sanitizeValue(value: string): string {
  return value.replace(/[\r\n]+/g, ' ').trim()
}

/** Builds a complete VCALENDAR document. */
export function buildIcs({ calendarName, calendarDescription, events, now = new Date() }: BuildIcsOptions): string {
  const stamp = icsDateTime(now)
  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    `PRODID:${ICS_PRODID}`,
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeIcsText(calendarName)}`,
    'X-WR-TIMEZONE:America/Los_Angeles',
  ]
  if (calendarDescription) lines.push(`X-WR-CALDESC:${escapeIcsText(calendarDescription)}`)
  lines.push(`REFRESH-INTERVAL;VALUE=DURATION:${ICS_REFRESH_INTERVAL}`, `X-PUBLISHED-TTL:${ICS_REFRESH_INTERVAL}`)

  for (const event of events) {
    lines.push(
      'BEGIN:VEVENT',
      `UID:${sanitizeValue(event.uid)}`,
      `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${icsDate(event.date)}`,
      `DTEND;VALUE=DATE:${icsDate(addDays(event.date, 1))}`,
      `SUMMARY:${escapeIcsText(event.title)}`,
    )
    if (event.description) lines.push(`DESCRIPTION:${escapeIcsText(event.description)}`)
    if (event.url) lines.push(`URL:${sanitizeValue(event.url)}`)
    lines.push('TRANSP:TRANSPARENT', 'END:VEVENT')
  }

  lines.push('END:VCALENDAR')
  return lines.map(foldIcsLine).join(CRLF) + CRLF
}
