// Display helpers for the admin screens. Timestamps (timestamptz) are shown in
// Pacific time; calendar dates (YYYY-MM-DD) go through formatDate() so they
// never shift a day (ARCHITECTURE §3).

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
  return dateTimeFormatter.format(d).replace(/[\u202F\u00A0]/g, ' ')
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

/**
 * Short relative time: "just now", "5 min ago", "3 hr ago", "2 days ago";
 * older than a week falls back to the date. '' for a missing or invalid value.
 */
export function timeAgo(value: string | number | Date | null | undefined, now: number = Date.now()): string {
  const d = parseInstant(value)
  if (!d) return ''
  const seconds = Math.round((now - d.getTime()) / 1000)
  if (seconds < 45) return 'just now'
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours} hr ago`
  const days = Math.round(hours / 24)
  if (days < 7) return days === 1 ? 'yesterday' : `${days} days ago`
  return formatInstantDate(d)
}

/** "Tour 7" or "No tour". */
export function tourText(tour: number | null | undefined): string {
  return typeof tour === 'number' ? `Tour ${tour}` : 'No tour'
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

/** Phone number reduced to what tel:/sms: links accept (digits and a leading +). */
export function dialable(phone: string | null | undefined): string {
  const raw = (phone ?? '').trim()
  const digits = raw.replace(/[^\d]/g, '')
  if (!digits) return ''
  return raw.startsWith('+') ? `+${digits}` : digits
}

/** tel: link for a phone number, or null when it has no digits. */
export function telHref(phone: string | null | undefined): string | null {
  const number = dialable(phone)
  return number ? `tel:${number}` : null
}

/**
 * sms: link, optionally with a prefilled message. The `?&body=` form works on
 * both iOS and Android Messages. Null when the number has no digits.
 */
export function smsHref(phone: string | null | undefined, body?: string): string | null {
  const number = dialable(phone)
  if (!number) return null
  return body ? `sms:${number}?&body=${encodeURIComponent(body)}` : `sms:${number}`
}

/** "3 members" / "1 member". */
export function plural(count: number, one: string, many = `${one}s`): string {
  return `${count.toLocaleString('en-US')} ${count === 1 ? one : many}`
}
