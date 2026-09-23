// Shifts and trades for /admin/trades. Like listAdminShifts() in
// src/lib/api/admin.ts, plus date-range, battalion/station and member-name
// filters. Only original legs are listed; a SwapMatch return leg is shown
// with the trade it belongs to.

import { getShiftsByIds, type CountedPage, type Sb } from '@/lib/api'
import { clampLimit, ilikeContains, nowIso, runQuery, sanitizeSearch } from '@/lib/api/core'
import { isYmd } from '@/lib/sffd/dates'
import type { Shift } from '@/lib/types/database'

export type TradeScope = 'upcoming' | 'past' | 'open' | 'cancelled' | 'all'

export interface TradeFilters {
  scope: TradeScope
  /** 'YYYY-MM-DD' or '' (no limit). Inclusive. */
  from: string
  to: string
  battalion: number | null
  station: number | null
  /** Poster or coverer name (contains, any case). */
  member: string
}

export const DEFAULT_TRADE_FILTERS: TradeFilters = {
  scope: 'upcoming',
  from: '',
  to: '',
  battalion: null,
  station: null,
  member: '',
}

export const TRADE_PAGE_SIZE = 25

export const SCOPE_OPTIONS: ReadonlyArray<{ value: TradeScope; label: string }> = [
  { value: 'upcoming', label: 'Confirmed, upcoming' },
  { value: 'past', label: 'Confirmed, already worked' },
  { value: 'open', label: 'Open posts' },
  { value: 'cancelled', label: 'Cancelled' },
  { value: 'all', label: 'Everything' },
]

export function isTradeScope(value: unknown): value is TradeScope {
  return SCOPE_OPTIONS.some((option) => option.value === value)
}

export interface TradePage extends CountedPage<Shift> {
  /** SwapMatch return legs of the listed trades, by id. */
  returnLegs: Map<string, Shift>
}

/** One page of shifts matching the filters, with their SwapMatch return legs. */
export async function queryAdminTrades(
  sb: Sb,
  filters: TradeFilters,
  options: { offset?: number; limit?: number; now?: Date } = {},
): Promise<TradePage> {
  const limit = clampLimit(options.limit, TRADE_PAGE_SIZE, 200)
  const offset = Math.max(0, Math.trunc(options.offset ?? 0))
  const now = nowIso(options.now)

  let query = sb.from('shifts').select('*', { count: 'exact' }).is('return_leg_of', null)
  switch (filters.scope) {
    case 'upcoming':
      query = query.eq('status', 'covered').gt('starts_at', now)
      break
    case 'past':
      query = query.eq('status', 'covered').lte('starts_at', now)
      break
    case 'open':
      query = query.eq('status', 'open').gt('starts_at', now)
      break
    case 'cancelled':
      query = query.eq('status', 'cancelled')
      break
    case 'all':
      break
  }
  if (isYmd(filters.from)) query = query.gte('date', filters.from)
  if (isYmd(filters.to)) query = query.lte('date', filters.to)
  if (typeof filters.station === 'number') query = query.eq('station', filters.station)
  else if (typeof filters.battalion === 'number') query = query.eq('battalion', filters.battalion)
  const member = sanitizeSearch(filters.member)
  if (member) {
    query = query.or([ilikeContains('poster_name', member), ilikeContains('coverer_name', member)].join(','))
  }

  const ascending = filters.scope === 'upcoming' || filters.scope === 'open'
  const { data, count } = await runQuery<Shift[] | null>(
    query
      .order('date', { ascending })
      .order('created_at', { ascending })
      .order('id', { ascending })
      .range(offset, offset + limit - 1),
  )
  const items = Array.isArray(data) ? data : []
  const legIds = items.map((shift) => shift.return_leg_id).filter((id): id is string => Boolean(id))
  const legs = legIds.length ? await getShiftsByIds(sb, legIds) : []
  return { items, total: count ?? items.length, returnLegs: new Map(legs.map((leg) => [leg.id, leg])) }
}

/** Largest export in one go. */
export const EXPORT_LIMIT = 5000

/**
 * Every row matching the filters (up to EXPORT_LIMIT), for the CSV export.
 * Reads 200 at a time.
 */
export async function fetchAllTrades(sb: Sb, filters: TradeFilters, now: Date = new Date()): Promise<TradePage> {
  const items: Shift[] = []
  const returnLegs = new Map<string, Shift>()
  let total = 0
  for (let offset = 0; offset < EXPORT_LIMIT; offset += 200) {
    const page = await queryAdminTrades(sb, filters, { offset, limit: 200, now })
    total = page.total
    items.push(...page.items)
    for (const [id, leg] of page.returnLegs) returnLegs.set(id, leg)
    if (page.items.length < 200 || items.length >= total) break
  }
  return { items, total, returnLegs }
}
