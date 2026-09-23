// Display helpers only the admin screens need. Timestamps (timestamptz) are
// shown in Pacific time; calendar dates (YYYY-MM-DD) go through formatDate()
// so they never shift a day (ARCHITECTURE §3). Relative times, counts, phone
// links and tour labels come from the shared src/lib/format.ts.

import { PT_TIME_ZONE } from '@/lib/sffd/dates'
import { battalionLabel, stationInfo, stationLabel } from '@/lib/sffd/stations'

let dateTimeFormatter: Intl.DateTimeFormat | undefined
let dateOnlyFormatter: Intl.DateTimeFormat | undefined

function parseInstant(value: string | number | Date | null | undefined): Date | null {
  if (value === null || value === undefined || value === '') return null
  const d = value instanceof Date ? value : new Date(value)
  return Number.isNaN(d.getTime()) ? null : d
}

/** "Sep 23, 2026, 3:45 PM" (Pacific). '' for a missing or invalid value. */
export function formatInstant(value: string | number | Date | null | undefined): string {
  const d = parseInstant(value)
  if (!d) return ''
  dateTimeFormatter ??= new Intl.DateTimeFormat('en-US', {
    timeZone: PT_TIME_ZONE,
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
  return dateTimeFormatter.format(d).replace(/[  ]/g, ' ')
}

/** "Sep 23, 2026" (Pacific day of the instant). '' for a missing or invalid value. */
export function formatInstantDate(value: string | number | Date | null | undefined): string {
  const d = parseInstant(value)
  if (!d) return ''
  dateOnlyFormatter ??= new Intl.DateTimeFormat('en-US', {
    timeZone: PT_TIME_ZONE,
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
  return dateOnlyFormatter.format(d)
}

/** True when the instant is less than a week before `now` (relative times read well). */
export function withinLastWeek(value: string | null | undefined, now: number = Date.now()): boolean {
  const d = parseInstant(value)
  return d !== null && now - d.getTime() < 7 * 86_400_000
}

/** "Station 19" (or "Airport Station 1"); "No station" when missing. */
export function stationText(station: number | null | undefined): string {
  return typeof station === 'number' ? stationLabel(station) : 'No station'
}

/** "Station 19 · Battalion 9" — the station with its battalion, for member cards. */
export function stationWithBattalion(station: number | null | undefined): string {
  if (typeof station !== 'number') return 'No station'
  const info = stationInfo(station)
  return info ? `${info.label} · ${battalionLabel(info.battalion)}` : stationLabel(station)
}
