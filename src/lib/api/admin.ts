// Admin screens: approvals, members, trades, activity and the overview
// (ARCHITECTURE §6.3 "Admin", §7.1 /admin/**). Every RPC here checks
// is_admin() itself and is audited; the reads rely on the admin RLS policies.

import { AppError } from '@/lib/errors'
import { isYmd, type Ymd } from '@/lib/sffd/dates'
import type {
  AdminOverview,
  AuditEntry,
  MemberPendingDetails,
  MemberStatus,
  Profile,
  Rank,
  RemoveMemberResult,
  Role,
  Shift,
} from '@/lib/types/database'
import {
  assertInt,
  assertUuid,
  blankToNull,
  callRpc,
  clampLimit,
  ilikeContains,
  isUuid,
  nowIso,
  runList,
  runMaybe,
  runQuery,
  sanitizeSearch,
  type CountedPage,
  type Page,
  type Sb,
} from './core'
import { getShiftsByIds } from './shifts'

// ---------------------------------------------------------------------------
// Member actions
// ---------------------------------------------------------------------------

/**
 * Approves a pending/rejected/suspended member, optionally linking a roster
 * entry (admin_approve_member). The member is notified.
 */
export async function approveMember(sb: Sb, userId: string, rosterId?: string | null): Promise<void> {
  await callRpc(sb, 'admin_approve_member', { p_user_id: userId, p_roster_id: rosterId ?? null }, { flush: true })
}

/** Turns down an applicant (admin_reject_member). The reason is shown to them. */
export async function rejectMember(sb: Sb, userId: string, reason?: string | null): Promise<void> {
  await callRpc(sb, 'admin_reject_member', { p_user_id: userId, p_reason: blankToNull(reason) }, { flush: true })
}

/**
 * Suspends or reinstates a member (admin_set_member_status). Suspending takes
 * down their upcoming open posts and closes their pending requests.
 */
export async function setMemberStatus(
  sb: Sb,
  userId: string,
  status: 'approved' | 'suspended',
  reason?: string | null,
): Promise<void> {
  await callRpc(
    sb,
    'admin_set_member_status',
    { p_user_id: userId, p_status: status, p_reason: blankToNull(reason) },
    { flush: true },
  )
}

/** Makes a member an admin or removes admin access (LAST_ADMIN protects the last one). */
export async function setMemberRole(sb: Sb, userId: string, role: Role): Promise<void> {
  await callRpc(sb, 'admin_set_role', { p_user_id: userId, p_role: role }, { flush: true })
}

export interface AdminUpdateMemberInput {
  fullName: string
  rank: Rank
  station: number
  /** 1–31, or null for "No tour". */
  tour: number | null
  phone: string
  employeeId?: string | null
}

/** Edits a member's name, rank, station, tour, phone and employee ID (admin_update_member). */
export async function updateMember(sb: Sb, userId: string, input: AdminUpdateMemberInput): Promise<void> {
  await callRpc(sb, 'admin_update_member', {
    p_user_id: userId,
    p_full_name: input.fullName,
    p_rank: input.rank,
    p_station: input.station,
    p_tour: input.tour ?? null,
    p_phone: input.phone,
    p_employee_id: blankToNull(input.employeeId),
  })
}

/**
 * Forces a password change at the member's next sign-in. Call after the
 * server route has set a temporary password with the service key.
 */
export async function markMustChangePassword(sb: Sb, userId: string): Promise<void> {
  await callRpc(sb, 'admin_mark_must_change_password', { p_user_id: userId })
}

/**
 * Removes a member's account at their request (admin_remove_member): the
 * account is closed (suspended, removed_at set, admin rights dropped), their
 * phone, employee ID, alerts and push subscriptions are deleted, and they come
 * off the board like a suspension. Names on past trades stay. The reason is
 * shown to them and kept in the audit log. Returns what was taken off the
 * board; upcoming confirmed trades stay (void them if they won't happen).
 */
export async function adminRemoveMember(sb: Sb, userId: string, reason?: string | null): Promise<RemoveMemberResult> {
  const result = await callRpc(
    sb,
    'admin_remove_member',
    { p_user_id: assertUuid(userId, 'member'), p_reason: blankToNull(reason) },
    { flush: true },
  )
  return {
    posts_cancelled: Number(result?.posts_cancelled ?? 0),
    requests_closed: Number(result?.requests_closed ?? 0),
    upcoming_trades: Number(result?.upcoming_trades ?? 0),
  }
}

// ---------------------------------------------------------------------------
// Shift/trade actions
// ---------------------------------------------------------------------------

