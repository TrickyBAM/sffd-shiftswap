// Confirmed trades: my trade lists, trade detail, trade partner contact and
// the both-must-agree cancel flow (ARCHITECTURE §6.3, §7.2 "Trades").

import type { Shift, ShiftRequest, Timestamp, TradeContact } from '@/lib/types/database'
import {
  assertUuid,
  blankToNull,
  callRpc,
  clampLimit,
  isUuid,
  nowIso,
  quoteFilterValue,
  resolveUserId,
  runList,
  type Sb,
} from './core'
import { listRequestsForShift, type RequestWithShift } from './requests'
import { getShift } from './shifts'

// ---------------------------------------------------------------------------
// Lists
// ---------------------------------------------------------------------------

/**
 * Which of my shifts to list:
 *   open             my open posts that haven't started (soonest first)
 *   confirmed        covered shifts I give or work that haven't started, both
 *                    SwapMatch legs as separate rows (soonest first)
 *   cancel_requests  confirmed trades where the other member asked to cancel
 *                    and I need to answer (soonest first)
 *   history          started shifts and cancelled posts/legs I'm still named
 *                    on (latest first). Undoing a trade clears coverer_id, and
 *                    an agreed cancel (or a void before the start) reopens the
 *                    original post, so undone trades are NOT here for either
 *                    member: list them with listUndoneTrades().
 */
export type TradeScope = 'open' | 'confirmed' | 'cancel_requests' | 'history'

export interface ListMyTradesOptions {
  scope: TradeScope
  /** My user id if known (skips a session lookup). */
  userId?: string | null
  /** Default 100 (history: 50), max 500. */
  limit?: number
}

/** My shifts (as poster or coverer) for one Trades tab. */
export async function listMyTrades(sb: Sb, options: ListMyTradesOptions): Promise<Shift[]> {
  const me = await resolveUserId(sb, options.userId)
  const now = nowIso()
  const mine = `poster_id.eq.${me},coverer_id.eq.${me}`
  let query = sb.from('shifts').select('*')

  switch (options.scope) {
    case 'open':
      query = query.eq('poster_id', me).eq('status', 'open').gt('starts_at', now)
      break
    case 'confirmed':
      query = query.or(mine).eq('status', 'covered').gt('starts_at', now)
      break
    case 'cancel_requests':
      query = query
        .or(mine)
        .eq('status', 'covered')
        .gt('starts_at', now)
        .not('cancel_requested_by', 'is', null)
        .neq('cancel_requested_by', me)
      break
    case 'history':
      // Repeated or=(…) parameters are combined with AND by PostgREST.
      query = query.or(mine).or(`starts_at.lte.${quoteFilterValue(now)},status.eq.cancelled`)
      break
  }

  const ascending = options.scope !== 'history'
  return runList<Shift>(
    query
      .order('date', { ascending })
      .order('created_at', { ascending })
      .order('id', { ascending })
      .limit(clampLimit(options.limit, options.scope === 'history' ? 50 : 100, 500)),
  )
}

// ---------------------------------------------------------------------------
// Undone trades (History)
// ---------------------------------------------------------------------------

/** A confirmed trade that was later undone by agreement or voided by an admin. */
export interface UndoneTrade {
  /** The request that had been confirmed (its requester was going to work the shift). */
  request: ShiftRequest
  /** The original post as it is now: open again, traded again, or cancelled. */
  shift: Shift
  /** The SwapMatch return leg that was cancelled with the trade, if there was one. */
  returnLeg: Shift | null
  /** My side: 'poster' = it was my shift; 'coverer' = I was going to work it. */
  role: 'poster' | 'coverer'
  partnerId: string
  partnerName: string
  /** When the trade was undone. */
  undoneAt: Timestamp
  /**
   * 'agreed' = both members agreed to cancel; 'voided' = an admin voided it;
   * null when the records don't say (an undo before the start reopens the post
   * and leaves no note on it).
   */
  how: 'agreed' | 'voided' | null
  /** The admin's reason for a void, when one was recorded. */
  note: string | null
}

/** Notes private.undo_trade() stores: agreed cancels, and voids without a reason. */
const AGREED_NOTE = 'Cancelled by agreement'
const DEFAULT_VOID_NOTE = 'Voided by an admin'

function sameInstant(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false
  const x = Date.parse(a)
  return Number.isFinite(x) && x === Date.parse(b)
}

