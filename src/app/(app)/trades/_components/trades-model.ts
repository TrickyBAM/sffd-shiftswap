// Pure helpers for the Trades hub (/trades): tab parsing, grouping requests by
// shift, pairing SwapMatch legs, history rows and balance lines — all worded
// from the signed-in member's point of view. No I/O, so it is unit-tested
// (tests/unit/trades-model.test.ts).
//
// Words and colours (UX-11), the same on every screen:
//   Covered     shifts you worked for someone
//   Given       shifts someone worked for you
//   Balance     Covered − Given: ahead green, behind yellow (BALANCE_TONE)
//   Outstanding your open posts
//   Confirmed   a trade that's on (green); my open post is orange

import type { RequestWithShift, UndoneTrade } from '@/lib/api'
import { plural } from '@/lib/format'
import { formatDate, type Ymd } from '@/lib/sffd/dates'
import { stationLabel } from '@/lib/sffd/stations'
import type { LedgerRow, MyStats, Shift, ShiftRequest } from '@/lib/types/database'

// ---------------------------------------------------------------------------
// Tabs
// ---------------------------------------------------------------------------

export const TRADE_TABS = ['pending', 'confirmed', 'history', 'balances'] as const
export type TradeTab = (typeof TRADE_TABS)[number]

export const TRADE_TAB_LABELS: Record<TradeTab, string> = {
  pending: 'Pending',
  confirmed: 'Confirmed',
  history: 'History',
  balances: 'Balances',
}

/** The tab named in `?tab=`, or 'pending' for anything else. */
export function parseTradeTab(value: string | null | undefined): TradeTab {
  return (TRADE_TABS as readonly string[]).includes(value ?? '') ? (value as TradeTab) : 'pending'
}

// ---------------------------------------------------------------------------
// Everything the hub shows (also the offline snapshot)
// ---------------------------------------------------------------------------

export interface TradesData {
  /** Pending requests other members made on my posts, oldest first. */
  incoming: RequestWithShift[]
  /** Confirmed trades where the other member asked to cancel and I must answer. */
  cancelRequests: Shift[]
  /** My own pending requests, newest first. */
  myRequests: RequestWithShift[]
  /** My open posts that haven't started. */
  openPosts: Shift[]
  /** Covered, not-started shifts I give or work (each SwapMatch leg is its own row). */
  confirmed: Shift[]
  /** Started trades and cancelled posts/trades, latest first. */
  historyShifts: Shift[]
  /** My declined / withdrawn / cancelled requests, newest first. */
  closedRequests: RequestWithShift[]
  /**
   * Confirmed trades that were undone by agreement or voided (either side),
   * newest first. Missing in offline snapshots saved before it was added.
   */
  undone?: UndoneTrade[]
  ledger: LedgerRow[]
  stats: MyStats
  /** ISO time the data was loaded. */
  loadedAt: string
}

// ---------------------------------------------------------------------------
// Small shared bits
// ---------------------------------------------------------------------------

/** True once the shift has started (starts_at <= now). */
export function hasStarted(shift: Pick<Shift, 'starts_at'>, nowMs: number): boolean {
  const t = Date.parse(shift.starts_at)
  return Number.isFinite(t) && t <= nowMs
}

/** "Wed, Sep 30 · 24-Hour · Station 19" */
export function shiftLine(shift: Pick<Shift, 'date' | 'shift_type' | 'station'>): string {
  return `${formatDate(shift.date, 'weekday')} · ${shift.shift_type} · ${stationLabel(shift.station)}`
}

/** True for either leg of a SwapMatch or an original that offers return dates. */
export function isSwapShift(shift: Pick<Shift, 'return_leg_of' | 'return_leg_id'>): boolean {
  return Boolean(shift.return_leg_of || shift.return_leg_id)
}

/** The other member on a shift I post or cover. */
export function partnerOf(shift: Shift, me: string): { id: string | null; name: string } {
  if (shift.coverer_id === me) return { id: shift.poster_id, name: shift.poster_name }
  return { id: shift.coverer_id, name: shift.coverer_name ?? 'Another member' }
}

/**
 * Who works for whom, from my point of view:
 *   upcoming: "You're working for Ana Cruz" / "Mike Lee is working for you"
 *   past:     "You worked for Ana Cruz"     / "Mike Lee worked for you"
 */
export function perspectiveLabel(shift: Shift, me: string, when: 'upcoming' | 'past' = 'upcoming'): string {
  if (shift.coverer_id === me) {
    return when === 'past' ? `You worked for ${shift.poster_name}` : `You're working for ${shift.poster_name}`
  }
  const name = shift.coverer_name ?? 'Another member'
  return when === 'past' ? `${name} worked for you` : `${name} is working for you`
}

