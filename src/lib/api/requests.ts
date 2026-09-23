// Requests on posted shifts: eligibility, request, withdraw, decline, confirm,
// and the request lists on the Trades tab (ARCHITECTURE §6.3, §7.2).

import type { Ymd } from '@/lib/sffd/dates'
import type { ConfirmResult, Eligibility, RequestStatus, Shift, ShiftRequest } from '@/lib/types/database'
import { assertUuid, blankToNull, callRpc, clampLimit, isUuid, resolveUserId, runList, type Sb } from './core'

/** A request together with the shift it's for. */
export interface RequestWithShift extends ShiftRequest {
  shift: Shift
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

/**
 * Could I request this shift (shift_eligibility)? Never fails on rule
 * problems: they come back in `reasons` ({code, message}) for the request
 * sheet. For a SwapMatch without `returnDate`, `valid_return_dates` lists the
 * offered dates that would work for me.
 */
export async function getShiftEligibility(sb: Sb, shiftId: string, returnDate?: Ymd | null): Promise<Eligibility> {
  const result = await callRpc(sb, 'shift_eligibility', { p_shift_id: shiftId, p_return_date: returnDate ?? null })
  return {
    eligible: Boolean(result?.eligible),
    reasons: Array.isArray(result?.reasons) ? result.reasons : [],
    valid_return_dates: Array.isArray(result?.valid_return_dates) ? result.valid_return_dates : [],
  }
}

export interface RequestShiftInput {
  shiftId: string
  /** Required for a SwapMatch: one of the shift's return_dates. */
  returnDate?: Ymd | null
  /** Optional note to the poster, up to 300 characters. */
  message?: string | null
}

/** Asks for a shift (request_shift). Returns the request id; the poster is notified. */
export async function requestShift(sb: Sb, input: RequestShiftInput): Promise<string> {
  return callRpc(
    sb,
    'request_shift',
    { p_shift_id: input.shiftId, p_return_date: input.returnDate ?? null, p_message: blankToNull(input.message) },
    { flush: true },
  )
}

/** Takes back my pending request (withdraw_request). */
export async function withdrawRequest(sb: Sb, requestId: string): Promise<void> {
  await callRpc(sb, 'withdraw_request', { p_request_id: requestId }, { flush: true })
}

/** Poster turns down a pending request (decline_request). */
export async function declineRequest(sb: Sb, requestId: string): Promise<void> {
  await callRpc(sb, 'decline_request', { p_request_id: requestId }, { flush: true })
}

/**
 * Poster accepts one request (confirm_request): the trade is made, every other
 * pending request is declined, and a SwapMatch return leg is created when the
 * request carries a return date.
 */
export async function confirmRequest(sb: Sb, requestId: string): Promise<ConfirmResult> {
  const result = await callRpc(sb, 'confirm_request', { p_request_id: requestId }, { flush: true })
  return { shift_id: result.shift_id, return_leg_id: result.return_leg_id ?? null }
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export interface ListMyRequestsOptions {
  /** My user id if known (skips a session lookup). */
  userId?: string | null
  /** Default: every status. */
  statuses?: readonly RequestStatus[] | null
  /** Only requests on these shifts (e.g. the cards on the current board page). */
  shiftIds?: readonly string[] | null
  /** Default 100, max 500. */
  limit?: number
}

/** Requests I made, newest first, each with its shift. */
export async function listMyRequests(sb: Sb, options: ListMyRequestsOptions = {}): Promise<RequestWithShift[]> {
  const userId = await resolveUserId(sb, options.userId)
  let query = sb.from('shift_requests').select('*, shift:shifts(*)').eq('requester_id', userId)
  if (options.statuses?.length) query = query.in('status', [...options.statuses])
  if (options.shiftIds) {
    const ids = [...new Set(options.shiftIds)].filter(isUuid)
    if (!ids.length) return []
    query = query.in('shift_id', ids)
  }
  const rows = await runList<RequestWithShift>(
    query.order('created_at', { ascending: false }).order('id').limit(clampLimit(options.limit, 100, 500)),
  )
  return rows.filter((r) => r.shift)
}

export interface ListIncomingRequestsOptions {
  userId?: string | null
  /** Default: ['pending']. */
  statuses?: readonly RequestStatus[] | null
  /** Default 100, max 500. */
  limit?: number
}

/**
 * Requests other members made on my posts (default: pending ones), oldest
 * first so the poster sees who asked first; each with its shift.
 */
export async function listIncomingRequests(
  sb: Sb,
  options: ListIncomingRequestsOptions = {},
): Promise<RequestWithShift[]> {
  const userId = await resolveUserId(sb, options.userId)
  const statuses = options.statuses?.length ? [...options.statuses] : ['pending']
  return runList<RequestWithShift>(
    sb
      .from('shift_requests')
      .select('*, shift:shifts!inner(*)')
      .eq('shift.poster_id', userId)
      .in('status', statuses)
      .order('created_at')
      .order('id')
      .limit(clampLimit(options.limit, 100, 500)),
  )
}

/**
 * Requests on one shift, oldest first. The poster sees all of them; anyone
 * else sees only their own (RLS).
 */
export async function listRequestsForShift(
  sb: Sb,
  shiftId: string,
  options: { statuses?: readonly RequestStatus[] | null } = {},
): Promise<ShiftRequest[]> {
  let query = sb.from('shift_requests').select('*').eq('shift_id', assertUuid(shiftId, 'shift'))
  if (options.statuses?.length) query = query.in('status', [...options.statuses])
  return runList<ShiftRequest>(query.order('created_at').order('id'))
}

/**
 * My latest request per shift, keyed by shift id — for "Requested" badges on
 * board cards. Pending requests win over older closed ones.
 */
export function latestRequestByShift<T extends Pick<ShiftRequest, 'shift_id' | 'status' | 'created_at'>>(
  requests: readonly T[],
): Map<string, T> {
  const out = new Map<string, T>()
  for (const r of requests) {
    const current = out.get(r.shift_id)
    if (
      !current ||
      (r.status === 'pending' && current.status !== 'pending') ||
      ((r.status === 'pending') === (current.status === 'pending') &&
        Date.parse(r.created_at) > Date.parse(current.created_at))
    ) {
      out.set(r.shift_id, r)
    }
  }
  return out
}
