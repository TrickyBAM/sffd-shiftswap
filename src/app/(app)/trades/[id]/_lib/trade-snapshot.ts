// Offline snapshots of recently viewed trades (ARCHITECTURE §7.2 "Offline"):
// the trade and the partner's contact card, so a member can still see who's
// working and how to reach them when the connection drops. One localStorage
// entry per member holding the most recent few trades (src/lib/offline-cache,
// cleared on sign-out).

import type { TradeDetail } from '@/lib/api'
import { loadSnapshot, saveSnapshot } from '@/lib/offline-cache'
import type { TradeContact } from '@/lib/types/database'

export const TRADE_SNAPSHOT_KEY = 'trade-details'
/** How many trades are kept. */
export const MAX_TRADE_SNAPSHOTS = 8

export interface TradeSnapshotEntry {
  detail: TradeDetail
  contacts: TradeContact[]
  /** ISO time it was saved. */
  savedAt: string
}

type SnapshotMap = Record<string, TradeSnapshotEntry>

function isEntry(value: unknown): value is TradeSnapshotEntry {
  const v = value as Partial<TradeSnapshotEntry> | null
  return Boolean(
    v &&
      typeof v.savedAt === 'string' &&
      Array.isArray(v.contacts) &&
      v.detail &&
      typeof v.detail === 'object' &&
      v.detail.shift &&
      Array.isArray(v.detail.requests),
  )
}

function readMap(userId: string): SnapshotMap {
  const snap = loadSnapshot<unknown>(TRADE_SNAPSHOT_KEY, userId)
  const data = snap?.data
  if (!data || typeof data !== 'object' || Array.isArray(data)) return {}
  const out: SnapshotMap = {}
  for (const [id, entry] of Object.entries(data as Record<string, unknown>)) if (isEntry(entry)) out[id] = entry
  return out
}

/** Keeps `entry` for trade `id` (the id in the URL), dropping the oldest beyond the limit. */
export function saveTradeSnapshot(userId: string, id: string, entry: Omit<TradeSnapshotEntry, 'savedAt'>, now: Date = new Date()): void {
  const map = readMap(userId)
  map[id] = { ...entry, savedAt: now.toISOString() }
  const kept = Object.entries(map)
    .sort(([, a], [, b]) => Date.parse(b.savedAt) - Date.parse(a.savedAt))
    .slice(0, MAX_TRADE_SNAPSHOTS)
  saveSnapshot<SnapshotMap>(TRADE_SNAPSHOT_KEY, userId, Object.fromEntries(kept), now)
}

/** The saved snapshot of trade `id`, or null. */
export function loadTradeSnapshot(userId: string, id: string): TradeSnapshotEntry | null {
  return readMap(userId)[id] ?? null
}
