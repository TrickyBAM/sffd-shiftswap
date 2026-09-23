// Row and RPC types for the ShiftSwap database (ARCHITECTURE §6).
//
// Hand-written to mirror supabase/migrations/*.sql exactly (column names,
// nullability, check-constraint value sets, RPC argument names and return
// shapes). When a migration changes, change this file in the same commit.
//
// How Postgres values arrive through PostgREST / supabase-js:
//   date          → Ymd, a 'YYYY-MM-DD' calendar day in America/Los_Angeles (§3)
//   date[]        → Ymd[]
//   timestamptz   → Timestamp, an ISO-8601 string with offset
//   uuid          → Uuid (string)
//   int, smallint → number (bigint identity columns too; ours stay small)
//   jsonb         → the documented object shape
//   nullable      → `| null` (never `undefined`)

import type { Ymd } from '@/lib/sffd/dates'
import type { Rank } from '@/lib/sffd/ranks'
import type { ShiftType } from '@/lib/sffd/shift-types'

export type { Ymd, Rank, ShiftType }

/** A uuid, as a string. */
export type Uuid = string

/** An ISO-8601 timestamp string (timestamptz), e.g. '2026-09-23T15:04:05.123456+00:00'. */
export type Timestamp = string

/** Any JSON value (jsonb). */
export type Json = string | number | boolean | null | Json[] | { [key: string]: Json | undefined }

// ---------------------------------------------------------------------------
// Value sets (check constraints). Each list is the runtime source for its type.
// Ranks and shift types live in src/lib/sffd (RANKS, SHIFT_TYPE_VALUES).
// ---------------------------------------------------------------------------

/** profiles.status */
export const MEMBER_STATUSES = ['onboarding', 'pending', 'approved', 'rejected', 'suspended'] as const
export type MemberStatus = (typeof MEMBER_STATUSES)[number]

/** profiles.role */
export const ROLES = ['member', 'admin'] as const
export type Role = (typeof ROLES)[number]

/** profiles.notify_scope — which new posts trigger a `new_shift` alert (§6.5). */
export const NOTIFY_SCOPES = ['off', 'station', 'battalion', 'division', 'all'] as const
export type NotifyScope = (typeof NOTIFY_SCOPES)[number]

/** shifts.status */
export const SHIFT_STATUSES = ['open', 'covered', 'cancelled'] as const
export type ShiftStatus = (typeof SHIFT_STATUSES)[number]

/** shifts.accept_limit — who may request, relative to the shift's station. */
export const ACCEPT_LIMITS = ['anyone', 'division', 'battalion', 'station'] as const
export type AcceptLimit = (typeof ACCEPT_LIMITS)[number]

/** shift_requests.status */
export const REQUEST_STATUSES = ['pending', 'accepted', 'declined', 'withdrawn', 'cancelled'] as const
export type RequestStatus = (typeof REQUEST_STATUSES)[number]

/** notifications.type */
export const NOTIFICATION_TYPES = [
  'request_received',
  'request_accepted',
  'request_declined',
  'request_withdrawn',
  'post_cancelled',
  'cancel_requested',
  'trade_cancelled',
  'cancel_declined',
  'trade_voided',
  'new_shift',
  'message',
  'member_pending',
  'member_auto_approved',
  'member_approved',
  'member_rejected',
  'account_status',
] as const
export type NotificationType = (typeof NOTIFICATION_TYPES)[number]

/**
 * Hint codes RPCs raise with (`raise … using errcode = 'P0001', hint = '<CODE>'`,
 * §6.6). The client shows the error message and may branch on the code.
 */
export const ERROR_HINTS = [
  'NOT_SIGNED_IN',
  'NOT_APPROVED',
  'NOT_ADMIN',
  'ACK_REQUIRED',
  'INVALID_INPUT',
  'NOT_FOUND',
  'OWN_SHIFT',
  'NOT_OPEN',
  'STARTED',
  'TOO_FAR_AHEAD',
  'RANK_MISMATCH',
  'OUTSIDE_LIMIT',
  'YOU_WORK_THAT_DAY',
  'NOT_YOUR_SHIFT_DAY',
  'ALREADY_POSTED',
  'ALREADY_COVERING',
  'ALREADY_REQUESTED',
  'RETURN_DATE_REQUIRED',
  'RETURN_DATE_INVALID',
  'RETURN_NOT_YOUR_DAY',
  'POSTER_WORKS_RETURN_DAY',
  'NOT_PARTICIPANT',
  'NO_CANCEL_PENDING',
  'LAST_ADMIN',
] as const
export type ErrorHint = (typeof ERROR_HINTS)[number]