/** Takes down an open post, even after it started (admin_cancel_post). */
export async function adminCancelPost(sb: Sb, shiftId: string, reason?: string | null): Promise<void> {
  await callRpc(sb, 'admin_cancel_post', { p_shift_id: shiftId, p_reason: blankToNull(reason) }, { flush: true })
}

/**
 * Voids a confirmed trade by either leg, even after it started
 * (admin_void_trade). Both members are notified.
 */
export async function adminVoidTrade(sb: Sb, shiftId: string, reason?: string | null): Promise<void> {
  await callRpc(sb, 'admin_void_trade', { p_shift_id: shiftId, p_reason: blankToNull(reason) }, { flush: true })
}

/** Dashboard counts (admin_overview). */
export async function getAdminOverview(sb: Sb): Promise<AdminOverview> {
  return callRpc(sb, 'admin_overview', {})
}

// ---------------------------------------------------------------------------
// Member reads
// ---------------------------------------------------------------------------

/** Any member's profile (admins can read every row), or null. */
export async function getMember(sb: Sb, userId: string): Promise<Profile | null> {
  if (!isUuid(userId)) return null
  return runMaybe<Profile>(sb.from('profiles').select('*').eq('id', userId).maybeSingle())
}

/** Removed members: 'include' (no filter, the default), 'exclude' or 'only'. */
export type RemovedFilter = 'include' | 'exclude' | 'only'

export interface ListMembersOptions {
  /** Only these statuses (default: all). */
  statuses?: readonly MemberStatus[] | null
  role?: Role | null
  /** Only members at this station. */
  station?: number | null
  /** Only members in this battalion. */
  battalion?: number | null
  /** Matches name, email, phone or employee ID (contains, case-insensitive). */
  search?: string | null
  /**
   * 'name' (default), 'newest' (signed up most recently) or 'approved'
   * (approved most recently, never-approved last).
   */
  order?: 'name' | 'newest' | 'approved'
  /** Only members approved within the last N days ("recently joined"). */
  joinedWithinDays?: number | null
  /**
   * Members an admin removed (profiles.removed_at, migration 0011). Default
   * 'include' = no filter, so the query works before that migration.
   */
  removed?: RemovedFilter
  /** Page size (default 50, max 200). */
  limit?: number
  offset?: number
  /** "Now" for joinedWithinDays (tests). */
  now?: Date
}

/** Members for /admin/members, with the total count for paging. */
export async function listMembers(sb: Sb, options: ListMembersOptions = {}): Promise<CountedPage<Profile>> {
  const limit = clampLimit(options.limit, 50, 200)
  const offset = Math.max(0, Math.trunc(options.offset ?? 0))
  let query = sb.from('profiles').select('*', { count: 'exact' })
  if (options.statuses?.length) query = query.in('status', [...options.statuses])
  if (options.role) query = query.eq('role', options.role)
  if (options.station != null) query = query.eq('station', assertInt(options.station, 'station'))
  if (options.battalion != null) query = query.eq('battalion', assertInt(options.battalion, 'battalion'))
  if (options.removed === 'exclude') query = query.is('removed_at', null)
  if (options.removed === 'only') query = query.not('removed_at', 'is', null)
  if (options.joinedWithinDays != null) {
    const days = assertInt(options.joinedWithinDays, 'number of days')
    if (days < 1) throw new AppError('INVALID_INPUT', 'Choose at least 1 day.')
    const since = new Date((options.now ?? new Date()).getTime() - days * 86_400_000)
    query = query.gte('approved_at', nowIso(since))
  }
  const search = sanitizeSearch(options.search)
  if (search) {
    query = query.or(
      ['full_name', 'email', 'phone', 'employee_id'].map((column) => ilikeContains(column, search)).join(','),
    )
  }
  if (options.order === 'newest') query = query.order('created_at', { ascending: false }).order('id')
  else if (options.order === 'approved') {
    query = query.order('approved_at', { ascending: false, nullsFirst: false }).order('full_name').order('id')
  } else query = query.order('full_name').order('created_at').order('id')
  const { data, count } = await runQuery<Profile[] | null>(query.range(offset, offset + limit - 1))
  const items = Array.isArray(data) ? data : []
  return { items, total: count ?? items.length }
}

/** A pending member with the admin-only roster note from their latest submission. */
export interface PendingApproval {
  member: Profile
  /** "Roster: John Smith, Station 19 — tour differs", or null if never recorded. */
  rosterNote: string | null
  /** The closest roster candidate (pre-select it when approving), if exactly one was found. */
  rosterId: string | null
  /** Number of onboarding submissions so far. */
  attempts: number
  /** Auto-approval was switched off after too many tries. */
  autoApproveBlocked: boolean
  /** When they last submitted. */
  submittedAt: string | null
}

