import { describe, expect, it } from 'vitest'
import type { RequestWithShift } from '@/lib/api'
import type { LedgerRow, Shift, ShiftRequest } from '@/lib/types/database'
import {
  activeRequests,
  balanceLines,
  balanceSummary,
  buildHistory,
  cancelStatus,
  chooseCta,
  groupIncoming,
  groupTrades,
  latestTradeWith,
  namesPreview,
  parseTradeTab,
  pendingActionCount,
  perspectiveLabel,
  requestCounts,
  shiftLine,
  signed,
  sortLedger,
} from '@/app/(app)/trades/_components/trades-model'

const ME = '00000000-0000-4000-8000-000000000001'
const ANA = '00000000-0000-4000-8000-000000000002'
const MIKE = '00000000-0000-4000-8000-000000000003'

// 2026-09-23 12:00 Pacific
const NOW = Date.parse('2026-09-23T19:00:00Z')

let seq = 0
function shift(overrides: Partial<Shift> = {}): Shift {
  seq += 1
  const date = overrides.date ?? '2026-09-30'
  return {
    id: `10000000-0000-4000-8000-${String(seq).padStart(12, '0')}`,
    poster_id: ME,
    poster_name: 'Brian Machado',
    rank: 'Firefighter',
    station: 19,
    battalion: 9,
    division: 3,
    date,
    shift_type: '24-Hour',
    hours: 24,
    starts_at: `${date}T15:00:00Z`,
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
    created_at: '2026-09-01T00:00:00Z',
    updated_at: '2026-09-01T00:00:00Z',
    ...overrides,
  }
}

function request(s: Shift, overrides: Partial<ShiftRequest> = {}): RequestWithShift {
  seq += 1
  return {
    id: `20000000-0000-4000-8000-${String(seq).padStart(12, '0')}`,
    shift_id: s.id,
    requester_id: ANA,
    requester_name: 'Ana Cruz',
    requester_rank: 'Firefighter',
    requester_station: 19,
    return_date: null,
    message: null,
    status: 'pending',
    decided_at: null,
    created_at: `2026-09-10T00:00:${String(seq % 60).padStart(2, '0')}Z`,
    ...overrides,
    shift: s,
  }
}

describe('parseTradeTab', () => {
  it('accepts the four tabs and defaults to pending', () => {
    expect(parseTradeTab('history')).toBe('history')
    expect(parseTradeTab('balances')).toBe('balances')
    expect(parseTradeTab('nope')).toBe('pending')
    expect(parseTradeTab(null)).toBe('pending')
  })
})

describe('labels', () => {
  it('words a trade from my side', () => {
    const iCover = shift({ poster_id: ANA, poster_name: 'Ana Cruz', coverer_id: ME, coverer_name: 'Brian Machado', status: 'covered' })
    const theyCover = shift({ coverer_id: MIKE, coverer_name: 'Mike Lee', status: 'covered' })
    expect(perspectiveLabel(iCover, ME)).toBe("You're working for Ana Cruz")
    expect(perspectiveLabel(theyCover, ME)).toBe('Mike Lee is working for you')
    expect(perspectiveLabel(iCover, ME, 'past')).toBe('You worked for Ana Cruz')
    expect(perspectiveLabel(theyCover, ME, 'past')).toBe('Mike Lee worked for you')
  })

  it('formats a shift line with the Pacific date', () => {
    expect(shiftLine(shift({ date: '2026-09-30', station: 19 }))).toBe('Wed, Sep 30 · 24-Hour · Station 19')
    expect(shiftLine(shift({ date: '2026-10-01', shift_type: 'PM', station: 101 }))).toBe(
      'Thu, Oct 1 · PM · Airport Station 1',
    )
  })

  it('previews names and CTAs', () => {
    expect(namesPreview(['Ana Cruz'])).toBe('Ana Cruz')
    expect(namesPreview(['Ana Cruz', 'Mike Lee'])).toBe('Ana Cruz and Mike Lee')
    expect(namesPreview(['A', 'B', 'C', 'D'])).toBe('A, B and 2 more')
    expect(chooseCta(3)).toBe('3 requests — choose one')
    expect(chooseCta(1)).toBe('1 request — take a look')
  })

  it('describes cancel requests', () => {
    expect(cancelStatus(null, ME, 'Ana')).toBe('')
    expect(cancelStatus(ME, ME, 'Ana')).toBe('You asked to cancel — waiting on Ana')
    expect(cancelStatus(ANA, ME, 'Ana')).toBe('Ana asked to cancel — your answer is needed')
  })
})