/** calendar_feed().kind */
export const CALENDAR_FEED_KINDS = ['work', 'covering', 'covered_for_me', 'swap'] as const
export type CalendarFeedKind = (typeof CALENDAR_FEED_KINDS)[number]

function isOneOf<T extends string>(list: readonly T[], value: unknown): value is T {
  return typeof value === 'string' && (list as readonly string[]).includes(value)
}

export const isMemberStatus = (value: unknown): value is MemberStatus => isOneOf(MEMBER_STATUSES, value)
export const isRole = (value: unknown): value is Role => isOneOf(ROLES, value)
export const isNotifyScope = (value: unknown): value is NotifyScope => isOneOf(NOTIFY_SCOPES, value)
export const isShiftStatus = (value: unknown): value is ShiftStatus => isOneOf(SHIFT_STATUSES, value)
export const isAcceptLimit = (value: unknown): value is AcceptLimit => isOneOf(ACCEPT_LIMITS, value)
export const isRequestStatus = (value: unknown): value is RequestStatus => isOneOf(REQUEST_STATUSES, value)
export const isNotificationType = (value: unknown): value is NotificationType => isOneOf(NOTIFICATION_TYPES, value)
export const isErrorHint = (value: unknown): value is ErrorHint => isOneOf(ERROR_HINTS, value)

// ---------------------------------------------------------------------------
// Tables (schema public, §6.1)
// ---------------------------------------------------------------------------

/** public.stations — seeded, read-only. */
export interface Station {
  station: number
  battalion: number
  division: number
  /** "Station 19" / "Airport Station 1" */
  label: string
  sort: number
}

/**
 * public.profiles — one per auth user. Members can read only their own row;
 * admins read all. Written only by RPCs (and the auth.users trigger).
 */
export interface Profile {
  id: Uuid
  /** Login email, lower-cased; '' if the auth user has none. */
  email: string
  /** '' until onboarding; 2–80 characters after. */
  full_name: string
  phone: string | null
  /** Null until onboarding. */
  rank: Rank | null
  /** Null until onboarding. Battalion/division are derived from it by RPCs. */
  station: number | null
  battalion: number | null
  division: number | null
  /** 1–31, or null for "No tour" (relief, detail, 40-hour). */
  tour: number | null
  /** Optional; only the member and admins can read it. */
  employee_id: string | null
  status: MemberStatus
  /**
   * The reason an admin gave when rejecting or suspending. Always null while
   * pending: the roster-matching note is admin-only (audit_log `member.pending`).
   */
  status_reason: string | null
  role: Role
  roster_id: Uuid | null
  telestaff_ack_at: Timestamp | null
  must_change_password: boolean
  notify_scope: NotifyScope
  /** Secret for the ICS feed at /api/calendar/<token>. */
  calendar_token: Uuid
  approved_at: Timestamp | null
  /** Null when auto-approved by roster match. */
  approved_by: Uuid | null
  created_at: Timestamp
  updated_at: Timestamp
}

/** public.roster — the department list uploaded by admins (admin-only). */
export interface RosterEntry {
  id: Uuid
  first_name: string
  last_name: string
  /** public.name_key(first_name) — see src/lib/roster/normalize.ts. */
  first_key: string
  /** public.name_key(last_name) */
  last_key: string
  employee_id: string | null
  rank: Rank | null
  station: number | null
  tour: number | null
  email: string | null
  phone: string | null
  /** The member this entry is linked to (a row can be claimed once). */
  claimed_by: Uuid | null
  created_by: Uuid | null
  created_at: Timestamp
}

/**
 * public.shifts — a posted shift and, once confirmed, the trade record.
 * A SwapMatch return leg is an ordinary covered row with `return_leg_of` set.
 */
