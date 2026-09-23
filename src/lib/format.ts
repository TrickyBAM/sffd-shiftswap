// Small display helpers shared by every screen (CC-7): relative times, counts,
// phone links, tour and accept-limit labels. Before this module each screen
// had its own copy and they disagreed (e.g. "yesterday" for something from
// earlier today). Pure functions; dates follow ARCHITECTURE §3 (calendar days
// are counted in Pacific time, never parsed with new Date('YYYY-MM-DD')).

import { diffDays, formatDate, todayPT } from '@/lib/sffd/dates'
import { battalionLabel, divisionLabel, stationInfo, stationLabel } from '@/lib/sffd/stations'
import { isTour } from '@/lib/sffd/tours'

// ---------------------------------------------------------------------------
// Relative time
// ---------------------------------------------------------------------------

export interface RelativeTimeOptions {
  /**
   * 'label' (default) reads on its own: "Just now", "Yesterday", "Sep 12".
   * 'inline' fits mid-sentence: "just now", "yesterday", "on Sep 12".
   */
  style?: 'label' | 'inline'
}

function toMs(value: number | Date | undefined): number {
  if (value === undefined) return Date.now()
  return typeof value === 'number' ? value : value.getTime()
}

/**
 * How long ago an ISO timestamp was: "Just now", "5 min ago", "3 hr ago",
 * "Yesterday", "4 days ago", then the date ("Sep 12", or "Dec 30, 2025" in
 * another year). Hours are used only while it's still the same Pacific day
 * (or less than a day ago); "Yesterday" and "N days ago" count Pacific
 * calendar days. '' for a missing or unreadable timestamp.
 */
export function relativeTime(
  iso: string | null | undefined,
  now?: number | Date,
  options: RelativeTimeOptions = {},
): string {
  if (!iso) return ''
  const t = Date.parse(iso)
  const nowMs = toMs(now)
  if (!Number.isFinite(t) || !Number.isFinite(nowMs)) return ''
  const inline = options.style === 'inline'
  const seconds = Math.max(0, (nowMs - t) / 1000)
  if (seconds < 45) return inline ? 'just now' : 'Just now'
  const minutes = Math.max(1, Math.round(seconds / 60))
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.floor(minutes / 60)
  const then = todayPT(new Date(t))
  const today = todayPT(new Date(nowMs))
  const days = diffDays(then, today)
  if (hours < 24 && days <= 1) return `${hours} hr ago`
  if (days <= 1) return inline ? 'yesterday' : 'Yesterday'
  if (days < 7) return `${days} days ago`
  const date = formatDate(then, then.slice(0, 4) === today.slice(0, 4) ? 'short' : 'medium')
  return inline ? `on ${date}` : date
}

// ---------------------------------------------------------------------------
// Counts
// ---------------------------------------------------------------------------

/** "1 shift" / "3 shifts" / "1,204 members". */
export function plural(count: number, one: string, many = `${one}s`): string {
  return `${count.toLocaleString('en-US')} ${count === 1 ? one : many}`
}

// ---------------------------------------------------------------------------
// Phone links
// ---------------------------------------------------------------------------

/**
 * A phone number reduced to what tel:/sms: links accept (digits and a leading
 * +); '' when it has fewer than 7 digits (nothing callable).
 */
export function dialablePhone(phone: string | null | undefined): string {
  const text = (phone ?? '').trim()
  const digits = text.replace(/\D/g, '')
  if (digits.length < 7) return ''
  return text.startsWith('+') ? `+${digits}` : digits
}

/** tel: link for a phone number, or null when it isn't callable. */
export function telHref(phone: string | null | undefined): string | null {
  const number = dialablePhone(phone)
  return number ? `tel:${number}` : null
}

/**
 * sms: link, optionally with a prefilled message. The `?&body=` form works in
 * both iOS and Android Messages. Null when the number isn't textable.
 */
export function smsHref(phone: string | null | undefined, body?: string | null): string | null {
  const number = dialablePhone(phone)
  if (!number) return null
  return body ? `sms:${number}?&body=${encodeURIComponent(body)}` : `sms:${number}`
}

// ---------------------------------------------------------------------------
// SFFD labels
// ---------------------------------------------------------------------------

/** "Tour 12" or "No tour". */
export function tourLabel(tour: number | null | undefined): string {
  return isTour(tour) ? `Tour ${tour}` : 'No tour'
}

/**
 * Who may request a shift, relative to its station: "Station 19 only",
 * "Battalion 9 only", "Division 3 only"; null for anyone. Falls back to "Same
 * battalion only" (etc.) when the station isn't known.
 */
export function acceptLimitLabel(limit: string | null | undefined, station?: number | null): string | null {
  if (limit !== 'station' && limit !== 'battalion' && limit !== 'division') return null
  const info = station != null ? stationInfo(station) : null
  if (!info) return `Same ${limit} only`
  if (limit === 'station') return `${stationLabel(info.station)} only`
  if (limit === 'battalion') return `${battalionLabel(info.battalion)} only`
  return `${divisionLabel(info.division)} only`
}
