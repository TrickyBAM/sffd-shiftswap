// Display helpers shared by the Board and the trade detail page. Pure
// functions; dates follow ARCHITECTURE §3 (calendar days are 'YYYY-MM-DD'
// strings in Pacific time, never parsed with new Date()).

import { addDays, formatDate, todayPT, type Ymd } from '@/lib/sffd/dates'
import { SHIFT_TYPES, isShiftType } from '@/lib/sffd/shift-types'
import { battalionLabel, divisionLabel, stationLabel } from '@/lib/sffd/stations'
import type { AcceptLimit } from '@/lib/types/database'

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

/** The current time in ms. Kept out of components so renders stay pure. */
export function currentTime(): number {
  return Date.now()
}

/** The Pacific calendar day of an ISO timestamp, or null when it can't be read. */
export function ymdOfInstant(iso: string | null | undefined): Ymd | null {
  if (!iso) return null
  const ms = Date.parse(iso)
  return Number.isNaN(ms) ? null : todayPT(new Date(ms))
}

/** "just now", "5 min ago", "3 hr ago", "2 days ago", or "on Sep 3". */
export function timeAgo(iso: string | null | undefined, nowMs: number): string {
  if (!iso) return ''
  const at = Date.parse(iso)
  if (Number.isNaN(at)) return ''
  const diff = Math.max(0, nowMs - at)
  if (diff < MINUTE) return 'just now'
  if (diff < HOUR) return `${Math.floor(diff / MINUTE)} min ago`
  if (diff < DAY) return `${Math.floor(diff / HOUR)} hr ago`
  if (diff < 7 * DAY) {
    const days = Math.floor(diff / DAY)
    return days === 1 ? 'yesterday' : `${days} days ago`
  }
  return `on ${formatDate(todayPT(new Date(at)), 'short')}`
}

/** "Tue, Oct 14" with " · Today" / " · Tomorrow" when it applies. */
export function dayHeading(ymd: Ymd, today: Ymd): string {
  const label = formatDate(ymd, 'weekday')
  if (ymd === today) return `${label} · Today`
  if (ymd === addDays(today, 1)) return `${label} · Tomorrow`
  return label
}

/** "Today", "Yesterday", or "Tue, Oct 14" — chat day separators. */
export function chatDayLabel(ymd: Ymd, today: Ymd): string {
  if (ymd === today) return 'Today'
  if (ymd === addDays(today, -1)) return 'Yesterday'
  return formatDate(ymd, 'weekday')
}

/** "0800–0800 · 24 hrs" for a shift type (falls back to the raw value). */
export function shiftTimesLabel(shiftType: string): string {
  if (!isShiftType(shiftType)) return shiftType
  const info = SHIFT_TYPES[shiftType]
  return `${info.description} · ${info.hours} hrs`
}

/** "Station 19 · Battalion 9". */
export function stationBattalionLabel(shift: { station: number; battalion: number }): string {
  return `${stationLabel(shift.station)} · ${battalionLabel(shift.battalion)}`
}

/** Who may request, relative to the shift's station: "Battalion 9 only", or null for anyone. */
export function acceptLimitLabel(shift: {
  accept_limit: AcceptLimit | string
  station: number
  battalion: number
  division: number
}): string | null {
  switch (shift.accept_limit) {
    case 'station':
      return `${stationLabel(shift.station)} only`
    case 'battalion':
      return `${battalionLabel(shift.battalion)} only`
    case 'division':
      return `${divisionLabel(shift.division)} only`
    default:
      return null
  }
}

/** "Oct 16, Oct 20 and Oct 22". */
export function listDates(dates: readonly Ymd[], style: 'short' | 'weekday' = 'short'): string {
  const labels = dates.map((d) => formatDate(d, style))
  if (labels.length <= 1) return labels.join('')
  return `${labels.slice(0, -1).join(', ')} and ${labels[labels.length - 1]}`
}

export interface DateGroup<T> {
  date: Ymd
  items: T[]
}

/** Groups rows by `date`, keeping their order (rows arrive sorted by date). */
export function groupByDate<T extends { date: Ymd }>(rows: readonly T[]): DateGroup<T>[] {
  const groups: DateGroup<T>[] = []
  for (const row of rows) {
    const last = groups[groups.length - 1]
    if (last && last.date === row.date) last.items.push(row)
    else groups.push({ date: row.date, items: [row] })
  }
  return groups
}

/** Drops later duplicates by id (keyset pages can overlap after a live refresh). */
export function uniqueById<T extends { id: string }>(rows: readonly T[]): T[] {
  const seen = new Set<string>()
  const out: T[] = []
  for (const row of rows) {
    if (seen.has(row.id)) continue
    seen.add(row.id)
    out.push(row)
  }
  return out
}

/** "1 shift" / "3 shifts". */
export function plural(count: number, one: string, many = `${one}s`): string {
  return `${count} ${count === 1 ? one : many}`
}

/** Digits and a leading + only, for tel:/sms: links. Empty when there's nothing dialable. */
export function dialable(phone: string | null | undefined): string {
  const text = (phone ?? '').trim()
  const digits = text.replace(/[^\d]/g, '')
  if (digits.length < 7) return ''
  return text.startsWith('+') ? `+${digits}` : digits
}