/** "Ana Cruz" / "Ana Cruz and Mike Lee" / "Ana Cruz, Mike Lee and 2 more" */
export function namesPreview(names: readonly string[], max = 2): string {
  const unique = [...new Set(names.filter(Boolean))]
  if (unique.length === 0) return ''
  if (unique.length === 1) return unique[0]
  if (unique.length <= max) return `${unique.slice(0, -1).join(', ')} and ${unique[unique.length - 1]}`
  return `${unique.slice(0, max).join(', ')} and ${unique.length - max} more`
}

// ---------------------------------------------------------------------------
// Pending tab
// ---------------------------------------------------------------------------

export interface IncomingGroup {
  shift: Shift
  /** Pending requests on it, oldest first (who asked first). */
  requests: ShiftRequest[]
}

/**
 * Pending requests on my posts grouped by shift — only posts that are still
 * open and haven't started (those can still be confirmed) — soonest first.
 */
export function groupIncoming(incoming: readonly RequestWithShift[], nowMs: number): IncomingGroup[] {
  const groups = new Map<string, IncomingGroup>()
  for (const row of incoming) {
    const { shift, ...request } = row
    if (!shift || request.status !== 'pending') continue
    if (shift.status !== 'open' || hasStarted(shift, nowMs)) continue
    const group = groups.get(shift.id)
    if (group) group.requests.push(request)
    else groups.set(shift.id, { shift, requests: [request] })
  }
  const list = [...groups.values()]
  for (const g of list) g.requests.sort((a, b) => a.created_at.localeCompare(b.created_at))
  return list.sort(byShiftDate)
}

/** Pending request counts per shift id (for "Your open posts"). */
export function requestCounts(incoming: readonly RequestWithShift[]): Map<string, number> {
  const counts = new Map<string, number>()
  for (const r of incoming) {
    if (r.status === 'pending') counts.set(r.shift_id, (counts.get(r.shift_id) ?? 0) + 1)
  }
  return counts
}

/** "3 requests — choose one" / "1 request — take a look" */
export function chooseCta(count: number): string {
  return count === 1 ? '1 request — take a look' : `${count} requests — choose one`
}

/** My pending requests whose shift can still be confirmed, soonest first. */
export function activeRequests(myRequests: readonly RequestWithShift[], nowMs: number): RequestWithShift[] {
  return myRequests
    .filter((r) => r.status === 'pending' && r.shift && r.shift.status === 'open' && !hasStarted(r.shift, nowMs))
    .sort(byShiftDate)
}

/**
 * The SwapMatch part of my own request, from my side (UX-01): the poster
 * works MY shift on the return date, and I'm off that day. Same wording as
 * the request sheet and the trade page.
 */
export function myReturnDateLine(posterName: string, returnDate: Ymd): string {
  return `In return, ${posterName || 'the poster'} works your ${formatDate(returnDate, 'weekday')} shift.`
}

/**
 * Cancel requests I can still answer (TF-5): the trade's dates haven't
 * started. Only the original leg carries the request and the cancel_requests
 * list checks only its start, so a SwapMatch whose return leg has started is
 * dropped here: its return leg is no longer among my upcoming `confirmed`
 * legs. Agreeing would be refused then; the request shows as expired on the
 * Confirmed tab instead.
 */
export function openCancelRequests(
  cancelRequests: readonly Shift[],
  confirmed: readonly Shift[],
  nowMs: number,
): Shift[] {
  const upcoming = new Map(confirmed.map((s) => [s.id, s]))
  return cancelRequests.filter((shift) => {
    if (hasStarted(shift, nowMs)) return false
    if (!shift.return_leg_id) return true
    const leg = upcoming.get(shift.return_leg_id)
    return Boolean(leg && leg.status === 'covered' && !hasStarted(leg, nowMs))
  })
}

/** Number of things on the Pending tab that need my answer. */
export function pendingActionCount(groups: readonly IncomingGroup[], cancelRequests: readonly Shift[]): number {
  return groups.length + cancelRequests.length
}

// ---------------------------------------------------------------------------
// Confirmed tab
// ---------------------------------------------------------------------------

export interface TradeGroup {
  /** The original leg's id (links to /trades/<id>; either leg's id works there). */
  id: string
  /** The legs present in the list, soonest first (one, or two for a SwapMatch). */
  legs: Shift[]
  isSwap: boolean
  /** The other member in the trade. */
  partnerName: string
  /** Who asked to cancel, if anyone (stored on the original leg). */
  cancelRequestedBy: string | null
  /**
   * One of the trade's dates has already started: a SwapMatch whose other leg
   * isn't upcoming any more (or any leg started by `nowMs`). Members can't
   * cancel it then, so a waiting cancel request has expired (TF-5).
   */
  started: boolean
  /** Earliest leg date. */
  date: Ymd
}

