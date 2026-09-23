// The trade page's back arrow (UX-09). A trade is opened from many places:
// the calendar's day sheet (with ?month= in its URL), the Board, Trades,
// Alerts, Admin › Trades. When the member got here inside the app, Back goes
// back in history so they land where they were. When there is no in-app page
// to go back to (opened from an alert, a shared link or after a reload), it
// goes to a sensible page for who is looking.

export interface BackTarget {
  href: string
  /** Accessible name of the back arrow. */
  label: string
}

export const TRADES_BACK: BackTarget = { href: '/trades', label: 'Back to Trades' }
export const BOARD_BACK: BackTarget = { href: '/board', label: 'Back to the Board' }
export const ADMIN_TRADES_BACK: BackTarget = { href: '/admin/trades', label: 'Back to Admin trades' }

/** Accessible name when Back goes to the previous page in the app. */
export const HISTORY_BACK_LABEL = 'Back'

/**
 * Where Back goes when there's no in-app history: Trades for anyone in the
 * trade (poster, coverer, requester), the Board for an open shift they're only
 * looking at, Admin › Trades for an admin looking at someone else's trade.
 */
export function tradeBackFallback(options: {
  role: 'poster' | 'coverer' | 'requester' | 'viewer'
  open: boolean
  isAdmin: boolean
}): BackTarget {
  if (options.role !== 'viewer') return TRADES_BACK
  if (options.open) return BOARD_BACK
  return options.isAdmin ? ADMIN_TRADES_BACK : TRADES_BACK
}

export interface HistoryFacts {
  /** navigation.canGoBack where the browser has the Navigation API, else null. */
  canGoBack: boolean | null
  /** window.history.length */
  historyLength: number
  /** Path this document was first loaded at (the navigation timing entry), if known. */
  loadedPath: string | null
  /** window.location.pathname */
  currentPath: string
}

/**
 * True when going back in history stays inside the app. The Navigation API
 * answers that directly (it only counts same-site entries). Without it: the
 * app was loaded at another path and has moved here since, so the entry before
 * this one is an app page.
 */
export function hasInAppHistory(facts: HistoryFacts): boolean {
  if (facts.canGoBack != null) return facts.canGoBack
  if (facts.historyLength < 2 || !facts.loadedPath) return false
  return facts.loadedPath !== facts.currentPath
}

/** The browser's history facts (safe on the server: nothing to go back to). */
export function readHistoryFacts(): HistoryFacts {
  if (typeof window === 'undefined') {
    return { canGoBack: false, historyLength: 0, loadedPath: null, currentPath: '' }
  }
  const nav = (window as unknown as { navigation?: { canGoBack?: unknown } }).navigation
  let loadedPath: string | null = null
  try {
    const entry = performance.getEntriesByType('navigation')[0]
    if (entry?.name) loadedPath = new URL(entry.name, window.location.href).pathname
  } catch {
    loadedPath = null
  }
  return {
    canGoBack: typeof nav?.canGoBack === 'boolean' ? nav.canGoBack : null,
    historyLength: window.history.length,
    loadedPath,
    currentPath: window.location.pathname,
  }
}