export interface Shift {
  id: Uuid
  /** Whose shift it is (the member who owes it). */
  poster_id: Uuid
  poster_name: string
  rank: Rank
  station: number
  battalion: number
  division: number
  /** Start date (§3). */
  date: Ymd
  shift_type: ShiftType
  hours: 24 | 16
  starts_at: Timestamp
  status: ShiftStatus
  /** SwapMatch return dates offered (0–10), distinct and sorted. */
  return_dates: Ymd[]
  accept_limit: AcceptLimit
  notes: string | null
  coverer_id: Uuid | null
  /** Kept on a cancelled leg for history (coverer_id is cleared). */
  coverer_name: string | null
  confirmed_at: Timestamp | null
  /** Set on an auto-created SwapMatch return leg: the original shift. */
  return_leg_of: Uuid | null
  /** Set on the original once a SwapMatch is confirmed: its return leg. */
  return_leg_id: Uuid | null
  cancel_requested_by: Uuid | null
  cancel_requested_at: Timestamp | null
  cancel_reason: string | null
  cancelled_at: Timestamp | null
  cancelled_by: Uuid | null
  cancel_note: string | null
  created_at: Timestamp
  updated_at: Timestamp
}

/** public.shift_requests — visible to the requester, the shift's poster and admins. */
export interface ShiftRequest {
  id: Uuid
  shift_id: Uuid
  requester_id: Uuid
  requester_name: string
  requester_rank: Rank
  requester_station: number
  /** The SwapMatch date the requester gives in return (one of the shift's return_dates). */
  return_date: Ymd | null
  message: string | null
  status: RequestStatus
  decided_at: Timestamp | null
  created_at: Timestamp
}

/** public.messages — 1:1 chat about a shift (sender or recipient can read). */
export interface Message {
  id: Uuid
  shift_id: Uuid
  sender_id: Uuid
  recipient_id: Uuid
  /** 1–1000 characters. */
  body: string
  read_at: Timestamp | null
  created_at: Timestamp
}

/**
 * public.notifications — own rows only. Also exported as NotificationRow for
 * files that use the DOM `Notification` API.
 */
export interface Notification {
  id: Uuid
  user_id: Uuid
  type: NotificationType
  title: string
  body: string
  /** In-app deep link, e.g. '/trades/<id>' or '/board?shift=<id>'. */
  url: string
  shift_id: Uuid | null
  actor_id: Uuid | null
  read_at: Timestamp | null
  pushed_at: Timestamp | null
  created_at: Timestamp
}
export type NotificationRow = Notification

/**
 * public.push_subscriptions — own rows only (select/insert/delete). Also
 * exported as PushSubscriptionRow for files that use the DOM `PushSubscription`.
 */
export interface PushSubscription {
  id: Uuid
  user_id: Uuid
  /** https URL on a browser push service (enforced by a check constraint). */
  endpoint: string
  p256dh: string
  auth: string
  user_agent: string | null
  created_at: Timestamp
  last_success_at: Timestamp | null
}
export type PushSubscriptionRow = PushSubscription

/** public.audit_log — admins read. */
export interface AuditEntry {
  id: number
  actor_id: Uuid | null
  /** e.g. 'shift.posted', 'trade.confirmed', 'member.pending', 'admin.member_approved'. */
  action: string
  target_type: string | null
  target_id: Uuid | null
  details: { [key: string]: Json | undefined }
  created_at: Timestamp
}

/**
 * details of a `member.pending` audit entry (written by complete_onboarding
 * each time a submission ends pending). Admin-only roster note.
 */
export interface MemberPendingDetails {
  /** "Roster: John Smith, Station 19 — tour differs" and similar. */
  roster_note: string | null
  /** The closest roster candidate, when exactly one was found. */
  roster_id: Uuid | null
  /** 1-based submission number. */
  attempt: number
  /** True when auto-approval was switched off after too many tries. */
  auto_approve_blocked: boolean
  rank: Rank
  station: number
  tour: number | null
}

// ---------------------------------------------------------------------------
// RPC return shapes (§6.3)
// ---------------------------------------------------------------------------

/** complete_onboarding() */
export interface OnboardingResult {
  status: 'approved' | 'pending'
  matched: boolean
  /** Friendly text to show the member. */
  message: string
}

export interface TypeBalance {
  covered: number
  given: number
  /** covered − given */
  balance: number
}

