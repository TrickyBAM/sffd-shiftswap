// Pure helpers for /profile: labels, stats wording, the trust-score copy and
// the details form. No I/O, so they are unit-tested
// (tests/unit/profile-model.test.ts). Shared rules and labels come from
// src/lib/validation.ts (phone, password) and src/lib/format.ts (tour label,
// counts), so every screen words and checks them the same way.

import { z } from 'zod'
import { plural } from '@/lib/format'
import { daysInMonth, makeYmd, monthOf, type Ymd } from '@/lib/sffd/dates'
import { battalionLabel, divisionLabel, isStation, stationInfo, stationLabel } from '@/lib/sffd/stations'
import { isTour } from '@/lib/sffd/tours'
import { NOTIFY_SCOPES, type MyStats, type NotifyScope, type Shift } from '@/lib/types/database'
import { newPasswordSchema, PASSWORD_CONFIRM_MESSAGE, PASSWORD_MISMATCH_MESSAGE, phoneSchema } from '@/lib/validation'

// ---------------------------------------------------------------------------
// Identity
// ---------------------------------------------------------------------------

export interface LocationLabels {
  station: string
  battalion: string | null
  division: string | null
}

/** "Station 19" / "Battalion 9" / "Division 3" for a member's station (nulls when unknown). */
export function locationLabels(station: number | null | undefined): LocationLabels | null {
  if (station == null) return null
  const info = stationInfo(station)
  if (!info) return { station: stationLabel(station), battalion: null, division: null }
  return {
    station: info.label || stationLabel(station),
    battalion: battalionLabel(info.battalion),
    division: divisionLabel(info.division),
  }
}

// ---------------------------------------------------------------------------
// New-shift alert scope (profiles.notify_scope, §6.5)
// ---------------------------------------------------------------------------

export const NOTIFY_SCOPE_LABELS: Record<NotifyScope, string> = {
  off: 'Off',
  station: 'My Station',
  battalion: 'My Battalion',
  division: 'My Division',
  all: 'Everywhere',
}

/** Scopes in the order the form lists them. */
export const NOTIFY_SCOPE_ORDER: readonly NotifyScope[] = ['off', 'station', 'battalion', 'division', 'all']

export function notifyScopeLabel(scope: NotifyScope | string | null | undefined): string {
  return (NOTIFY_SCOPES as readonly string[]).includes(scope ?? '')
    ? NOTIFY_SCOPE_LABELS[scope as NotifyScope]
    : NOTIFY_SCOPE_LABELS.battalion
}

/**
 * What a scope means for this member, worded with their (chosen) station:
 * "New shifts at Station 19", "New shifts in Battalion 9", …
 */
export function notifyScopeDescription(scope: NotifyScope, station: number | null | undefined): string {
  const where = locationLabels(station)
  switch (scope) {
    case 'off':
      return "No new-shift alerts. You'll still get alerts about your own trades and messages."
    case 'station':
      return `New shifts at ${where?.station ?? 'your station'}`
    case 'battalion':
      return `New shifts in ${where?.battalion ?? 'your battalion'}`
    case 'division':
      return `New shifts in ${where?.division ?? 'your division'}`
    case 'all':
      return 'New shifts anywhere in the department'
  }
}

// ---------------------------------------------------------------------------
// Calendar feed (UX-15)
// ---------------------------------------------------------------------------

/**
 * Which "add to calendar" path to lead with:
 *   apple    iPhone, iPad, Mac: the webcal:// link opens Calendar's Subscribe screen
 *   android  webcal:// links usually do nothing, and the Google Calendar app
 *            can't subscribe by link: copy the link, add it on calendar.google.com
 *   other    Windows, Linux, …: copy the link into Google Calendar or Outlook
 */
export type CalendarPlatform = 'apple' | 'android' | 'other'

export function calendarPlatform(userAgent: string | null | undefined): CalendarPlatform {
  const ua = userAgent ?? ''
  if (/Android/i.test(ua)) return 'android'
  // iPadOS reports itself as a Mac ("Macintosh"), which is also right here.
  if (/iPhone|iPad|iPod|Macintosh|Mac OS X/i.test(ua)) return 'apple'
  return 'other'
}

// ---------------------------------------------------------------------------
// Stats (my_stats)
// ---------------------------------------------------------------------------

/** "+2", "0", "−1" — a signed number with a real minus sign. */
export function formatSigned(n: number): string {
  if (n > 0) return `+${n}`
  if (n < 0) return `−${Math.abs(n)}`
  return '0'
}

/** Balance = Covered − Given. */
export function balanceOf(stats: Pick<MyStats, 'covered' | 'given'>): number {
  return stats.covered - stats.given
}

/**
 * One plain sentence about the overall balance, in the words the stats use:
 * Covered = shifts you worked for someone, Given = shifts someone worked for you.
 */
export function balanceSentence(stats: Pick<MyStats, 'covered' | 'given'>): string {
  const net = balanceOf(stats)
  if (stats.covered === 0 && stats.given === 0) return 'No trades yet. Your balance starts at 0.'
  if (net > 0) return `You've covered ${plural(net, 'more shift')} than you've given.`
  if (net < 0) return `You've given ${plural(-net, 'more shift')} than you've covered.`
  return "You're even: you've covered as many shifts as you've given."
}

export interface Reciprocity {
  /** Share of the bar for shifts I covered, 0–100 (rounded; the two add up to 100). */
  coveredPct: number
  givenPct: number
  total: number
}

