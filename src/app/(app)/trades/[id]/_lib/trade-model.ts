// Pure helpers for the shift/trade detail page (/trades/[id]): who the viewer
// is in this trade, the status badge, SwapMatch legs, chat threads, message
// grouping and the plain-text "Copy trade summary" for the paperwork.
// No I/O, so it is unit-tested (tests/unit/board-trade-model.test.ts).
// Dates follow ARCHITECTURE §3: 'YYYY-MM-DD' strings, never new Date(ymd).

import type { TradeDetail } from '@/lib/api'
import { formatDate, type Ymd } from '@/lib/sffd/dates'
import { SHIFT_TYPES, isShiftType } from '@/lib/sffd/shift-types'
import { stationLabel, stationPathLabel } from '@/lib/sffd/stations'
import type { Message, Shift, ShiftRequest, TradeContact } from '@/lib/types/database'
import { ymdOfInstant } from '@/app/(app)/board/_lib/format'

// ---------------------------------------------------------------------------
// Time
// ---------------------------------------------------------------------------

/** True once the shift has started (starts_at <= now), ARCHITECTURE §3. */
export function hasStarted(shift: Pick<Shift, 'starts_at'>, nowMs: number): boolean {
  const t = Date.parse(shift.starts_at)
  return Number.isFinite(t) && t <= nowMs
}

/** True when either leg of the trade has started (nothing can be cancelled by members then). */
export function tradeStarted(detail: Pick<TradeDetail, 'shift' | 'returnLeg'>, nowMs: number): boolean {
  return hasStarted(detail.shift, nowMs) || (detail.returnLeg != null && hasStarted(detail.returnLeg, nowMs))
}

// ---------------------------------------------------------------------------
// Legs
// ---------------------------------------------------------------------------

export interface Legs {
  /** The leg whose id is in the URL (shown in the header). */
  viewed: Shift
  /** The other SwapMatch leg, if this is a confirmed SwapMatch. */
  other: Shift | null
  /** True when the URL points at the SwapMatch return leg. */
  viewingReturnLeg: boolean
}

export function legsOf(detail: TradeDetail): Legs {
  const { shift, returnLeg, requestedId } = detail
  if (returnLeg && requestedId === returnLeg.id) return { viewed: returnLeg, other: shift, viewingReturnLeg: true }
  return { viewed: shift, other: returnLeg, viewingReturnLeg: false }
}

/** True for a SwapMatch: an offer with return dates, or a confirmed pair of legs. */
export function isSwapMatch(detail: Pick<TradeDetail, 'shift' | 'returnLeg'>): boolean {
  return detail.returnLeg != null || detail.shift.return_dates.length > 0 || detail.shift.return_leg_of != null
}

// ---------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------

export type TradeStatusKey = 'open' | 'covered' | 'cancelled' | 'started'

export interface TradeStatusInfo {
  key: TradeStatusKey
  label: string
  tone: 'blue' | 'green' | 'gray' | 'neutral'
}

/** Header badge for one leg: Open / Covered / Cancelled / Started. */
export function legStatus(shift: Pick<Shift, 'status' | 'starts_at'>, nowMs: number): TradeStatusInfo {
  if (shift.status === 'cancelled') return { key: 'cancelled', label: 'Cancelled', tone: 'gray' }
  if (hasStarted(shift, nowMs)) return { key: 'started', label: 'Started', tone: 'neutral' }
  if (shift.status === 'covered') return { key: 'covered', label: 'Covered', tone: 'green' }
  return { key: 'open', label: 'Open', tone: 'blue' }
}

// ---------------------------------------------------------------------------
// The viewer
// ---------------------------------------------------------------------------

/**
 * poster    — it's my shift (I posted the original)
 * coverer   — I work it (the original's coverer; on the return leg the roles swap, same two people)
 * requester — I asked for it (any request status)
 * viewer    — anyone else (another member or an admin)
 */
export type ViewerRole = 'poster' | 'coverer' | 'requester' | 'viewer'

export function viewerRole(detail: Pick<TradeDetail, 'shift' | 'requests'>, me: string): ViewerRole {
  const { shift, requests } = detail
  if (shift.poster_id === me) return 'poster'
  if (shift.coverer_id === me) return 'coverer'
  if (requests.some((r) => r.requester_id === me)) return 'requester'
  return 'viewer'
}

/** The other member of a confirmed trade, from my side; null when I'm not in it. */
export function otherPartyId(shift: Pick<Shift, 'poster_id' | 'coverer_id'>, me: string): string | null {
  if (!shift.coverer_id) return null
  if (shift.poster_id === me) return shift.coverer_id
  if (shift.coverer_id === me) return shift.poster_id
  return null
}

