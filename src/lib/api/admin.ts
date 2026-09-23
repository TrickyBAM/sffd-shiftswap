// Admin screens: approvals, members, trades, activity and the overview
// (ARCHITECTURE §6.3 "Admin", §7.1 /admin/**). Every RPC here checks
// is_admin() itself and is audited; the reads rely on the admin RLS policies.

import type {
  AdminOverview,
  AuditEntry,
  MemberPendingDetails,
  MemberStatus,
  Profile,
  Rank,
  Role,
  Shift,
  ShiftStatus,
} from '@/lib/types/database'
import {
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

export interface ListMembersOptions {
  /** Only these statuses (default: all). */
  statuses?: readonly MemberStatus[] | null
  role?: Role | null
  /** Matches name, email, phone or employee ID (contains, case-insensitive). */
  search?: string | null
  /** 'name' (default) or 'newest' first. */
  order?: 'name' | 'newest'
  /** Page size (default 50, max 200). */
  limit?: number
  offset?: number
}

/** Members for /admin/members, with the total count for paging. */
export async function listMembers(sb: Sb, options: ListMembersOptions = {}): Promise<CountedPage<Profile>> {
  const limit = clampLimit(options.limit, 50, 200)
  const offset = Math.max(0, Math.trunc(options.offset ?? 0))
  let query = sb.from('profiles').select('*', { count: 'exact' })
  if (options.statuses?.length) query = query.in('status', [...options.statuses])
  if (options.role) query = query.eq('role', options.role)
  const search = sanitizeSearch(options.search)
  if (search) {
    query = query.or(
      ['full_name', 'email', 'phone', 'employee_id'].map((column) => ilikeContains(column, search)).join(','),
    )
  }
  query =
    options.order === 'newest'
      ? query.order('created_at', { ascending: false }).order('id')
      : query.order('full_name').order('created_at').order('id')
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

export interface ListAdminShiftsOptions {
  /**
   * upcoming   covered, not started (default)
   * past       covered, started
   * open       open posts, not started
   * cancelled  cancelled posts and trades
   */
  scope?: 'upcoming' | 'past' | 'open' | 'cancelled'
  /** Include SwapMatch return legs as their own rows (default false: originals only). */
  includeReturnLegs?: boolean
  /** Only shifts this member posted or covers. */
  memberId?: string | null
  /** Page size (default 50, max 200). */
  limit?: number
  offset?: number
}

/** Shifts and trades for /admin/trades, with the total count for paging. */
export async function listAdminShifts(sb: Sb, options: ListAdminShiftsOptions = {}): Promise<CountedPage<Shift>> {
  const limit = clampLimit(options.limit, 50, 200)
  const offset = Math.max(0, Math.trunc(options.offset ?? 0))
  const scope = options.scope ?? 'upcoming'
  const now = nowIso()
  const status: ShiftStatus = scope === 'open' ? 'open' : scope === 'cancelled' ? 'cancelled' : 'covered'

  let query = sb.from('shifts').select('*', { count: 'exact' }).eq('status', status)
  if (scope === 'upcoming' || scope === 'open') query = query.gt('starts_at', now)
  if (scope === 'past') query = query.lte('starts_at', now)
  if (!options.includeReturnLegs) query = query.is('return_leg_of', null)
  if (options.memberId) {
    const id = assertUuid(options.memberId, 'member')
    query = query.or(`poster_id.eq.${id},coverer_id.eq.${id}`)
  }
  const ascending = scope === 'upcoming' || scope === 'open'
  const { data, count } = await runQuery<Shift[] | null>(
    query
      .order('date', { ascending })
      .order('created_at', { ascending })
      .order('id', { ascending })
      .range(offset, offset + limit - 1),
  )
  const items = Array.isArray(data) ? data : []
  return { items, total: count ?? items.length }
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