/**
 * Pending members for the Approvals screen, oldest first, each with the roster
 * note complete_onboarding recorded in the audit log (`member.pending`).
 */
export async function listPendingApprovals(sb: Sb, options: { limit?: number } = {}): Promise<PendingApproval[]> {
  const members = await runList<Profile>(
    sb
      .from('profiles')
      .select('*')
      .eq('status', 'pending')
      .order('created_at')
      .order('id')
      .limit(clampLimit(options.limit, 200, 500)),
  )
  if (!members.length) return []
  const entries = await runList<Pick<AuditEntry, 'target_id' | 'details' | 'created_at'>>(
    sb
      .from('audit_log')
      .select('target_id, details, created_at')
      .eq('action', 'member.pending')
      .eq('target_type', 'profile')
      .in(
        'target_id',
        members.map((m) => m.id),
      )
      .order('created_at', { ascending: false })
      .limit(2000),
  )
  const notes = pendingNotesByMember(entries)
  return members.map((member) => {
    const note = notes.get(member.id)
    return {
      member,
      rosterNote: note?.rosterNote ?? null,
      rosterId: note?.rosterId ?? null,
      attempts: note?.attempts ?? 0,
      autoApproveBlocked: note?.autoApproveBlocked ?? false,
      submittedAt: note?.submittedAt ?? null,
    }
  })
}

type PendingNote = Omit<PendingApproval, 'member'>

/**
 * Latest `member.pending` note per member from audit entries (any order).
 * `attempts` is the highest attempt number seen (or the entry count).
 */
export function pendingNotesByMember(
  entries: readonly Pick<AuditEntry, 'target_id' | 'details' | 'created_at'>[],
): Map<string, PendingNote> {
  const latest = new Map<string, { at: number; entry: Pick<AuditEntry, 'details' | 'created_at'> }>()
  const counts = new Map<string, { entries: number; maxAttempt: number }>()
  for (const entry of entries) {
    if (!entry.target_id) continue
    const at = Date.parse(entry.created_at)
    const current = latest.get(entry.target_id)
    if (!current || at > current.at) latest.set(entry.target_id, { at, entry })
    const attempt = Number((entry.details as Partial<MemberPendingDetails> | null)?.attempt)
    const seen = counts.get(entry.target_id) ?? { entries: 0, maxAttempt: 0 }
    counts.set(entry.target_id, {
      entries: seen.entries + 1,
      maxAttempt: Number.isInteger(attempt) ? Math.max(seen.maxAttempt, attempt) : seen.maxAttempt,
    })
  }
  const out = new Map<string, PendingNote>()
  for (const [id, { entry }] of latest) {
    const details = (entry.details ?? {}) as Partial<MemberPendingDetails>
    const count = counts.get(id)
    out.set(id, {
      rosterNote: typeof details.roster_note === 'string' ? details.roster_note : null,
      rosterId: isUuid(details.roster_id) ? details.roster_id : null,
      attempts: Math.max(count?.entries ?? 1, count?.maxAttempt ?? 0),
      autoApproveBlocked: details.auto_approve_blocked === true,
      submittedAt: entry.created_at ?? null,
    })
  }
  return out
}

// ---------------------------------------------------------------------------
// Trades & activity reads
// ---------------------------------------------------------------------------

/**
 * Which shifts /admin/trades lists:
 *   upcoming   covered, not started (default)
 *   past       covered, started
 *   open       open posts, not started
 *   cancelled  cancelled posts and trades
 *   all        everything
 */
export type AdminShiftScope = 'upcoming' | 'past' | 'open' | 'cancelled' | 'all'

export interface ListAdminShiftsOptions {
  scope?: AdminShiftScope
  /** Include SwapMatch return legs as their own rows (default false: originals only). */
  includeReturnLegs?: boolean
  /** Also load the SwapMatch return legs of the listed originals (see `returnLegs`). */
  withReturnLegs?: boolean
  /** Only shifts this member posted or covers. */
  memberId?: string | null
  /** Poster or coverer name contains this (any case; the names saved on the shift). */
  member?: string | null
  /** Shift dates from…to, inclusive ('YYYY-MM-DD'; blank = no limit). */
  from?: Ymd | null
  to?: Ymd | null
  /** Only shifts at stations in this battalion. */
  battalion?: number | null
  /** Only shifts at this station. */
  station?: number | null
  /** Page size (default 50, max 200). */
  limit?: number
  offset?: number
  /** "Now" for the upcoming/past/open split (tests). */
  now?: Date
}

