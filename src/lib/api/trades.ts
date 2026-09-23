// Confirmed trades: my trade lists, trade detail, trade partner contact and
// the both-must-agree cancel flow (ARCHITECTURE §6.3, §7.2 "Trades").

import type { Shift, ShiftRequest, TradeContact } from '@/lib/types/database'
import {
  assertUuid,
  blankToNull,
  callRpc,
  clampLimit,
  nowIso,
  quoteFilterValue,
  resolveUserId,
  runList,
  type Sb,
} from './core'
import { listRequestsForShift } from './requests'
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
 *   history          started trades and cancelled posts/trades (latest first).
 *                    After an undo the coverer is cleared from the row, so a
 *                    cancelled trade shows in the poster's history only.
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
// Trade detail (/trades/[id])
// ---------------------------------------------------------------------------

export interface TradeDetail {
  /** The original posted shift: holds the requests and the cancel request. */
  shift: Shift
  /** The SwapMatch return leg that belongs to it (or the one asked for), if any. */
  returnLeg: Shift | null
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
  const returnLeg =
    legs.find((s) => s.id === shift.return_leg_id) ?? (viewed.return_leg_of ? viewed : null)
  return { shift, returnLeg, requestedId: viewed.id, requests }
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
