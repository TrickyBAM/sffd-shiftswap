import {
  getMyLedger,
  getMyStats,
  listIncomingRequests,
  listMyRequests,
  listMyTrades,
  listUndoneTrades,
  type Sb,
  type UndoneTrade,
} from '@/lib/api'
import type { TradesData } from './trades-model'

/** Offline snapshot key for the Trades hub (src/lib/offline-cache.ts). */
export const TRADES_SNAPSHOT_KEY = 'trades'

/** Loads every Trades tab at once (so counts are right and the snapshot is complete). */
export async function loadTradesData(sb: Sb, userId: string): Promise<TradesData> {
  const [incoming, cancelRequests, myRequests, openPosts, confirmed, historyShifts, closedRequests, undone, ledger, stats] =
    await Promise.all([
      listIncomingRequests(sb, { userId }),
      listMyTrades(sb, { scope: 'cancel_requests', userId }),
      listMyRequests(sb, { userId, statuses: ['pending'] }),
      listMyTrades(sb, { scope: 'open', userId }),
      listMyTrades(sb, { scope: 'confirmed', userId }),
      listMyTrades(sb, { scope: 'history', userId, limit: 50 }),
      listMyRequests(sb, { userId, statuses: ['declined', 'withdrawn', 'cancelled'], limit: 50 }),
      // Undone trades only add History rows (TF-4): if that read fails, the
      // rest of the hub still loads and History shows the requests as closed.
      listUndoneTrades(sb, { userId, limit: 50 }).catch((): UndoneTrade[] => []),
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
    undone,
    ledger,
    stats,
    loadedAt: new Date().toISOString(),
  }
}