/**
 * Pairs SwapMatch legs (original + return leg) into one trade; ordinary trades
 * are one leg each. Soonest first. `shifts` are my upcoming covered legs, so a
 * SwapMatch with a leg missing has a leg that already started.
 */
export function groupTrades(shifts: readonly Shift[], me: string, nowMs?: number): TradeGroup[] {
  const byId = new Map<string, Shift[]>()
  for (const s of shifts) {
    const key = s.return_leg_of ?? s.id
    const legs = byId.get(key)
    if (legs) {
      if (!legs.some((l) => l.id === s.id)) legs.push(s)
    } else {
      byId.set(key, [s])
    }
  }
  const groups: TradeGroup[] = []
  for (const [id, legs] of byId) {
    legs.sort(byShiftDate)
    const original = legs.find((l) => l.id === id)
    const legMissing = !original || Boolean(original.return_leg_id && !legs.some((l) => l.id === original.return_leg_id))
    groups.push({
      id,
      legs,
      isSwap: legs.some(isSwapShift),
      partnerName: partnerOf(original ?? legs[0], me).name,
      cancelRequestedBy: legs.find((l) => l.cancel_requested_by)?.cancel_requested_by ?? null,
      started: legMissing || (nowMs !== undefined && legs.some((l) => hasStarted(l, nowMs))),
      date: legs[0].date,
    })
  }
  return groups.sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id))
}

export interface CancelInfo {
  /** Short badge text. */
  badge: string
  tone: 'yellow' | 'gray'
  /** One plain sentence under the badges. */
  text: string
  /** I asked and it can no longer be answered: offer "Withdraw" here (TF-5). */
  canWithdraw: boolean
}

/** A waiting cancel request on a trade, from my side (null when there is none). */
export function cancelInfo(
  trade: Pick<TradeGroup, 'cancelRequestedBy' | 'started' | 'partnerName'>,
  me: string,
): CancelInfo | null {
  const { cancelRequestedBy: by, started, partnerName } = trade
  if (!by) return null
  const mine = by === me
  if (started) {
    return {
      badge: 'Cancel request expired',
      tone: 'gray',
      text: mine
        ? "A date in this trade has started, so it can't be cancelled in the app now. Withdraw your request, and ask an admin if the trade needs to be voided."
        : `${partnerName} asked to cancel, but a date in this trade has started, so it can't be cancelled in the app now. You don't need to answer.`,
      canWithdraw: mine,
    }
  }
  return mine
    ? { badge: 'Cancel requested', tone: 'yellow', text: `You asked to cancel. Waiting on ${partnerName}.`, canWithdraw: false }
    : {
        badge: 'Needs your answer',
        tone: 'yellow',
        text: `${partnerName} asked to cancel. Open the trade to agree or decline.`,
        canWithdraw: false,
      }
}

// ---------------------------------------------------------------------------
// History tab
// ---------------------------------------------------------------------------

export type HistoryTone = 'done' | 'cancelled' | 'expired' | 'declined' | 'withdrawn'

export interface HistoryItem {
  key: string
  /** Where the row links (/trades/<shiftId>). */
  shiftId: string
  date: Ymd
  shiftType: string
  station: number
  title: string
  /** Extra line (reason, whose shift, …) or ''. */
  detail: string
  tone: HistoryTone
  /** Short badge text. */
  badge: string
  isSwap: boolean
  /** Sort tiebreaker (ISO time). */
  at: string
}

function shiftHistoryItem(shift: Shift, me: string): HistoryItem {
  const base = {
    key: `shift:${shift.id}`,
    shiftId: shift.id,
    date: shift.date,
    shiftType: shift.shift_type,
    station: shift.station,
    isSwap: isSwapShift(shift),
    at: shift.updated_at ?? shift.created_at,
  }
  if (shift.status === 'covered') {
    return { ...base, title: perspectiveLabel(shift, me, 'past'), detail: '', tone: 'done', badge: 'Done' }
  }
  if (shift.status === 'cancelled') {
    const byAdmin = Boolean(shift.cancelled_by && shift.cancelled_by !== me && shift.poster_id === me && !shift.coverer_name)
    const partner = shift.coverer_name
    const title = partner
      ? `Trade with ${partner} was cancelled`
      : byAdmin
        ? 'Your post was cancelled by an admin'
        : 'You cancelled this post'
    return { ...base, title, detail: shift.cancel_note?.trim() ?? '', tone: 'cancelled', badge: 'Cancelled' }
  }
  // Still open when it started: nobody picked it up.
  return { ...base, title: 'Nobody picked this up in time', detail: '', tone: 'expired', badge: 'Expired' }
}