/** Name of the other member of a confirmed trade, from my side. */
export function otherPartyName(shift: Pick<Shift, 'poster_id' | 'poster_name' | 'coverer_id' | 'coverer_name'>, me: string): string {
  if (shift.poster_id === me) return shift.coverer_name ?? 'the other member'
  return shift.poster_name
}

/** My requests on the shift, newest first. */
export function myRequests(requests: readonly ShiftRequest[], me: string): ShiftRequest[] {
  return requests
    .filter((r) => r.requester_id === me)
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))
}

/** My pending request, else my newest request, else null. */
export function myCurrentRequest(requests: readonly ShiftRequest[], me: string): ShiftRequest | null {
  const mine = myRequests(requests, me)
  return mine.find((r) => r.status === 'pending') ?? mine[0] ?? null
}

/** Pending requests (oldest first) and the rest (newest first), for the poster. */
export function splitRequests(requests: readonly ShiftRequest[]): { pending: ShiftRequest[]; closed: ShiftRequest[] } {
  const pending = requests
    .filter((r) => r.status === 'pending')
    .sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at))
  const closed = requests
    .filter((r) => r.status !== 'pending')
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))
  return { pending, closed }
}

export const REQUEST_STATUS_LABELS: Record<ShiftRequest['status'], string> = {
  pending: 'Waiting',
  accepted: 'Confirmed',
  declined: 'Declined',
  withdrawn: 'Withdrawn',
  cancelled: 'Cancelled',
}

export type CancelState = 'none' | 'mine' | 'theirs'

/** Whether a cancel request is waiting on the trade, and who asked. */
export function cancelState(shift: Pick<Shift, 'status' | 'cancel_requested_by'>, me: string): CancelState {
  if (shift.status !== 'covered' || !shift.cancel_requested_by) return 'none'
  return shift.cancel_requested_by === me ? 'mine' : 'theirs'
}

// ---------------------------------------------------------------------------
// Chat threads
// ---------------------------------------------------------------------------

export interface ChatPartner {
  id: string
  name: string
  /** Short note for the thread picker ("Working it", "Declined", …). */
  note: string
}

/**
 * Who I can chat with about this shift (send_message: the poster and anyone
 * with a request on it or covering it). The poster gets one thread per
 * member (the coverer first, then pending requests oldest first, then the
 * rest); anyone else gets the poster, if they have a request or cover it.
 */
export function chatPartners(detail: Pick<TradeDetail, 'shift' | 'requests'>, me: string): ChatPartner[] {
  const { shift, requests } = detail
  if (shift.poster_id === me) {
    const out: ChatPartner[] = []
    const seen = new Set<string>()
    const add = (id: string, name: string, note: string) => {
      if (seen.has(id) || id === me) return
      seen.add(id)
      out.push({ id, name, note })
    }
    if (shift.coverer_id) add(shift.coverer_id, shift.coverer_name ?? 'Your trade partner', 'Working it')
    const { pending, closed } = splitRequests(requests)
    for (const r of pending) add(r.requester_id, r.requester_name, 'Asked for it')
    for (const r of closed) add(r.requester_id, r.requester_name, REQUEST_STATUS_LABELS[r.status])
    return out
  }
  const involved = shift.coverer_id === me || requests.some((r) => r.requester_id === me)
  return involved ? [{ id: shift.poster_id, name: shift.poster_name, note: 'Posted it' }] : []
}

/**
 * The thread to open first: one with unread messages, else the coverer /
 * first pending requester (chatPartners order), else none.
 */
export function defaultChatPartner(
  partners: readonly ChatPartner[],
  unreadBySender: Readonly<Record<string, number>> = {},
): string | null {
  const unread = partners.find((p) => (unreadBySender[p.id] ?? 0) > 0)
  return unread?.id ?? partners[0]?.id ?? null
}

export interface MessageDay {
  date: Ymd
  items: Message[]
}

/** Messages (oldest first) grouped by their Pacific calendar day. */
export function groupMessagesByDay(messages: readonly Message[]): MessageDay[] {
  const days: MessageDay[] = []
  for (const m of messages) {
    const date = ymdOfInstant(m.created_at)
    if (!date) continue
    const last = days[days.length - 1]
    if (last && last.date === date) last.items.push(m)
    else days.push({ date, items: [m] })
  }
  return days
}

