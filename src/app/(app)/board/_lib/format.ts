// Display helpers shared by the Board and the trade detail page. Pure
// functions; dates follow ARCHITECTURE §3 (calendar days are 'YYYY-MM-DD'
// strings in Pacific time, never parsed with new Date()). Relative times,
// counts, phone links and accept-limit labels come from src/lib/format.ts.

import { addDays, formatDate, todayPT, type Ymd } from '@/lib/sffd/dates'
import { SHIFT_TYPES, isShiftType } from '@/lib/sffd/shift-types'
import { battalionLabel, stationLabel } from '@/lib/sffd/stations'

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