describe('groupIncoming', () => {
  it('groups pending requests by open, not-started shift, soonest first', () => {
    const later = shift({ date: '2026-10-05' })
    const sooner = shift({ date: '2026-09-28' })
    const started = shift({ date: '2026-09-22' })
    const covered = shift({ date: '2026-09-29', status: 'covered', coverer_id: MIKE, coverer_name: 'Mike Lee' })
    const rows = [
      request(later),
      request(later, { requester_id: MIKE, requester_name: 'Mike Lee' }),
      request(sooner),
      request(started),
      request(covered),
      request(sooner, { status: 'declined' }),
    ]
    const groups = groupIncoming(rows, NOW)
    expect(groups.map((g) => g.shift.id)).toEqual([sooner.id, later.id])
    expect(groups[1].requests.map((r) => r.requester_name)).toEqual(['Ana Cruz', 'Mike Lee'])
    expect(groups[0].requests).toHaveLength(1)
    expect(requestCounts(rows).get(later.id)).toBe(2)
    expect(requestCounts(rows).get(sooner.id)).toBe(1)
    expect(pendingActionCount(groups, [shift()])).toBe(3)
  })

  it('keeps only my requests that can still be answered', () => {
    const open = shift({ poster_id: ANA, poster_name: 'Ana Cruz', date: '2026-10-02' })
    const past = shift({ poster_id: ANA, poster_name: 'Ana Cruz', date: '2026-09-20' })
    const mine = [request(open, { requester_id: ME }), request(past, { requester_id: ME })]
    expect(activeRequests(mine, NOW).map((r) => r.shift_id)).toEqual([open.id])
  })
})

describe('groupTrades', () => {
  it('pairs SwapMatch legs and keeps ordinary trades single', () => {
    const original = shift({
      date: '2026-10-03',
      status: 'covered',
      coverer_id: ANA,
      coverer_name: 'Ana Cruz',
      return_dates: ['2026-10-10'],
    })
    const returnLeg = shift({
      date: '2026-10-10',
      poster_id: ANA,
      poster_name: 'Ana Cruz',
      coverer_id: ME,
      coverer_name: 'Brian Machado',
      status: 'covered',
      return_leg_of: original.id,
    })
    original.return_leg_id = returnLeg.id
    const single = shift({ date: '2026-09-27', status: 'covered', coverer_id: MIKE, coverer_name: 'Mike Lee' })

    const groups = groupTrades([returnLeg, single, original], ME)
    expect(groups).toHaveLength(2)
    expect(groups[0]).toMatchObject({ id: single.id, isSwap: false, partnerName: 'Mike Lee' })
    expect(groups[1]).toMatchObject({ id: original.id, isSwap: true, partnerName: 'Ana Cruz' })
    expect(groups[1].legs.map((l) => l.id)).toEqual([original.id, returnLeg.id])
    expect(perspectiveLabel(groups[1].legs[0], ME)).toBe('Ana Cruz is working for you')
    expect(perspectiveLabel(groups[1].legs[1], ME)).toBe("You're working for Ana Cruz")
  })

  it('shows a lone return leg when the original already started', () => {
    const returnLeg = shift({
      poster_id: ANA,
      poster_name: 'Ana Cruz',
      coverer_id: ME,
      status: 'covered',
      return_leg_of: '10000000-0000-4000-8000-999999999999',
      cancel_requested_by: ANA,
    })
    const [group] = groupTrades([returnLeg], ME)
    expect(group.id).toBe('10000000-0000-4000-8000-999999999999')
    expect(group.isSwap).toBe(true)
    expect(group.partnerName).toBe('Ana Cruz')
    expect(group.cancelRequestedBy).toBe(ANA)
  })
})

