import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { TradeDetail } from '@/lib/api'
import type { Message, Shift, ShiftRequest, TradeContact } from '@/lib/types/database'
import {
  PAPERWORK_REMINDER,
  buildTradeSummary,
  cancelState,
  chatPartners,
  countBySender,
  defaultChatPartner,
  groupMessagesByDay,
  hasStarted,
  legStatus,
  legsOf,
  myCurrentRequest,
  otherPartyId,
  otherPartyName,
  personInfo,
  personLabel,
  splitRequests,
  tradeStarted,
  unreadFrom,
  viewerRole,
  type PeopleLookup,
} from '@/app/(app)/trades/[id]/_lib/trade-model'
import {
  MAX_TRADE_SNAPSHOTS,
  loadTradeSnapshot,
  saveTradeSnapshot,
} from '@/app/(app)/trades/[id]/_lib/trade-snapshot'

const BRIAN = '00000000-0000-4000-8000-000000000001'
const MIKE = '00000000-0000-4000-8000-000000000002'
const ANA = '00000000-0000-4000-8000-000000000003'
const OTHER = '00000000-0000-4000-8000-000000000004'
const SHIFT_ID = '10000000-0000-4000-8000-000000000001'
const LEG_ID = '10000000-0000-4000-8000-000000000002'

// 2026-09-23 12:00 Pacific
const NOW = Date.parse('2026-09-23T19:00:00Z')

function shift(overrides: Partial<Shift> = {}): Shift {
  return {
    id: SHIFT_ID,
    poster_id: BRIAN,
    poster_name: 'Brian Machado',
    rank: 'Firefighter',
    station: 19,
    battalion: 9,
    division: 3,
    date: '2026-10-14',
    shift_type: '24-Hour',
    hours: 24,
    starts_at: '2026-10-14T15:00:00Z',
    status: 'open',
    return_dates: [],
    accept_limit: 'anyone',
    notes: null,
    coverer_id: null,
    coverer_name: null,
    confirmed_at: null,
    return_leg_of: null,
    return_leg_id: null,
    cancel_requested_by: null,
    cancel_requested_at: null,
    cancel_reason: null,
    cancelled_at: null,
    cancelled_by: null,
    cancel_note: null,
    created_at: '2026-09-20T18:00:00Z',
    updated_at: '2026-09-20T18:00:00Z',
    ...overrides,
  }
}

function request(overrides: Partial<ShiftRequest> = {}): ShiftRequest {
  return {
    id: `20000000-0000-4000-8000-${Math.random().toString(16).slice(2, 14).padEnd(12, '0')}`,
    shift_id: SHIFT_ID,
    requester_id: MIKE,
    requester_name: 'Mike Lee',
    requester_rank: 'Firefighter',
    requester_station: 7,
    return_date: null,
    message: null,
    status: 'pending',
    decided_at: null,
    created_at: '2026-09-21T18:00:00Z',
    ...overrides,
  }
}

const covered = shift({
  status: 'covered',
  coverer_id: MIKE,
  coverer_name: 'Mike Lee',
  confirmed_at: '2026-09-22T20:00:00Z',
  return_leg_id: LEG_ID,
  return_dates: ['2026-10-16'],
})
const returnLeg = shift({
  id: LEG_ID,
  poster_id: MIKE,
  poster_name: 'Mike Lee',
  station: 7,
  battalion: 6,
  date: '2026-10-16',
  starts_at: '2026-10-16T15:00:00Z',
  status: 'covered',
  coverer_id: BRIAN,
  coverer_name: 'Brian Machado',
  return_leg_of: SHIFT_ID,
  confirmed_at: '2026-09-22T20:00:00Z',
})
const accepted = request({ status: 'accepted', return_date: '2026-10-16' })

function detail(overrides: Partial<TradeDetail> = {}): TradeDetail {
  return { shift: shift(), returnLeg: null, requestedId: SHIFT_ID, requests: [], ...overrides }
}

describe('legs and status', () => {
  it('shows the leg in the URL and links the other one', () => {
    const d = detail({ shift: covered, returnLeg, requestedId: LEG_ID })
    expect(legsOf(d)).toEqual({ viewed: returnLeg, other: covered, viewingReturnLeg: true })
    expect(legsOf({ ...d, requestedId: SHIFT_ID })).toEqual({ viewed: covered, other: returnLeg, viewingReturnLeg: false })
  })

  it('badges Open / Covered / Cancelled / Started', () => {
    expect(legStatus(shift(), NOW).label).toBe('Open')
    expect(legStatus(covered, NOW).label).toBe('Covered')
    expect(legStatus(shift({ status: 'cancelled' }), NOW).label).toBe('Cancelled')
    expect(legStatus(covered, Date.parse('2026-10-14T15:00:00Z')).label).toBe('Started')
  })

  it('a trade has started once either leg has', () => {
    const d = detail({ shift: covered, returnLeg })
    expect(tradeStarted(d, NOW)).toBe(false)
    expect(hasStarted(returnLeg, Date.parse('2026-10-15T00:00:00Z'))).toBe(false)
    expect(tradeStarted({ shift: covered, returnLeg: { ...returnLeg, starts_at: '2026-09-01T15:00:00Z' } }, NOW)).toBe(true)
  })
})

