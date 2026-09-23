import { describe, expect, it } from 'vitest'
import {
  ADMIN_TRADES_BACK,
  BOARD_BACK,
  TRADES_BACK,
  hasInAppHistory,
  readHistoryFacts,
  tradeBackFallback,
  type HistoryFacts,
} from '@/app/(app)/trades/[id]/_lib/back-nav'

const TRADE = '/trades/10000000-0000-4000-8000-000000000001'

function facts(overrides: Partial<HistoryFacts>): HistoryFacts {
  return { canGoBack: null, historyLength: 3, loadedPath: '/calendar', currentPath: TRADE, ...overrides }
}

describe('hasInAppHistory (UX-09)', () => {
  it('trusts the Navigation API where the browser has it', () => {
    expect(hasInAppHistory(facts({ canGoBack: true, historyLength: 1, loadedPath: TRADE }))).toBe(true)
    expect(hasInAppHistory(facts({ canGoBack: false }))).toBe(false)
  })

  it('otherwise goes back when the app was loaded elsewhere and moved here', () => {
    // Calendar → day sheet → "View trade".
    expect(hasInAppHistory(facts({}))).toBe(true)
  })

  it('uses the fallback when the trade was the first page loaded (alert, link, reload)', () => {
    expect(hasInAppHistory(facts({ loadedPath: TRADE }))).toBe(false)
    expect(hasInAppHistory(facts({ historyLength: 1 }))).toBe(false)
    expect(hasInAppHistory(facts({ loadedPath: null }))).toBe(false)
  })

  it('has nothing to go back to on the server', () => {
    expect(hasInAppHistory(readHistoryFacts())).toBe(false)
  })
})

describe('tradeBackFallback', () => {
  it('sends members in the trade to Trades', () => {
    for (const role of ['poster', 'coverer', 'requester'] as const) {
      expect(tradeBackFallback({ role, open: true, isAdmin: false })).toBe(TRADES_BACK)
    }
  })

  it('sends someone just looking at an open shift to the Board, and admins to Admin trades', () => {
    expect(tradeBackFallback({ role: 'viewer', open: true, isAdmin: false })).toBe(BOARD_BACK)
    expect(tradeBackFallback({ role: 'viewer', open: false, isAdmin: true })).toBe(ADMIN_TRADES_BACK)
    expect(tradeBackFallback({ role: 'viewer', open: false, isAdmin: false })).toBe(TRADES_BACK)
  })
})
