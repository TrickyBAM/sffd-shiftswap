// The /admin/trades filters and how they map onto listAdminShifts() in
// src/lib/api/admin.ts (the one admin shift query, CC-5). Only original legs
// are listed; a SwapMatch return leg is shown with the trade it belongs to.

import { listAdminShifts, type AdminShiftPage, type AdminShiftScope, type ListAdminShiftsOptions, type Sb } from '@/lib/api'
import { isYmd } from '@/lib/sffd/dates'
import type { Shift } from '@/lib/types/database'

export type TradeScope = AdminShiftScope

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

/**
 * listAdminShifts() options for the filters and page. A half-typed or empty
 * date means "no limit"; a station wins over its battalion.
 */
export function tradeListOptions(
  filters: TradeFilters,
  page: { offset?: number; limit?: number; now?: Date } = {},
): ListAdminShiftsOptions {
  const station = typeof filters.station === 'number' ? filters.station : null
  return {
    scope: filters.scope,
    withReturnLegs: true,
    from: isYmd(filters.from) ? filters.from : null,
    to: isYmd(filters.to) ? filters.to : null,
    station,
    battalion: station === null && typeof filters.battalion === 'number' ? filters.battalion : null,
    member: filters.member,
    offset: page.offset ?? 0,
    limit: page.limit ?? TRADE_PAGE_SIZE,
    now: page.now,
  }
}

/** Largest export in one go. */
export const EXPORT_LIMIT = 5000

/**
 * Every row matching the filters (up to EXPORT_LIMIT), with their SwapMatch
 * return legs, for the CSV export. Reads 200 at a time.
 */
export async function fetchAllTrades(sb: Sb, filters: TradeFilters, now: Date = new Date()): Promise<AdminShiftPage> {
  const items: Shift[] = []
  const returnLegs = new Map<string, Shift>()
  let total = 0
  for (let offset = 0; offset < EXPORT_LIMIT; offset += 200) {
    const page = await listAdminShifts(sb, tradeListOptions(filters, { offset, limit: 200, now }))
    total = page.total
    items.push(...page.items)
    for (const [id, leg] of page.returnLegs) returnLegs.set(id, leg)
    if (page.items.length < 200 || items.length >= total) break
  }
  return { items, total, returnLegs }
}