describe('the viewer', () => {
  it('is poster, coverer, requester or just a viewer', () => {
    expect(viewerRole(detail(), BRIAN)).toBe('poster')
    expect(viewerRole(detail({ shift: covered }), MIKE)).toBe('coverer')
    expect(viewerRole(detail({ requests: [request({ requester_id: ANA })] }), ANA)).toBe('requester')
    expect(viewerRole(detail(), OTHER)).toBe('viewer')
  })

  it('knows the other party of a confirmed trade', () => {
    expect(otherPartyId(covered, BRIAN)).toBe(MIKE)
    expect(otherPartyId(covered, MIKE)).toBe(BRIAN)
    expect(otherPartyId(covered, OTHER)).toBeNull()
    expect(otherPartyId(shift(), BRIAN)).toBeNull()
    expect(otherPartyName(covered, BRIAN)).toBe('Mike Lee')
    expect(otherPartyName(covered, MIKE)).toBe('Brian Machado')
  })

  it('finds my pending request first, else my newest', () => {
    const old = request({ status: 'declined', created_at: '2026-09-21T10:00:00Z' })
    const newer = request({ status: 'withdrawn', created_at: '2026-09-22T10:00:00Z' })
    const pending = request({ status: 'pending', created_at: '2026-09-20T10:00:00Z' })
    expect(myCurrentRequest([old, newer], MIKE)).toBe(newer)
    expect(myCurrentRequest([old, newer, pending], MIKE)).toBe(pending)
    expect(myCurrentRequest([old], ANA)).toBeNull()
  })

  it('splits requests into pending (oldest first) and the rest (newest first)', () => {
    const a = request({ requester_id: ANA, created_at: '2026-09-21T09:00:00Z' })
    const b = request({ created_at: '2026-09-21T08:00:00Z' })
    const c = request({ status: 'declined', created_at: '2026-09-20T08:00:00Z' })
    const d = request({ status: 'withdrawn', created_at: '2026-09-22T08:00:00Z' })
    expect(splitRequests([a, c, b, d])).toEqual({ pending: [b, a], closed: [d, c] })
  })

  it('knows who asked to cancel', () => {
    expect(cancelState(covered, BRIAN)).toBe('none')
    const asked = { ...covered, cancel_requested_by: MIKE }
    expect(cancelState(asked, MIKE)).toBe('mine')
    expect(cancelState(asked, BRIAN)).toBe('theirs')
    expect(cancelState({ ...asked, status: 'open' }, BRIAN)).toBe('none')
  })
})

describe('chat threads', () => {
  it('gives the poster one thread per member: coverer, pending, then the rest', () => {
    const d = detail({
      shift: { ...covered },
      requests: [
        request({ requester_id: ANA, requester_name: 'Ana Ruiz', status: 'declined' }),
        accepted,
        request({ requester_id: OTHER, requester_name: 'Sam Oh', status: 'withdrawn', created_at: '2026-09-22T00:00:00Z' }),
      ],
    })
    expect(chatPartners(d, BRIAN).map((p) => [p.name, p.note])).toEqual([
      ['Mike Lee', 'Working it'],
      ['Sam Oh', 'Withdrawn'],
      ['Ana Ruiz', 'Declined'],
    ])
  })

  it('lets a requester or the coverer talk to the poster, nobody else', () => {
    expect(chatPartners(detail({ requests: [request()] }), MIKE)).toEqual([
      { id: BRIAN, name: 'Brian Machado', note: 'Posted it' },
    ])
    expect(chatPartners(detail({ shift: covered }), MIKE)).toHaveLength(1)
    expect(chatPartners(detail(), OTHER)).toEqual([])
  })

  it('opens the thread with unread messages first', () => {
    const partners = [
      { id: MIKE, name: 'Mike', note: '' },
      { id: ANA, name: 'Ana', note: '' },
    ]
    expect(defaultChatPartner(partners)).toBe(MIKE)
    expect(defaultChatPartner(partners, { [ANA]: 2 })).toBe(ANA)
    expect(defaultChatPartner([])).toBeNull()
  })

  it('groups messages by Pacific day and finds unread ones', () => {
    const msg = (id: string, created_at: string, extra: Partial<Message> = {}): Message => ({
      id,
      shift_id: SHIFT_ID,
      sender_id: MIKE,
      recipient_id: BRIAN,
      body: id,
      read_at: null,
      created_at,
      ...extra,
    })
    const messages = [
      msg('a', '2026-09-22T20:00:00Z'),
      // 11:30 PM Pacific on Sep 22 (already Sep 23 in UTC)
      msg('b', '2026-09-23T06:30:00Z', { read_at: '2026-09-23T07:00:00Z' }),
      msg('c', '2026-09-23T16:00:00Z', { sender_id: BRIAN, recipient_id: MIKE }),
    ]
    expect(groupMessagesByDay(messages).map((d) => [d.date, d.items.map((m) => m.id)])).toEqual([
      ['2026-09-22', ['a', 'b']],
      ['2026-09-23', ['c']],
    ])
    expect(unreadFrom(messages, BRIAN)).toEqual(['a'])
    expect(countBySender([{ sender_id: MIKE }, { sender_id: ANA }, { sender_id: MIKE }])).toEqual({ [MIKE]: 2, [ANA]: 1 })
  })
})

