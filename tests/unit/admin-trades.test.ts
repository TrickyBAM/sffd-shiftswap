import { describe, expect, it } from 'vitest'
import { hasStarted, swapText, tradeStatus, tradesCsv, TRADE_CSV_HEADERS } from '@/app/(app)/admin/trades/_lib/present'
import { isTradeScope } from '@/app/(app)/admin/trades/_lib/query'
import { parseCsv } from '@/lib/roster/csv'
import type { Shift } from '@/lib/types/database'

const NOW = new Date('2026-09-23T20:00:00Z')

function shift(partial: Partial<Shift> = {}): Shift {
  return {
    id: '44444444-4444-4444-8444-444444444444',
    poster_id: '33333333-3333-4333-8333-333333333333',
    poster_name: 'Ana Cruz',
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
    created_at: '2026-09-20T10:00:00Z',
    updated_at: '2026-09-20T10:00:00Z',
    ...partial,
  }
}

describe('tradeStatus', () => {
  it('uses plain words for every state', () => {
    expect(tradeStatus(shift(), NOW).label).toBe('Open')
    expect(tradeStatus(shift({ starts_at: '2026-09-01T15:00:00Z' }), NOW).label).toBe('Expired (nobody took it)')
    expect(tradeStatus(shift({ status: 'covered', coverer_name: 'Mike Lee' }), NOW).label).toBe('Confirmed')
    expect(tradeStatus(shift({ status: 'covered', starts_at: '2026-09-01T15:00:00Z' }), NOW).label).toBe('Worked')
    expect(tradeStatus(shift({ status: 'cancelled', coverer_name: 'Mike Lee' }), NOW).label).toBe('Trade undone')
    expect(tradeStatus(shift({ status: 'cancelled' }), NOW).label).toBe('Post taken down')
  })

  it('hasStarted compares starts_at with now', () => {
    expect(hasStarted({ starts_at: '2026-09-23T20:00:00Z' }, NOW)).toBe(true)
    expect(hasStarted({ starts_at: '2026-09-23T20:00:01Z' }, NOW)).toBe(false)
  })
})

describe('swapText', () => {
  it('shows the confirmed return day, the offered days, or nothing', () => {
    expect(swapText(shift({ return_dates: ['2026-10-20', '2026-10-23'] }))).toBe('SwapMatch: Oct 20, Oct 23')
    expect(swapText(shift({ return_leg_id: 'x' }), { date: '2026-10-20' })).toBe('Pays back Tue, Oct 20')
    expect(swapText(shift())).toBe('')
  })
})

describe('tradesCsv', () => {
  it('writes a header and one escaped row per shift', () => {
    const covered = shift({
      status: 'covered',
      coverer_name: 'Lee, Mike',
      notes: '=cmd',
      return_leg_id: 'leg-1',
      return_dates: ['2026-10-20'],
    })
    const csv = tradesCsv([covered], new Map([['leg-1', { date: '2026-10-20' }]]), NOW)
    expect(csv.endsWith('\r\n')).toBe(true)
    const [header, row, ...rest] = parseCsv(csv).map((r) => r.cells)
    expect(rest).toEqual([])
    expect(header).toEqual([...TRADE_CSV_HEADERS])
    const byHeader = Object.fromEntries(header.map((h, i) => [h, row[i]]))
    expect(byHeader).toMatchObject({
      Date: '2026-10-14',
      Day: 'Wed',
      'Shift type': '24-Hour',
      Hours: '24',
      Station: 'Station 19',
      'Posted by': 'Ana Cruz',
      'Covered by': 'Lee, Mike',
      Status: 'Confirmed',
      'SwapMatch return date': '2026-10-20',
      Notes: "'=cmd",
    })
  })
})

describe('isTradeScope', () => {
  it('accepts only known scopes', () => {
    expect(isTradeScope('open')).toBe(true)
    expect(isTradeScope('all')).toBe(true)
    expect(isTradeScope('nope')).toBe(false)
    expect(isTradeScope(null)).toBe(false)
  })
})