/** my_stats() */
export interface MyStats {
  /** My non-cancelled posts (original legs only). */
  posted: number
  /** Covered shifts where I'm the coverer. */
  covered: number
  /** Covered shifts where I'm the poster. */
  given: number
  /** My open posts that haven't started. */
  outstanding: number
  /** covered − given */
  balance: number
  /** 0–100 */
  trust_score: number
  by_type: Record<ShiftType, TypeBalance>
}

/** One row of my_ledger(): who covered whom, per partner and shift type. */
export interface LedgerRow {
  partner_id: Uuid
  partner_name: string
  partner_rank: Rank | null
  i_covered_24: number
  i_covered_pm: number
  they_covered_24: number
  they_covered_pm: number
  /** I covered − they covered (positive ⇒ they owe me). */
  net_24: number
  net_pm: number
  /** Covered shifts with this partner that haven't started. */
  upcoming: number
  last_date: Ymd | null
}

/** One day of my_schedule(): my effective schedule (§4). */
export interface ScheduleRow {
  date: Ymd
  /** One of my tour days. */
  base: boolean
  given_away: boolean
  picked_up: boolean
  /** (base and not given_away) or picked_up */
  working: boolean
  open_post_id: Uuid | null
  given_shift_id: Uuid | null
  picked_shift_id: Uuid | null
  /** A SwapMatch leg falls on this day. */
  is_swap: boolean
}

/** One row of get_trade_contact(): the other party's contact details. */
export interface TradeContact {
  user_id: Uuid
  full_name: string
  rank: Rank | null
  station: number | null
  phone: string | null
  email: string
}

/** member_card() — no contact details. */
export interface MemberCard {
  full_name: string
  rank: Rank | null
  station: number | null
  battalion: number | null
  trust_score: number
  covered: number
  given: number
}

export interface EligibilityReason {
  code: ErrorHint
  message: string
}

/** shift_eligibility() */
export interface Eligibility {
  eligible: boolean
  /** Every failing rule, in the order request_shift checks them. */
  reasons: EligibilityReason[]
  /**
   * For a SwapMatch: the offered return dates that would work for me (all of
   * them checked when no return date was passed). Empty otherwise.
   */
  valid_return_dates: Ymd[]
}

/** confirm_request() */
export interface ConfirmResult {
  shift_id: Uuid
  /** The SwapMatch return leg created, if the request carried a return date. */
  return_leg_id: Uuid | null
}

/** One element of admin_import_roster(p_rows). station/tour may be text. */
export interface RosterImportRow {
  first_name: string
  last_name: string
  employee_id?: string | null
  rank?: string | null
  station?: number | string | null
  tour?: number | string | null
  email?: string | null
  phone?: string | null
}

/** admin_import_roster() */
export interface ImportRosterResult {
  inserted: number
  updated: number
  /** Rows identical to an existing entry, or repeated within the import. */
  skipped: number
  /** Unclaimed rows deleted first (p_replace). */
  deleted: number
  /** `row` is 1-based within p_rows. */
  errors: { row: number; message: string }[]
}

/** admin_overview() */
export interface AdminOverview {
  pending_members: number
  approved_members: number
  suspended_members: number
  /** Open posts that haven't started. */
  open_shifts: number
  /** Original legs confirmed since the 1st of this month (Pacific), still covered. */
  trades_this_month: number
  roster_size: number
  roster_unclaimed: number
}

/** app_keepalive() */
export interface KeepaliveResult {
  ok: boolean
}

/** One row of calendar_feed(). */
export interface CalendarFeedRow {
  date: Ymd
  kind: CalendarFeedKind
  title: string
  details: string
}

/** One row of claim_push_batch() (service role only). */
export interface PushBatchRow {
  notification_id: Uuid
  user_id: Uuid
  title: string
  body: string
  url: string
}

// ---------------------------------------------------------------------------
// RPC catalogue: exact argument names and return types of every public
// function the app calls (0010_privileges.sql lists who may call each).
// ---------------------------------------------------------------------------

type NoArgs = Record<string, never>