describe('people', () => {
  const contacts: TradeContact[] = [
    { user_id: MIKE, full_name: 'Mike Lee', rank: 'Firefighter', station: 7, phone: '415-555-0100', email: 'mike@example.com' },
  ]
  const lookup: PeopleLookup = {
    me: BRIAN,
    myProfile: { full_name: 'Brian Machado', rank: 'Firefighter', station: 19 },
    contacts,
    requests: [],
  }

  it('uses my profile, then contacts, then requests, then the snapshot name', () => {
    expect(personInfo(BRIAN, 'x', null, lookup)).toEqual({ name: 'Brian Machado', rank: 'Firefighter', station: 19 })
    expect(personInfo(MIKE, 'x', null, lookup)).toEqual({ name: 'Mike Lee', rank: 'Firefighter', station: 7 })
    const viaRequest = { ...lookup, contacts: [], requests: [request({ requester_id: ANA, requester_name: 'Ana Ruiz', requester_station: 3 })] }
    expect(personInfo(ANA, 'x', null, viaRequest)).toEqual({ name: 'Ana Ruiz', rank: 'Firefighter', station: 3 })
    expect(personInfo(OTHER, 'Sam Oh', 'Captain', lookup)).toEqual({ name: 'Sam Oh', rank: 'Captain', station: null })
  })

  it('labels people with rank and station when known', () => {
    expect(personLabel({ name: 'Mike Lee', rank: 'Firefighter', station: 7 })).toBe('Mike Lee (Firefighter, Station 7)')
    expect(personLabel({ name: 'Mike Lee', rank: null, station: null })).toBe('Mike Lee')
  })
})

describe('buildTradeSummary', () => {
  const lookup: PeopleLookup = {
    me: BRIAN,
    myProfile: { full_name: 'Brian Machado', rank: 'Firefighter', station: 19 },
    contacts: [],
    requests: [accepted],
  }

  it('is only for confirmed trades', () => {
    expect(buildTradeSummary(detail(), lookup)).toBeNull()
    expect(buildTradeSummary(detail({ shift: shift({ status: 'cancelled' }) }), lookup)).toBeNull()
  })

  it('has everything the paperwork needs', () => {
    const plain = { ...covered, return_leg_id: null, return_dates: [] }
    expect(buildTradeSummary(detail({ shift: plain, requests: [request({ status: 'accepted' })] }), lookup)).toBe(
      [
        'SFFD ShiftSwap: shift trade',
        'Date: Wednesday, October 14, 2026',
        'Shift: 24-Hour, 0800–0800 (24 hours)',
        'Location: Station 19 · Battalion 9 · Division 3',
        'Working: Mike Lee (Firefighter, Station 7) works for Brian Machado (Firefighter, Station 19)',
        'Agreed in ShiftSwap on Sep 22, 2026.',
        PAPERWORK_REMINDER,
      ].join('\n'),
    )
  })

  it('adds the SwapMatch return shift, whichever leg is viewed', () => {
    const text = buildTradeSummary(detail({ shift: covered, returnLeg, requestedId: LEG_ID, requests: [accepted] }), lookup)
    expect(text).toContain(
      'SwapMatch return: Friday, October 16, 2026, 24-Hour, 0800–0800 (24 hours) at Station 7. Brian Machado works for Mike Lee.',
    )
    expect(text?.split('\n')[1]).toBe('Date: Wednesday, October 14, 2026')
    expect(text).toContain('TeleStaff')
  })
})

describe('trade snapshots', () => {
  const store = new Map<string, string>()
  const fake = {
    get length() {
      return store.size
    },
    key: (i: number) => [...store.keys()][i] ?? null,
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
  }
  let previous: unknown
  beforeEach(() => {
    previous = (globalThis as { localStorage?: unknown }).localStorage
    ;(globalThis as { localStorage?: unknown }).localStorage = fake
    store.clear()
  })
  afterEach(() => {
    ;(globalThis as { localStorage?: unknown }).localStorage = previous
  })

  it('keeps the most recent trades per member', () => {
    const d = detail({ shift: covered })
    for (let i = 0; i < MAX_TRADE_SNAPSHOTS + 2; i++) {
      saveTradeSnapshot(BRIAN, `id-${i}`, { detail: d, contacts: [] }, new Date(NOW + i * 1000))
    }
    expect(loadTradeSnapshot(BRIAN, 'id-0')).toBeNull()
    expect(loadTradeSnapshot(BRIAN, 'id-1')).toBeNull()
    expect(loadTradeSnapshot(BRIAN, `id-${MAX_TRADE_SNAPSHOTS + 1}`)?.detail.shift.id).toBe(SHIFT_ID)
    expect(loadTradeSnapshot(MIKE, `id-${MAX_TRADE_SNAPSHOTS + 1}`)).toBeNull()
  })
})
