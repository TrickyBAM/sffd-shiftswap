import { beforeEach, describe, expect, it, vi } from 'vitest'

// The screen's one shift query is listAdminShifts() from src/lib/api (CC-5);
// fetchAllTrades is tested against a stand-in for it.
const mocks = vi.hoisted(() => ({ listAdminShifts: vi.fn() }))
vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api')>()),
  listAdminShifts: mocks.listAdminShifts,
}))

import { hasStarted, swapText, tradeStatus, tradesCsv, TRADE_CSV_HEADERS } from '@/app/(app)/admin/trades/_lib/present'
import {
  DEFAULT_TRADE_FILTERS,
  fetchAllTrades,
  isTradeScope,
  tradeListOptions,
  TRADE_PAGE_SIZE,
} from '@/app/(app)/admin/trades/_lib/query'
import type { Sb } from '@/lib/api'
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

describe('tradeListOptions', () => {
  it('maps the default filters onto listAdminShifts', () => {
    expect(tradeListOptions(DEFAULT_TRADE_FILTERS)).toEqual({
      scope: 'upcoming',
      withReturnLegs: true,
      from: null,
      to: null,
      station: null,
      battalion: null,
      member: '',
      offset: 0,
      limit: TRADE_PAGE_SIZE,
      now: undefined,
    })
  })

  it('passes dates, place, member name and paging; a station wins over its battalion', () => {
    const now = new Date('2026-09-23T20:00:00Z')
    const options = tradeListOptions(
      { scope: 'all', from: '2026-10-01', to: '2026-10-31', battalion: 9, station: 19, member: 'mike' },
      { offset: 50, limit: 25, now },
    )
    expect(options).toMatchObject({
      scope: 'all',
      from: '2026-10-01',
      to: '2026-10-31',
      station: 19,
      battalion: null,
      member: 'mike',
      offset: 50,
      limit: 25,
      now,
    })
    expect(tradeListOptions({ ...DEFAULT_TRADE_FILTERS, battalion: 9 }).battalion).toBe(9)
  })

  it('treats a half-typed date as no limit instead of an error', () => {
    const options = tradeListOptions({ ...DEFAULT_TRADE_FILTERS, from: '2026-1', to: '' })
    expect(options.from).toBeNull()
    expect(options.to).toBeNull()
  })
})

describe('fetchAllTrades', () => {
  const sb = {} as Sb
  beforeEach(() => {
    mocks.listAdminShifts.mockReset()
  })

  it('reads 200 rows at a time until it has them all, merging the return legs', async () => {
    const rows = Array.from({ length: 450 }, (_, i) => shift({ id: `id-${i}` }))
    const leg = shift({ id: 'leg-1', date: '2026-11-02' })
    mocks.listAdminShifts.mockImplementation(async (_sb: Sb, options: { offset: number; limit: number }) => ({
      items: rows.slice(options.offset, options.offset + options.limit),
      total: rows.length,
      returnLegs: options.offset === 200 ? new Map([['leg-1', leg]]) : new Map(),
    }))
    const all = await fetchAllTrades(sb, { ...DEFAULT_TRADE_FILTERS, scope: 'past' }, NOW)
    expect(all.items).toHaveLength(450)
    expect(all.total).toBe(450)
    expect(all.returnLegs.get('leg-1')).toBe(leg)
    expect(mocks.listAdminShifts).toHaveBeenCalledTimes(3)
    expect(mocks.listAdminShifts.mock.calls.map((call) => call[1].offset)).toEqual([0, 200, 400])
    expect(mocks.listAdminShifts.mock.calls[0][1]).toMatchObject({ scope: 'past', limit: 200, now: NOW, withReturnLegs: true })
  })

  it('stops after one short page', async () => {
    mocks.listAdminShifts.mockResolvedValue({ items: [shift()], total: 1, returnLegs: new Map() })
    const all = await fetchAllTrades(sb, DEFAULT_TRADE_FILTERS, NOW)
    expect(all.items).toHaveLength(1)
    expect(mocks.listAdminShifts).toHaveBeenCalledTimes(1)
  })
})
