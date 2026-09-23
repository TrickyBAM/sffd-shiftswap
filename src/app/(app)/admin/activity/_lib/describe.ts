// Turns audit_log entries into plain-English lines for /admin/activity:
// "Brian Machado approved Mike Lee", "Ana Cruz posted Oct 14 24-Hour".
// Action names and `details` shapes come from the private.audit(...) calls in
// supabase/migrations/0005-0008 and 0011.

import { formatDate, isYmd } from '@/lib/sffd/dates'
import { stationLabel } from '@/lib/sffd/stations'
import type { AuditEntry, Json, Shift } from '@/lib/types/database'

export type ActivityKind = 'member' | 'post' | 'trade' | 'admin' | 'roster' | 'other'

export interface ActivityLine {
  /** The sentence, e.g. "Brian Machado approved Mike Lee". */
  text: string
  /** A second line: reasons, roster notes, what changed. */
  detail: string | null
  /** Where to look at the thing it's about (member sheet or trade page). */
  href: string | null
  kind: ActivityKind
}

export interface ActivityContext {
  /** Member names by id. */
  names: ReadonlyMap<string, string>
  /** Shifts by id, for the date and type of shift/trade entries. */
  shifts: ReadonlyMap<string, Pick<Shift, 'date' | 'shift_type' | 'poster_name' | 'coverer_name'>>
}

type Details = AuditEntry['details']

function str(value: Json | undefined): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function num(value: Json | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function obj(value: Json | undefined): Details | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Details) : null
}

function quote(text: string | null): string | null {
  return text ? `“${text}”` : null
}

function stationOrNone(value: Json | undefined): string {
  const n = num(value)
  return n === null ? 'no station' : stationLabel(n)
}

function tourOrNone(value: Json | undefined): string {
  const n = num(value)
  return n === null ? 'no tour' : `Tour ${n}`
}

/** Action filters for the activity screen. Values ending in '.' match every action with that prefix. */
export const ACTIVITY_FILTER_GROUPS: ReadonlyArray<{
  label: string
  options: ReadonlyArray<{ value: string; label: string }>
}> = [
  {
    label: 'Everything by type',
    options: [
      { value: '', label: 'All activity' },
      { value: 'member.', label: 'Sign-ups, profile changes and removals' },
      { value: 'shift.', label: 'Posts' },
      { value: 'trade.', label: 'Trades' },
      { value: 'admin.', label: 'Admin actions' },
    ],
  },
  {
    label: 'One kind of event',
    options: [
      { value: 'member.pending', label: 'Sign-ups waiting for approval' },
      { value: 'member.auto_approved', label: 'Automatic approvals (roster match)' },
      { value: 'admin.member_approved', label: 'Approved by an admin' },
      { value: 'admin.member_rejected', label: 'Turned down' },
      { value: 'admin.member_status', label: 'Suspended or reactivated' },
      { value: 'member.removed', label: 'Accounts removed' },
      { value: 'admin.member_role', label: 'Admin access changes' },
      { value: 'admin.member_updated', label: 'Member details edited' },
      { value: 'admin.password_reset', label: 'Password resets' },
      { value: 'shift.posted', label: 'Shifts posted' },
      { value: 'shift.cancelled', label: 'Posts withdrawn' },
      { value: 'trade.confirmed', label: 'Trades confirmed' },
      { value: 'trade.cancel_requested', label: 'Requests to cancel a trade' },
      { value: 'trade.cancelled', label: 'Trades cancelled by agreement' },
      { value: 'admin.post_cancelled', label: 'Posts taken down by an admin' },
      { value: 'admin.trade_voided', label: 'Trades voided by an admin' },
      { value: 'admin.roster_imported', label: 'Roster imports' },
      { value: 'admin.roster_deleted', label: 'Roster entries removed' },
    ],
  },
]

/** Every valid filter value. */
export const ACTIVITY_FILTER_VALUES: ReadonlySet<string> = new Set(
  ACTIVITY_FILTER_GROUPS.flatMap((group) => group.options.map((option) => option.value)),
)

/** Ids of members an entry mentions (actor, target member, trade partners). */
export function memberIdsIn(entry: Pick<AuditEntry, 'actor_id' | 'target_type' | 'target_id' | 'details'>): string[] {
  const ids: string[] = []
  if (entry.actor_id) ids.push(entry.actor_id)
  if (entry.target_type === 'profile' && entry.target_id) ids.push(entry.target_id)
  for (const key of ['coverer_id', 'poster_id', 'requested_by', 'claimed_by']) {
    const id = str(entry.details?.[key])
    if (id) ids.push(id)
  }
  return ids
}

/** Id of the shift an entry is about, if any. */
export function shiftIdIn(entry: Pick<AuditEntry, 'target_type' | 'target_id'>): string | null {
  return entry.target_type === 'shift' && entry.target_id ? entry.target_id : null
}

