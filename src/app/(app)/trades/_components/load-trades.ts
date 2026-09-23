import {
  getMyLedger,
  getMyStats,
  listIncomingRequests,
  listMyRequests,
  listMyTrades,
  type Sb,
} from '@/lib/api'
import type { TradesData } from './trades-model'

/** Offline snapshot key for the Trades hub (src/lib/offline-cache.ts). */
export const TRADES_SNAPSHOT_KEY = 'trades'

/** Loads every Trades tab at once (so counts are right and the snapshot is complete). */
export async function loadTradesData(sb: Sb, userId: string): Promise<TradesData> {
  const [incoming, cancelRequests, myRequests, openPosts, confirmed, historyShifts, closedRequests, ledger, stats] =
    await Promise.all([
      listIncomingRequests(sb, { userId }),
      listMyTrades(sb, { scope: 'cancel_requests', userId }),
      listMyRequests(sb, { userId, statuses: ['pending'] }),
      listMyTrades(sb, { scope: 'open', userId }),
      listMyTrades(sb, { scope: 'confirmed', userId }),
      listMyTrades(sb, { scope: 'history', userId, limit: 50 }),
      listMyRequests(sb, { userId, statuses: ['declined', 'withdrawn', 'cancelled'], limit: 50 }),
      getMyLedger(sb),
      getMyStats(sb),
    ])
  return {
    incoming,
    cancelRequests,
    myRequests,
    openPosts,
    confirmed,
    historyShifts,
    closedRequests,
    ledger,
    stats,
    loadedAt: new Date().toISOString(),
  }
}