/** The covered-vs-given split for the reciprocity bar, or null when there are no trades. */
export function reciprocity(covered: number, given: number): Reciprocity | null {
  const c = Math.max(0, covered)
  const g = Math.max(0, given)
  const total = c + g
  if (total === 0) return null
  const coveredPct = Math.round((c / total) * 100)
  return { coveredPct, givenPct: 100 - coveredPct, total }
}

/** Keeps a trust score within 0–100 (whole number). */
export function clampScore(score: number | null | undefined): number {
  if (typeof score !== 'number' || !Number.isFinite(score)) return 100
  return Math.min(100, Math.max(0, Math.round(score)))
}

export type TrustTone = 'great' | 'good' | 'building'

/** A positive headline for a trust score. */
export function trustHeadline(score: number): { text: string; tone: TrustTone } {
  const s = clampScore(score)
  if (s >= 90) return { text: 'Great teammate', tone: 'great' }
  if (s >= 70) return { text: 'Reliable teammate', tone: 'good' }
  if (s >= 50) return { text: 'Good teammate', tone: 'good' }
  return { text: 'Building your score', tone: 'building' }
}

/** Shifts I cover this month: already worked, and still to come. */
export interface MonthCovers {
  done: number
  upcoming: number
}

/**
 * Warm one-liner under the trust score, e.g.
 * "Great teammate — you've covered 3 shifts this month."
 */
export function trustMessage(
  score: number,
  context: { month: MonthCovers | null; covered: number; given: number; outstanding: number },
): string {
  const { text } = trustHeadline(score)
  const s = clampScore(score)
  const done = context.month?.done ?? 0
  const upcoming = context.month?.upcoming ?? 0
  if (done > 0) return `${text} — you've covered ${plural(done, 'shift')} this month.`
  if (upcoming > 0) return `${text} — you're covering ${plural(upcoming, 'shift')} this month.`
  if (context.covered === 0 && context.given === 0) {
    return s >= 100
      ? `${text} — you're starting with a perfect score.`
      : `${text} — covering a shift for someone gives it a boost.`
  }
  if (s < 100 && context.outstanding > 0) {
    return `${text} — covering a shift, or taking down a post you no longer need, gives it a boost.`
  }
  if (s < 100) return `${text} — covering a shift for someone gives it a boost.`
  return `${text} — members can count on you.`
}

/** How the score works, in plain words (mirrors my_stats' trust_score, §6.3). */
export const TRUST_EXPLAINER =
  'Everyone starts at 100. A post left open for more than a week takes a few points off until it fills or you take it down. Every shift you covered in the last 30 days earns points back.'

/** First and last day of the month that `today` is in. */
export function monthRange(today: Ymd): { from: Ymd; to: Ymd } {
  const { year, month } = monthOf(today)
  return { from: makeYmd(year, month, 1), to: makeYmd(year, month, daysInMonth(year, month)) }
}

/**
 * Covered shifts I work for someone dated within from…to, split into ones that
 * have started (done) and ones still to come.
 */
export function coversInRange(
  shifts: readonly Shift[],
  me: string,
  range: { from: Ymd; to: Ymd },
  nowMs: number,
): MonthCovers {
  const out: MonthCovers = { done: 0, upcoming: 0 }
  for (const s of shifts) {
    if (s.status !== 'covered' || s.coverer_id !== me || s.date < range.from || s.date > range.to) continue
    const starts = Date.parse(s.starts_at)
    if (Number.isFinite(starts) && starts <= nowMs) out.done += 1
    else out.upcoming += 1
  }
  return out
}

// ---------------------------------------------------------------------------
// Forms
// ---------------------------------------------------------------------------

/** Profile ▸ Edit my details. The phone rule is the shared one (src/lib/validation.ts). */
export const detailsSchema = z.object({
  phone: phoneSchema,
  station: z
    .number()
    .nullable()
    .refine((station) => isStation(station), 'Choose your station.'),
  tour: z.number().nullable().refine((tour) => tour === null || isTour(tour), 'Choose your tour, or "No tour".'),
  notifyScope: z.enum(NOTIFY_SCOPES),
})

export type DetailsFormValues = z.input<typeof detailsSchema>
export type DetailsValues = z.output<typeof detailsSchema>

export const CURRENT_PASSWORD_REQUIRED_MESSAGE = 'Enter your current password.'
export const CURRENT_PASSWORD_WRONG_MESSAGE =
  "That isn't your current password. Try again, or ask an admin to reset it if you've forgotten it."

/**
 * Profile ▸ Change password (SEC-1): the current password first, then the
 * shared new-password + confirmation rules (src/lib/validation.ts).
 */
export const profilePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, CURRENT_PASSWORD_REQUIRED_MESSAGE),
    password: newPasswordSchema,
    confirmPassword: z.string().min(1, PASSWORD_CONFIRM_MESSAGE),
  })
  .refine((values) => values.password === values.confirmPassword, {
    path: ['confirmPassword'],
    error: PASSWORD_MISMATCH_MESSAGE,
  })

export type ProfilePasswordValues = z.input<typeof profilePasswordSchema>

/**
 * True when the check sign-in with the current password was refused because
 * the password is wrong (auth error code invalid_credentials), as opposed to
 * a network problem or rate limit, which keep their own messages.
 */
export function isWrongCurrentPassword(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 'invalid_credentials'
}

/** The auth error code Supabase sends when a password change needs a fresh sign-in. */
export function needsFreshSignIn(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 'reauthentication_needed'
}