/** Humanises an unknown action name: 'admin.something_new' → 'something new'. */
function humanize(action: string): string {
  const last = action.split('.').pop() ?? action
  return last.replace(/_/g, ' ').trim() || action
}

const MEMBER_FIELD_LABELS: Readonly<Record<string, string>> = {
  full_name: 'name',
  rank: 'rank',
  station: 'station',
  tour: 'tour',
  phone: 'phone',
  employee_id: 'employee ID',
}

/** The plain-English line for one audit entry. */
export function describeActivity(entry: AuditEntry, ctx: ActivityContext): ActivityLine {
  const d = entry.details ?? {}
  const nameOf = (id: string | null | undefined, fallback = 'a member') => (id ? (ctx.names.get(id) ?? fallback) : fallback)
  const actor = entry.actor_id ? nameOf(entry.actor_id, 'Someone') : 'ShiftSwap'
  const target = entry.target_type === 'profile' ? nameOf(entry.target_id) : 'a member'
  const memberHref = entry.target_type === 'profile' && entry.target_id ? `/admin/members?member=${entry.target_id}` : null

  const shiftId = shiftIdIn(entry)
  const shift = shiftId ? ctx.shifts.get(shiftId) : undefined
  const shiftHref = shiftId ? `/trades/${shiftId}` : null
  const date = str(d.date) ?? shift?.date ?? null
  const type = str(d.shift_type) ?? shift?.shift_type ?? null
  const dateText = date && isYmd(date) ? formatDate(date, 'short') : null
  /** "Oct 14 24-Hour" / "Oct 14" / "a shift" */
  const shiftText = dateText ? `${dateText}${type ? ` ${type}` : ''}` : 'a shift'
  const reason = quote(str(d.reason))

  switch (entry.action) {
    // ----- members -------------------------------------------------------
    case 'member.pending': {
      const attempt = num(d.attempt)
      const again = attempt !== null && attempt > 1 ? ` (try ${attempt})` : ''
      return {
        text: `${actor} signed up and is waiting for approval${again}`,
        detail: str(d.roster_note) ?? (d.auto_approve_blocked === true ? 'Auto-approval stopped after too many tries.' : null),
        href: memberHref,
        kind: 'member',
      }
    }
    case 'member.auto_approved':
      return { text: `${actor} joined (matched the roster)`, detail: null, href: memberHref, kind: 'member' }
    case 'member.telestaff_acknowledged':
      return { text: `${actor} acknowledged the TeleStaff notice`, detail: null, href: memberHref, kind: 'member' }
    case 'member.profile_updated': {
      const changes: string[] = []
      const station = obj(d.station)
      const tour = obj(d.tour)
      if (station && num(station.from) !== num(station.to)) {
        changes.push(`${stationOrNone(station.from)} → ${stationOrNone(station.to)}`)
      }
      if (tour && num(tour.from) !== num(tour.to)) changes.push(`${tourOrNone(tour.from)} → ${tourOrNone(tour.to)}`)
      return {
        text: `${actor} changed their station or tour`,
        detail: changes.length ? changes.join(', ') : null,
        href: memberHref,
        kind: 'member',
      }
    }

    // ----- posts & trades ------------------------------------------------
    case 'shift.posted': {
      const returns = Array.isArray(d.return_dates) ? d.return_dates.filter((x): x is string => isYmd(x)) : []
      return {
        text: `${actor} posted ${shiftText}`,
        detail: returns.length ? `SwapMatch: ${returns.map((r) => formatDate(r, 'short')).join(', ')}` : null,
        href: shiftHref,
        kind: 'post',
      }
    }
    case 'shift.cancelled':
      return { text: `${actor} withdrew their ${shiftText} post`, detail: null, href: shiftHref, kind: 'post' }
    case 'trade.confirmed': {
      const coverer = nameOf(str(d.coverer_id), shift?.coverer_name ?? 'a member')
      const returnDate = str(d.return_date)
      return {
        text: `${actor} confirmed ${coverer} to cover ${shiftText}`,
        detail: returnDate && isYmd(returnDate) ? `SwapMatch: pays back ${formatDate(returnDate, 'short')}` : null,
        href: shiftHref,
        kind: 'trade',
      }
    }
    case 'trade.cancel_requested':
      return { text: `${actor} asked to cancel the ${shiftText} trade`, detail: reason, href: shiftHref, kind: 'trade' }
    case 'trade.cancelled':
      return {
        text: `${actor} agreed to cancel the ${shiftText} trade`,
        detail: [d.reopened === true ? 'The shift went back on the board.' : null, reason].filter(Boolean).join(' ') || null,
        href: shiftHref,
        kind: 'trade',
      }
    case 'trade.cancel_declined':
      return {
        text: `${actor} said no to cancelling the ${shiftText} trade`,
        detail: str(d.requested_by) ? `${nameOf(str(d.requested_by))} had asked to cancel.` : null,
        href: shiftHref,
        kind: 'trade',
      }
    case 'trade.cancel_withdrawn':
      return { text: `${actor} took back their request to cancel the ${shiftText} trade`, detail: null, href: shiftHref, kind: 'trade' }

    // ----- admin -----------------------------------------------------------
    case 'admin.member_approved':
      return {
        text: `${actor} approved ${target}`,
        detail: str(d.roster_id) ? 'Linked to their roster entry.' : null,
        href: memberHref,
        kind: 'admin',
      }
    case 'admin.member_rejected':
      return { text: `${actor} turned down ${target}`, detail: reason, href: memberHref, kind: 'admin' }
    case 'admin.member_status': {
      const to = str(d.to)
      const posts = num(d.posts_cancelled) ?? 0
      const extra =
        to === 'suspended' && posts > 0
          ? `${posts} open post${posts === 1 ? '' : 's'} taken down.`
          : to === 'approved' && d.was_removed === true
            ? 'Their account had been removed.'
            : null
      return {
        text: to === 'suspended' ? `${actor} suspended ${target}` : `${actor} reactivated ${target}`,
        detail: [reason, extra].filter(Boolean).join(' ') || null,
        href: memberHref,
        kind: 'admin',
      }
    }
    case 'member.removed': {
      const posts = num(d.posts_cancelled) ?? 0
      const upcoming = num(d.upcoming_trades) ?? 0
      const extra = [
        posts > 0 ? `${posts} open post${posts === 1 ? '' : 's'} taken down.` : null,
        upcoming > 0 ? `${upcoming} confirmed trade${upcoming === 1 ? '' : 's'} still coming up.` : null,
      ]
      return {
        text: `${actor} removed ${target}'s account`,
        detail: [reason, ...extra].filter(Boolean).join(' ') || null,
        href: memberHref,
        kind: 'admin',
      }
    }
    case 'admin.member_role':
      return {
        text: str(d.to) === 'admin' ? `${actor} made ${target} an admin` : `${actor} removed admin access from ${target}`,
        detail: null,
        href: memberHref,
        kind: 'admin',
      }
    case 'admin.member_updated': {
      const before = obj(d.before) ?? {}
      const after = obj(d.after) ?? {}
      const changed = Object.keys(MEMBER_FIELD_LABELS).filter(
        (key) => JSON.stringify(before[key] ?? null) !== JSON.stringify(after[key] ?? null),
      )
      return {
        text: `${actor} edited ${target}'s details`,
        detail: changed.length ? `Changed: ${changed.map((key) => MEMBER_FIELD_LABELS[key]).join(', ')}` : null,
        href: memberHref,
        kind: 'admin',
      }
    }
    case 'admin.password_reset':
      return { text: `${actor} reset ${target}'s password`, detail: null, href: memberHref, kind: 'admin' }
    case 'admin.post_cancelled': {
      const poster = nameOf(str(d.poster_id), shift?.poster_name ?? 'a member')
      return { text: `${actor} took down ${poster}'s ${shiftText} post`, detail: reason, href: shiftHref, kind: 'admin' }
    }
    case 'admin.trade_voided': {
      const poster = nameOf(str(d.poster_id), shift?.poster_name ?? 'a member')
      const coverer = nameOf(str(d.coverer_id), shift?.coverer_name ?? 'a member')
      return {
        text: `${actor} voided the ${shiftText} trade between ${poster} and ${coverer}`,
        detail: reason,
        href: shiftHref,
        kind: 'admin',
      }
    }
    case 'admin.roster_imported': {
      const parts = [
        `${num(d.inserted) ?? 0} added`,
        `${num(d.updated) ?? 0} updated`,
        `${num(d.skipped) ?? 0} unchanged`,
      ]
      if (d.replace === true) parts.push(`${num(d.deleted) ?? 0} old unclaimed entries removed`)
      const errors = num(d.errors) ?? 0
      if (errors > 0) parts.push(`${errors} rows refused`)
      return { text: `${actor} imported the roster`, detail: `${parts.join(', ')}.`, href: '/admin/roster', kind: 'roster' }
    }
    case 'admin.roster_deleted': {
      const who = [str(d.first_name), str(d.last_name)].filter(Boolean).join(' ') || 'an entry'
      const claimedBy = str(d.claimed_by)
      return {
        text: `${actor} removed ${who} from the roster`,
        detail: claimedBy ? `It was linked to ${nameOf(claimedBy)}.` : null,
        href: '/admin/roster',
        kind: 'roster',
      }
    }
    default:
      return {
        text: `${actor}: ${humanize(entry.action)}`,
        detail: null,
        href: memberHref ?? shiftHref,
        kind: 'other',
      }
  }
}