/** A page of admin shifts, plus the return legs of SwapMatch originals when asked for. */
export interface AdminShiftPage extends CountedPage<Shift> {
  /** Return legs by id (filled only with `withReturnLegs`). */
  returnLegs: Map<string, Shift>
}

function optionalDate(value: string | null | undefined, what: string): Ymd | null {
  if (value == null || value.trim() === '') return null
  if (!isYmd(value)) throw new AppError('INVALID_INPUT', `Choose a valid ${what}.`)
  return value
}

/**
 * Shifts and trades for /admin/trades, with the total count for paging:
 * scope (status and timing), date range, battalion/station, member (by id or
 * by name) and offset paging. Upcoming and open run soonest first, the rest
 * latest first.
 */
export async function listAdminShifts(sb: Sb, options: ListAdminShiftsOptions = {}): Promise<AdminShiftPage> {
  const limit = clampLimit(options.limit, 50, 200)
  const offset = Math.max(0, Math.trunc(options.offset ?? 0))
  const scope = options.scope ?? 'upcoming'
  const now = nowIso(options.now)
  const from = optionalDate(options.from, 'start date')
  const to = optionalDate(options.to, 'end date')

  let query = sb.from('shifts').select('*', { count: 'exact' })
  switch (scope) {
    case 'upcoming':
      query = query.eq('status', 'covered').gt('starts_at', now)
      break
    case 'past':
      query = query.eq('status', 'covered').lte('starts_at', now)
      break
    case 'open':
      query = query.eq('status', 'open').gt('starts_at', now)
      break
    case 'cancelled':
      query = query.eq('status', 'cancelled')
      break
    case 'all':
      break
  }
  if (!options.includeReturnLegs) query = query.is('return_leg_of', null)
  if (from) query = query.gte('date', from)
  if (to) query = query.lte('date', to)
  if (options.station != null) query = query.eq('station', assertInt(options.station, 'station'))
  if (options.battalion != null) query = query.eq('battalion', assertInt(options.battalion, 'battalion'))
  if (options.memberId) {
    const id = assertUuid(options.memberId, 'member')
    query = query.or(`poster_id.eq.${id},coverer_id.eq.${id}`)
  }
  const member = sanitizeSearch(options.member)
  if (member) query = query.or([ilikeContains('poster_name', member), ilikeContains('coverer_name', member)].join(','))

  const ascending = scope === 'upcoming' || scope === 'open'
  const { data, count } = await runQuery<Shift[] | null>(
    query
      .order('date', { ascending })
      .order('created_at', { ascending })
      .order('id', { ascending })
      .range(offset, offset + limit - 1),
  )
  const items = Array.isArray(data) ? data : []
  const returnLegs = new Map<string, Shift>()
  if (options.withReturnLegs) {
    const known = new Set(items.map((shift) => shift.id))
    const legIds = items.map((shift) => shift.return_leg_id).filter((id): id is string => Boolean(id) && !known.has(id as string))
    for (const leg of await getShiftsByIds(sb, legIds)) returnLegs.set(leg.id, leg)
    for (const shift of items) if (shift.return_leg_of) returnLegs.set(shift.id, shift)
  }
  return { items, total: count ?? items.length, returnLegs }
}

export interface ListAuditLogOptions {
  /** Page size (default 50, max 200). */
  limit?: number
  /** `nextCursor` from the previous page: entries with a smaller id. */
  before?: number | null
  /** e.g. 'trade.confirmed', or a prefix ending in '.' such as 'admin.' */
  action?: string | null
  targetType?: string | null
  targetId?: string | null
  actorId?: string | null
}

/** The audit log for /admin/activity, newest first. */
export async function listAuditLog(sb: Sb, options: ListAuditLogOptions = {}): Promise<Page<AuditEntry, number>> {
  const limit = clampLimit(options.limit, 50, 200)
  let query = sb.from('audit_log').select('*')
  if (typeof options.before === 'number' && Number.isFinite(options.before)) query = query.lt('id', options.before)
  const action = options.action?.trim()
  if (action) {
    query = action.endsWith('.') ? query.like('action', `${action.replace(/[%_\\]/g, '')}%`) : query.eq('action', action)
  }
  if (options.targetType) query = query.eq('target_type', options.targetType)
  if (options.targetId) query = query.eq('target_id', assertUuid(options.targetId))
  if (options.actorId) query = query.eq('actor_id', assertUuid(options.actorId, 'member'))
  const rows = await runList<AuditEntry>(query.order('id', { ascending: false }).limit(limit + 1))
  const items = rows.slice(0, limit)
  const last = items[items.length - 1]
  return { items, nextCursor: rows.length > limit && last ? last.id : null }
}