function requestHistoryItem(request: RequestWithShift): HistoryItem {
  const { shift } = request
  const whose = `${shift.poster_name}'s shift`
  const base = {
    key: `request:${request.id}`,
    shiftId: shift.id,
    date: shift.date,
    shiftType: shift.shift_type,
    station: shift.station,
    isSwap: Boolean(request.return_date),
    at: request.decided_at ?? request.created_at,
  }
  switch (request.status) {
    case 'declined':
      return { ...base, title: "Your request wasn't chosen", detail: whose, tone: 'declined', badge: 'Not chosen' }
    case 'withdrawn':
      return { ...base, title: 'You withdrew your request', detail: whose, tone: 'withdrawn', badge: 'Withdrawn' }
    case 'cancelled':
      return {
        ...base,
        title: 'Request closed — the post or trade was cancelled',
        detail: whose,
        tone: 'cancelled',
        badge: 'Cancelled',
      }
    default:
      // A pending request whose shift started (or closed) without an answer.
      return { ...base, title: 'No answer before the shift started', detail: whose, tone: 'expired', badge: 'Expired' }
  }
}

function sameInstant(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false
  const t = Date.parse(a)
  return Number.isFinite(t) && t === Date.parse(b)
}

/**
 * A confirmed trade that was undone (TF-4), from my side, e.g.
 *   title  "Trade with Ana Cruz was cancelled by agreement"
 *   detail "Ana Cruz was going to work your shift. You were going to work Ana
 *           Cruz's Mon, Oct 12 shift in return; that's cancelled too."
 */
export function undoneHistoryItem(undone: UndoneTrade): HistoryItem {
  const { shift, returnLeg, role, partnerName: partner, how, note } = undone
  const title =
    how === 'agreed'
      ? `Trade with ${partner} was cancelled by agreement`
      : how === 'voided'
        ? `An admin voided your trade with ${partner}`
        : `Trade with ${partner} was cancelled`
  const parts = [role === 'poster' ? `${partner} was going to work your shift.` : `You were going to work ${partner}'s shift.`]
  if (returnLeg) {
    const day = formatDate(returnLeg.date, 'weekday')
    parts.push(
      role === 'poster'
        ? `You were going to work ${partner}'s ${day} shift in return; that's cancelled too.`
        : `${partner} was going to work your ${day} shift in return; that's cancelled too.`,
    )
  }
  if (note) parts.push(`Reason: “${note}”`)
  return {
    key: `undone:${undone.request.id}`,
    shiftId: shift.id,
    date: shift.date,
    shiftType: shift.shift_type,
    station: shift.station,
    title,
    detail: parts.join(' '),
    tone: 'cancelled',
    badge: how === 'voided' ? 'Voided' : 'Cancelled',
    isSwap: Boolean(returnLeg || undone.request.return_date),
    at: undone.undoneAt,
  }
}

/**
 * The History tab: my started/cancelled shifts, trades that were undone, and
 * my closed requests (and pending ones that can no longer be answered),
 * latest date first. An undone trade is one row for each member (TF-4): the
 * request it closed, its cancelled return leg and (for a void after the
 * start) the cancelled original aren't listed again on their own.
 */
export function buildHistory(
  historyShifts: readonly Shift[],
  closedRequests: readonly RequestWithShift[],
  myRequests: readonly RequestWithShift[],
  me: string,
  nowMs: number,
  undone: readonly UndoneTrade[] = [],
): HistoryItem[] {
  const coveredRequests = new Set(undone.map((u) => u.request.id))
  const coveredShifts = new Set<string>()
  for (const u of undone) {
    if (u.returnLeg) coveredShifts.add(u.returnLeg.id)
    if (u.shift.status === 'cancelled' && sameInstant(u.shift.cancelled_at, u.undoneAt)) coveredShifts.add(u.shift.id)
  }

  const items: HistoryItem[] = historyShifts.filter((s) => !coveredShifts.has(s.id)).map((s) => shiftHistoryItem(s, me))
  const seenUndone = new Set<string>()
  for (const u of undone) {
    if (seenUndone.has(u.request.id)) continue
    seenUndone.add(u.request.id)
    items.push(undoneHistoryItem(u))
  }
  const seen = new Set<string>()
  const stale = myRequests.filter(
    (r) => r.status === 'pending' && r.shift && (r.shift.status !== 'open' || hasStarted(r.shift, nowMs)),
  )
  for (const r of [...closedRequests, ...stale]) {
    if (!r.shift || seen.has(r.id) || coveredRequests.has(r.id)) continue
    seen.add(r.id)
    items.push(requestHistoryItem(r))
  }
  return items.sort((a, b) => b.date.localeCompare(a.date) || b.at.localeCompare(a.at) || a.key.localeCompare(b.key))
}