describe('buildHistory', () => {
  it('merges shifts and requests, latest first, with plain labels', () => {
    const worked = shift({
      date: '2026-09-10',
      poster_id: ANA,
      poster_name: 'Ana Cruz',
      coverer_id: ME,
      status: 'covered',
    })
    const cancelledPost = shift({ date: '2026-09-15', status: 'cancelled', cancelled_by: ME })
    const undone = shift({ date: '2026-09-18', status: 'cancelled', coverer_name: 'Mike Lee', cancel_note: 'Sick kid' })
    const expired = shift({ date: '2026-09-12' })
    const other = shift({ date: '2026-09-20', poster_id: MIKE, poster_name: 'Mike Lee' })
    const declined = request(other, { requester_id: ME, status: 'declined' })
    const unanswered = request(shift({ date: '2026-09-21', poster_id: MIKE, poster_name: 'Mike Lee' }), {
      requester_id: ME,
    })
    const stillOpen = request(shift({ date: '2026-10-21', poster_id: MIKE, poster_name: 'Mike Lee' }), {
      requester_id: ME,
    })

    const items = buildHistory([worked, cancelledPost, undone, expired], [declined], [unanswered, stillOpen], ME, NOW)
    expect(items.map((i) => i.title)).toEqual([
      'No answer before the shift started',
      "Your request wasn't chosen",
      'Trade with Mike Lee was cancelled',
      'You cancelled this post',
      'Nobody picked this up in time',
      'You worked for Ana Cruz',
    ])
    expect(items.find((i) => i.shiftId === undone.id)?.detail).toBe('Sick kid')
    expect(items.find((i) => i.key === `request:${declined.id}`)?.detail).toBe("Mike Lee's shift")
  })

  it('says when an admin cancelled my post', () => {
    const [item] = buildHistory([shift({ status: 'cancelled', cancelled_by: MIKE })], [], [], ME, NOW)
    expect(item.title).toBe('Your post was cancelled by an admin')
  })
})

describe('balances', () => {
  const row = (overrides: Partial<LedgerRow>): LedgerRow => ({
    partner_id: ANA,
    partner_name: 'Ana Cruz',
    partner_rank: 'Firefighter',
    i_covered_24: 0,
    i_covered_pm: 0,
    they_covered_24: 0,
    they_covered_pm: 0,
    net_24: 0,
    net_pm: 0,
    upcoming: 0,
    last_date: null,
    ...overrides,
  })

  it('says who owes whom per shift type', () => {
    expect(balanceLines(row({ partner_name: 'Mike Lee', net_24: 1 }))).toEqual([
      { direction: 'owed', text: 'Mike Lee owes you 1 × 24-Hour' },
    ])
    expect(balanceLines(row({ net_pm: -1 }))).toEqual([{ direction: 'owe', text: 'You owe Ana Cruz 1 × PM' }])
    expect(balanceLines(row({ net_24: 2, net_pm: -1 })).map((l) => l.text)).toEqual([
      'Ana Cruz owes you 2 × 24-Hour',
      'You owe Ana Cruz 1 × PM',
    ])
    expect(balanceLines(row({}))).toEqual([{ direction: 'even', text: 'Even' }])
  })

  it('lists unsettled partners first, then the most recent', () => {
    const even = row({ partner_id: 'a', partner_name: 'Even Recent', last_date: '2026-09-20' })
    const owes = row({ partner_id: 'b', partner_name: 'Owes Old', net_24: 1, last_date: '2026-01-01' })
    const owed = row({ partner_id: 'c', partner_name: 'Owed New', net_pm: -1, last_date: '2026-09-01' })
    expect(sortLedger([even, owes, owed]).map((r) => r.partner_id)).toEqual(['c', 'b', 'a'])
  })

  it('formats totals', () => {
    expect(signed(2)).toBe('+2')
    expect(signed(0)).toBe('0')
    expect(signed(-3)).toBe('−3')
    expect(balanceSummary({ covered: 0, given: 0 })).toBe('No trades yet.')
    expect(balanceSummary({ covered: 5, given: 3 })).toBe("You've covered 2 more shifts than you've given away.")
    expect(balanceSummary({ covered: 1, given: 2 })).toBe("You've given away 1 more shift than you've covered.")
    expect(balanceSummary({ covered: 2, given: 2 })).toMatch(/even/)
  })

  it('finds the latest trade with a partner', () => {
    const a = shift({ date: '2026-09-01', coverer_id: ANA })
    const b = shift({ date: '2026-09-15', coverer_id: ANA })
    const c = shift({ date: '2026-09-20', coverer_id: MIKE })
    expect(latestTradeWith(ANA, [a, b, c])?.id).toBe(b.id)
    expect(latestTradeWith('nobody', [a, b, c])).toBeNull()
  })
})