/**
 * Picks the undone trades out of cancelled requests (pure; exported for tests).
 *
 * shift_requests has no "was accepted" column, so a cancelled request is told
 * apart from one closed while still pending by what happened to its shift in
 * the same transaction (they share the same now()):
 *   - its SwapMatch return leg was cancelled at that moment: undone trade
 *   - the post itself was cancelled at that moment: an undone trade when the
 *     coverer's name was kept (an admin void after the start); otherwise the
 *     post was cancelled while the request was pending, so skipped
 *   - a SwapMatch request without such a cancelled leg was never confirmed: skipped
 *   - the post is open but wasn't touched at that moment and nothing happened
 *     on it later: closed while pending (the requester was suspended), skipped
 *   - otherwise the post was reopened then (and maybe traded or cancelled
 *     since): undone trade
 */
export function undoneTradesFrom(
  requests: readonly RequestWithShift[],
  cancelledLegs: readonly Shift[],
  me: string,
): UndoneTrade[] {
  const out = new Map<string, UndoneTrade>()
  for (const request of requests) {
    const shift = request.shift
    const at = request.decided_at
    if (request.status !== 'cancelled' || !shift || !at || shift.return_leg_of || out.has(request.id)) continue
    const role = shift.poster_id === me ? 'poster' : request.requester_id === me ? 'coverer' : null
    if (!role) continue

    const leg =
      cancelledLegs.find(
        (l) =>
          l.return_leg_of === shift.id &&
          l.poster_id === request.requester_id &&
          l.status === 'cancelled' &&
          sameInstant(l.cancelled_at, at),
      ) ?? null

    let note: string | null = null
    if (leg) {
      note = leg.cancel_note?.trim() || null
    } else if (shift.status === 'cancelled' && sameInstant(shift.cancelled_at, at)) {
      // An original is cancelled together with its request only when an admin
      // voids it after the start (the coverer's name is kept for history) or
      // when the post is cancelled while the request is pending (no coverer).
      if (!shift.coverer_name) continue
      note = shift.cancel_note?.trim() || DEFAULT_VOID_NOTE
    } else if (request.return_date) {
      continue
    } else if (shift.status === 'open' && !sameInstant(shift.updated_at, at)) {
      const laterActivity = requests.some(
        (r) =>
          r.id !== request.id &&
          r.shift_id === shift.id &&
          r.status === 'cancelled' &&
          Boolean(r.decided_at) &&
          Date.parse(r.decided_at as string) > Date.parse(at),
      )
      if (!laterActivity) continue
    }

    const how: UndoneTrade['how'] = note === AGREED_NOTE ? 'agreed' : note ? 'voided' : null
    out.set(request.id, {
      request: withoutShift(request),
      shift,
      returnLeg: leg,
      role,
      partnerId: role === 'poster' ? request.requester_id : shift.poster_id,
      partnerName: (role === 'poster' ? request.requester_name : shift.poster_name) || 'Another member',
      undoneAt: at,
      how,
      note: how === 'voided' && note !== DEFAULT_VOID_NOTE ? note : null,
    })
  }
  return [...out.values()].sort((a, b) => Date.parse(b.undoneAt) - Date.parse(a.undoneAt))
}

function withoutShift(request: RequestWithShift): ShiftRequest {
  const { shift: _shift, ...rest } = request
  void _shift
  return rest
}

export interface ListUndoneTradesOptions {
  /** My user id if known (skips a session lookup). */
  userId?: string | null
  /** Cancelled requests to look at on each side (default 100, max 500). */
  limit?: number
}

/**
 * Confirmed trades that were undone (agreed cancel or admin void) for both
 * members: on my posts and on shifts I was going to work, newest first. The
 * History tab needs these because an undo reopens or cancels the post and
 * clears its coverer, so listMyTrades('history') can't show them.
 */
export async function listUndoneTrades(sb: Sb, options: ListUndoneTradesOptions = {}): Promise<UndoneTrade[]> {
  const me = await resolveUserId(sb, options.userId)
  const limit = clampLimit(options.limit, 100, 500)
  const [onMyPosts, mine] = await Promise.all([
    runList<RequestWithShift>(
      sb
        .from('shift_requests')
        .select('*, shift:shifts!inner(*)')
        .eq('shift.poster_id', me)
        .eq('status', 'cancelled')
        .not('decided_at', 'is', null)
        .order('decided_at', { ascending: false })
        .order('id')
        .limit(limit),
    ),
    runList<RequestWithShift>(
      sb
        .from('shift_requests')
        .select('*, shift:shifts(*)')
        .eq('requester_id', me)
        .eq('status', 'cancelled')
        .not('decided_at', 'is', null)
        .order('decided_at', { ascending: false })
        .order('id')
        .limit(limit),
    ),
  ])
  const requests = [...onMyPosts, ...mine].filter((r) => r.shift)
  if (!requests.length) return []
  const shiftIds = [...new Set(requests.map((r) => r.shift_id))].filter(isUuid)
  const legs = shiftIds.length
    ? await runList<Shift>(sb.from('shifts').select('*').in('return_leg_of', shiftIds).eq('status', 'cancelled'))
    : []
  return undoneTradesFrom(requests, legs, me)
}