export interface RpcFunctions {
  // Onboarding & profile
  complete_onboarding: {
    args: {
      p_full_name: string
      p_phone: string
      p_rank: Rank
      p_station: number
      p_tour: number | null
      p_employee_id: string | null
    }
    returns: OnboardingResult
  }
  acknowledge_telestaff: { args: NoArgs; returns: null }
  update_my_profile: {
    args: { p_phone: string; p_station: number; p_tour: number | null; p_notify_scope: NotifyScope }
    returns: null
  }
  clear_must_change_password: { args: NoArgs; returns: null }
  regenerate_calendar_token: { args: NoArgs; returns: Uuid }
  my_stats: { args: NoArgs; returns: MyStats }
  my_ledger: { args: NoArgs; returns: LedgerRow[] }
  my_schedule: { args: { p_from: Ymd; p_to: Ymd }; returns: ScheduleRow[] }
  get_trade_contact: { args: { p_shift_id: Uuid }; returns: TradeContact[] }
  member_card: { args: { p_user_id: Uuid }; returns: MemberCard }

  // Shifts & trades
  post_shift: {
    args: {
      p_date: Ymd
      p_shift_type: ShiftType
      /** null = my own station */
      p_station: number | null
      p_return_dates: Ymd[] | null
      /** null = 'anyone' */
      p_accept_limit: AcceptLimit | null
      p_notes: string | null
    }
    returns: Uuid
  }
  cancel_post: { args: { p_shift_id: Uuid }; returns: null }
  shift_eligibility: { args: { p_shift_id: Uuid; p_return_date: Ymd | null }; returns: Eligibility }
  request_shift: {
    args: { p_shift_id: Uuid; p_return_date: Ymd | null; p_message: string | null }
    returns: Uuid
  }
  withdraw_request: { args: { p_request_id: Uuid }; returns: null }
  decline_request: { args: { p_request_id: Uuid }; returns: null }
  confirm_request: { args: { p_request_id: Uuid }; returns: ConfirmResult }
  request_trade_cancel: { args: { p_shift_id: Uuid; p_reason: string | null }; returns: null }
  respond_trade_cancel: { args: { p_shift_id: Uuid; p_agree: boolean }; returns: null }
  withdraw_trade_cancel: { args: { p_shift_id: Uuid }; returns: null }

  // Messages & notifications
  send_message: { args: { p_shift_id: Uuid; p_recipient_id: Uuid; p_body: string }; returns: Uuid }
  mark_thread_read: { args: { p_shift_id: Uuid; p_other_id: Uuid }; returns: null }
  /** p_ids null ⇒ all of mine */
  mark_notifications_read: { args: { p_ids: Uuid[] | null }; returns: null }

  // Admin
  admin_approve_member: { args: { p_user_id: Uuid; p_roster_id: Uuid | null }; returns: null }
  admin_reject_member: { args: { p_user_id: Uuid; p_reason: string | null }; returns: null }
  admin_set_member_status: {
    args: { p_user_id: Uuid; p_status: 'approved' | 'suspended'; p_reason: string | null }
    returns: null
  }
  admin_set_role: { args: { p_user_id: Uuid; p_role: Role }; returns: null }
  admin_update_member: {
    args: {
      p_user_id: Uuid
      p_full_name: string
      p_rank: Rank
      p_station: number
      p_tour: number | null
      p_phone: string
      p_employee_id: string | null
    }
    returns: null
  }
  admin_mark_must_change_password: { args: { p_user_id: Uuid }; returns: null }
  admin_import_roster: { args: { p_rows: RosterImportRow[]; p_replace: boolean }; returns: ImportRosterResult }
  admin_delete_roster_entry: { args: { p_id: Uuid }; returns: null }
  admin_cancel_post: { args: { p_shift_id: Uuid; p_reason: string | null }; returns: null }
  admin_void_trade: { args: { p_shift_id: Uuid; p_reason: string | null }; returns: null }
  admin_overview: { args: NoArgs; returns: AdminOverview }

  // Public (anon) and server-only (service role)
  app_keepalive: { args: NoArgs; returns: KeepaliveResult }
  calendar_feed: { args: { p_token: Uuid }; returns: CalendarFeedRow[] }
  claim_push_batch: { args: { p_limit: number }; returns: PushBatchRow[] }
  signup_rate_check: {
    args: { p_ip_hash: string; p_max: number; p_window_minutes: number }
    returns: boolean
  }
}

export type RpcName = keyof RpcFunctions
export type RpcArgs<F extends RpcName> = RpcFunctions[F]['args']
export type RpcReturns<F extends RpcName> = RpcFunctions[F]['returns']