/** Ids of the other member's messages to me that I haven't read. */
export function unreadFrom(messages: readonly Message[], me: string): string[] {
  return messages.filter((m) => m.recipient_id === me && !m.read_at).map((m) => m.id)
}

/** Unread counts per sender, from rows of messages sent to me. */
export function countBySender(rows: readonly Pick<Message, 'sender_id'>[]): Record<string, number> {
  const out: Record<string, number> = {}
  for (const { sender_id } of rows) out[sender_id] = (out[sender_id] ?? 0) + 1
  return out
}

// ---------------------------------------------------------------------------
// People
// ---------------------------------------------------------------------------

export interface PersonInfo {
  name: string
  rank: string | null
  station: number | null
}

/** "Mike Lee (Firefighter, Station 7)" — rank/station only when known. */
export function personLabel(person: PersonInfo): string {
  const extras = [person.rank, person.station != null ? stationLabel(person.station) : null].filter(Boolean)
  return extras.length ? `${person.name} (${extras.join(', ')})` : person.name
}

export interface PeopleLookup {
  me: string
  myProfile: { full_name: string; rank: string | null; station: number | null }
  contacts: readonly TradeContact[]
  requests: readonly ShiftRequest[]
}

/**
 * Rank and home station for a member of this trade, from what the page can
 * see: my own profile, trade contacts, or their request on the shift.
 */
export function personInfo(id: string | null, fallbackName: string, fallbackRank: string | null, lookup: PeopleLookup): PersonInfo {
  if (id && id === lookup.me) {
    return {
      name: lookup.myProfile.full_name || fallbackName,
      rank: lookup.myProfile.rank ?? fallbackRank,
      station: lookup.myProfile.station,
    }
  }
  const contact = id ? lookup.contacts.find((c) => c.user_id === id) : undefined
  if (contact) return { name: contact.full_name || fallbackName, rank: contact.rank ?? fallbackRank, station: contact.station }
  const request = id
    ? [...lookup.requests]
        .filter((r) => r.requester_id === id)
        .sort((a, b) => (a.status === 'accepted' ? -1 : b.status === 'accepted' ? 1 : 0))[0]
    : undefined
  if (request) return { name: request.requester_name || fallbackName, rank: request.requester_rank, station: request.requester_station }
  return { name: fallbackName, rank: fallbackRank, station: null }
}

// ---------------------------------------------------------------------------
// Copy trade summary (plain text for the paperwork / TeleStaff)
// ---------------------------------------------------------------------------

/** "24-Hour, 0800–0800 (24 hours)". */
export function shiftTypeLine(shiftType: string): string {
  if (!isShiftType(shiftType)) return shiftType
  const info = SHIFT_TYPES[shiftType]
  return `${info.label}, ${info.description} (${info.hours} hours)`
}

export const PAPERWORK_REMINDER =
  'Reminder: ShiftSwap is not the official record. This trade must still be entered in TeleStaff and approved per SFFD policy.'

/**
 * Plain-text summary of a confirmed trade for the paperwork. Null unless the
 * original leg is covered. Always describes the original leg first and the
 * SwapMatch return leg (if any) second, whichever leg the page shows.
 */
export function buildTradeSummary(detail: Pick<TradeDetail, 'shift' | 'returnLeg' | 'requests'>, lookup: PeopleLookup): string | null {
  const { shift, returnLeg } = detail
  if (shift.status !== 'covered' || !shift.coverer_id) return null

  const poster = personInfo(shift.poster_id, shift.poster_name, shift.rank, lookup)
  const coverer = personInfo(shift.coverer_id, shift.coverer_name ?? 'Unknown member', shift.rank, lookup)

  const lines = [
    'SFFD ShiftSwap: shift trade',
    `Date: ${formatDate(shift.date, 'long')}`,
    `Shift: ${shiftTypeLine(shift.shift_type)}`,
    `Location: ${stationPathLabel(shift.station)}`,
    `Working: ${personLabel(coverer)} works for ${personLabel(poster)}`,
  ]

  if (returnLeg && returnLeg.status === 'covered') {
    lines.push(
      `SwapMatch return: ${formatDate(returnLeg.date, 'long')}, ${shiftTypeLine(returnLeg.shift_type)} at ${stationLabel(returnLeg.station)}. ${poster.name} works for ${coverer.name}.`,
    )
  }

  const agreed = ymdOfInstant(shift.confirmed_at)
  if (agreed) lines.push(`Agreed in ShiftSwap on ${formatDate(agreed, 'medium')}.`)
  lines.push(PAPERWORK_REMINDER)
  return lines.join('\n')
}