// ---------------------------------------------------------------------------
// Trade detail (/trades/[id])
// ---------------------------------------------------------------------------

export interface TradeDetail {
  /** The original posted shift: holds the requests and the cancel request. */
  shift: Shift
  /**
   * The SwapMatch return leg: the one asked for when the id is a return leg
   * (even an old, cancelled one), otherwise the original's current leg, if any.
   */
  returnLeg: Shift | null
  /**
   * False when `returnLeg` is a leg of a trade that was undone: the original
   * has been reopened (and maybe traded again) since, so describe that leg on
   * its own, not the post's current trade. getTrade() always sets it; absent
   * (hand-built details) means true.
   */
  returnLegIsCurrent?: boolean
  /** The shift id that was looked up (either leg). */
  requestedId: string
  /** Requests on the original: all of them for its poster, only my own otherwise. */
  requests: ShiftRequest[]
}

/**
 * A shift or trade by either leg's id, with its other leg and its requests.
 * Null when it doesn't exist or isn't visible to me.
 */
export async function getTrade(sb: Sb, shiftId: string): Promise<TradeDetail | null> {
  const viewed = await getShift(sb, shiftId)
  if (!viewed) return null
  const originalId = viewed.return_leg_of ?? viewed.id

  const [legs, requests] = await Promise.all([
    runList<Shift>(sb.from('shifts').select('*').or(`id.eq.${originalId},return_leg_of.eq.${originalId}`)),
    listRequestsForShift(sb, originalId),
  ])
  const shift = legs.find((s) => s.id === originalId) ?? viewed
  // A return leg in the URL is always the leg shown: after an undo the
  // original can be confirmed again with a different return leg, and that
  // newer trade isn't what this link is about.
  const returnLeg = viewed.return_leg_of
    ? (legs.find((s) => s.id === viewed.id) ?? viewed)
    : shift.return_leg_id
      ? (legs.find((s) => s.id === shift.return_leg_id) ?? null)
      : null
  const returnLegIsCurrent = returnLeg !== null && shift.return_leg_id === returnLeg.id
  return { shift, returnLeg, returnLegIsCurrent, requestedId: viewed.id, requests }
}

// ---------------------------------------------------------------------------
// Contact & cancel flow
// ---------------------------------------------------------------------------

/**
 * The other party's contact details for a shift (get_trade_contact): for the
 * poster, the coverer and every pending/accepted requester; for a requester or
 * the coverer, the poster. Empty for anyone else.
 */
export async function getTradeContacts(sb: Sb, shiftId: string): Promise<TradeContact[]> {
  const rows = await callRpc(sb, 'get_trade_contact', { p_shift_id: assertUuid(shiftId, 'shift') })
  return Array.isArray(rows) ? rows : []
}

/**
 * Asks the other member to undo a confirmed, not-started trade
 * (request_trade_cancel). Either leg's id works. The other member is notified.
 */
export async function requestTradeCancel(sb: Sb, shiftId: string, reason?: string | null): Promise<void> {
  await callRpc(sb, 'request_trade_cancel', { p_shift_id: shiftId, p_reason: blankToNull(reason) }, { flush: true })
}

/**
 * Answers the other member's cancel request (respond_trade_cancel). Agreeing
 * undoes the trade (the post reopens, a return leg is cancelled); declining
 * keeps it. Both members are notified.
 */
export async function respondTradeCancel(sb: Sb, shiftId: string, agree: boolean): Promise<void> {
  await callRpc(sb, 'respond_trade_cancel', { p_shift_id: shiftId, p_agree: agree }, { flush: true })
}

/** Takes back my own cancel request (withdraw_trade_cancel). */
export async function withdrawTradeCancel(sb: Sb, shiftId: string): Promise<void> {
  await callRpc(sb, 'withdraw_trade_cancel', { p_shift_id: shiftId })
}