// ---------------------------------------------------------------------------
// Balances tab
// ---------------------------------------------------------------------------

export type BalanceDirection = 'owed' | 'owe' | 'even'

export interface BalanceLine {
  direction: BalanceDirection
  text: string
}

/**
 * "Mike Lee owes you 1 × 24-Hour", "You owe Ana Cruz 1 × PM" (one line per
 * shift type with a non-zero net), or a single "Even".
 */
export function balanceLines(row: LedgerRow): BalanceLine[] {
  const name = row.partner_name || 'This member'
  const lines: BalanceLine[] = []
  for (const [net, label] of [
    [row.net_24, '24-Hour'],
    [row.net_pm, 'PM'],
  ] as const) {
    if (net > 0) lines.push({ direction: 'owed', text: `${name} owes you ${net} × ${label}` })
    else if (net < 0) lines.push({ direction: 'owe', text: `You owe ${name} ${-net} × ${label}` })
  }
  return lines.length ? lines : [{ direction: 'even', text: 'Even' }]
}

/** Partners with something owed either way first, then the most recent trade partner. */
export function sortLedger(rows: readonly LedgerRow[]): LedgerRow[] {
  const settled = (r: LedgerRow) => (r.net_24 === 0 && r.net_pm === 0 ? 1 : 0)
  return [...rows].sort(
    (a, b) =>
      settled(a) - settled(b) ||
      (b.last_date ?? '').localeCompare(a.last_date ?? '') ||
      a.partner_name.localeCompare(b.partner_name),
  )
}

/** "+2", "0", "−1" — a signed balance with a real minus sign. */
export function signed(n: number): string {
  if (n > 0) return `+${n}`
  if (n < 0) return `−${Math.abs(n)}`
  return '0'
}

/** One-sentence summary of my overall balance (same words as Profile). */
export function balanceSummary(stats: Pick<MyStats, 'covered' | 'given'>): string {
  const net = stats.covered - stats.given
  if (stats.covered === 0 && stats.given === 0) return 'No trades yet.'
  if (net > 0) return `You've covered ${plural(net, 'more shift')} than you've given.`
  if (net < 0) return `You've given ${plural(-net, 'more shift')} than you've covered.`
  return "You're even: you've covered as many shifts as you've given."
}

/**
 * The one colour map for balances (UX-11), used by Trades ▸ Balances and the
 * Profile stats: ahead (Covered > Given) green, behind yellow, even plain.
 * Orange is left for "my open post", as on the Calendar legend.
 */
export const BALANCE_TONE = {
  ahead: { text: 'text-accent-green', bg: 'bg-accent-green' },
  behind: { text: 'text-accent-yellow', bg: 'bg-accent-yellow' },
  even: { text: 'text-fg', bg: 'bg-raised' },
} as const

/** Text colour class for a balance (Covered − Given). */
export function balanceToneClass(balance: number): string {
  if (balance > 0) return BALANCE_TONE.ahead.text
  if (balance < 0) return BALANCE_TONE.behind.text
  return BALANCE_TONE.even.text
}

/** The most recent trade with a partner among the loaded shifts, for a "last trade" link. */
export function latestTradeWith(partnerId: string, shifts: readonly Shift[]): Shift | null {
  let best: Shift | null = null
  for (const s of shifts) {
    if (s.poster_id !== partnerId && s.coverer_id !== partnerId) continue
    if (!best || s.date > best.date) best = s
  }
  return best
}

// ---------------------------------------------------------------------------

interface Dated {
  shift?: Shift
  date?: Ymd
  starts_at?: string
  created_at?: string
}

/** Soonest first: by date, then start time (24-Hour before PM), then creation. */
function byShiftDate(a: Dated, b: Dated): number {
  const da = a.shift?.date ?? a.date ?? ''
  const db = b.shift?.date ?? b.date ?? ''
  if (da !== db) return da.localeCompare(db)
  const sa = a.shift?.starts_at ?? a.starts_at ?? ''
  const sb = b.shift?.starts_at ?? b.starts_at ?? ''
  return sa.localeCompare(sb) || (a.created_at ?? '').localeCompare(b.created_at ?? '')
}
