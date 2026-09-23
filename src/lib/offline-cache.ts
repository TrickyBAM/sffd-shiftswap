// Per-user offline snapshots in localStorage (ARCHITECTURE §7.2 "Offline").
//
// Pages save the last good calendar/board/trades data here and show it with an
// "Offline snapshot · updated HH:MM" ribbon when the network fails. Storage can
// be missing (SSR), disabled (Safari private mode) or full — every call is
// wrapped so the cache is best-effort and never throws.

export const OFFLINE_CACHE_VERSION = 1
const PREFIX = `shiftswap:snap:v${OFFLINE_CACHE_VERSION}:`
const ANY_VERSION_PREFIX = 'shiftswap:snap:'

/** Largest serialized snapshot we store (characters ≈ 2 bytes each in localStorage). */
export const MAX_SNAPSHOT_CHARS = 1_000_000

export interface Snapshot<T> {
  data: T
  /** ISO-8601 time the snapshot was saved. */
  savedAt: string
}

interface Envelope<T> {
  v: number
  userId: string
  savedAt: string
  data: T
}

function storage(): Storage | null {
  try {
    const s = (globalThis as { localStorage?: Storage }).localStorage
    return s ?? null
  } catch {
    // Accessing localStorage itself can throw (blocked site data).
    return null
  }
}

function storageKey(key: string, userId: string): string {
  return `${PREFIX}${encodeURIComponent(userId)}:${key}`
}

function isQuotaError(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false
  const { name, message } = err as { name?: unknown; message?: unknown }
  return (
    name === 'QuotaExceededError' ||
    name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
    (typeof message === 'string' && /quota/i.test(message))
  )
}

/**
 * Saves `data` for `userId` under `key`. Returns false (and stores nothing)
 * when storage is unavailable, the data can't be serialized or is too large.
 */
export function saveSnapshot<T>(key: string, userId: string, data: T, now: Date = new Date()): boolean {
  const s = storage()
  if (!s || !key || !userId) return false
  let json: string
  try {
    const envelope: Envelope<T> = { v: OFFLINE_CACHE_VERSION, userId, savedAt: now.toISOString(), data }
    json = JSON.stringify(envelope)
  } catch {
    return false
  }
  if (json.length > MAX_SNAPSHOT_CHARS) return false
  const k = storageKey(key, userId)
  try {
    s.setItem(k, json)
    return true
  } catch (err) {
    if (!isQuotaError(err)) return false
    // Make room by dropping other users' and older-version snapshots, then retry once.
    pruneSnapshots(userId)
    try {
      s.setItem(k, json)
      return true
    } catch {
      return false
    }
  }
}

/** Loads a snapshot saved by the same user, or null. */
export function loadSnapshot<T>(key: string, userId: string): Snapshot<T> | null {
  const s = storage()
  if (!s || !key || !userId) return null
  try {
    const raw = s.getItem(storageKey(key, userId))
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<Envelope<T>>
    if (
      !parsed ||
      parsed.v !== OFFLINE_CACHE_VERSION ||
      parsed.userId !== userId ||
      typeof parsed.savedAt !== 'string' ||
      !('data' in parsed)
    ) {
      return null
    }
    return { data: parsed.data as T, savedAt: parsed.savedAt }
  } catch {
    return null
  }
}

/** Removes one snapshot. */
export function removeSnapshot(key: string, userId: string): void {
  try {
    storage()?.removeItem(storageKey(key, userId))
  } catch {
    // best-effort
  }
}

function snapshotKeys(s: Storage): string[] {
  const keys: string[] = []
  for (let i = 0; i < s.length; i++) {
    const k = s.key(i)
    if (k && k.startsWith(ANY_VERSION_PREFIX)) keys.push(k)
  }
  return keys
}

/**
 * Removes every snapshot (all users, all versions) — call on sign-out so the
 * next person on a shared phone never sees someone else's trades.
 */
export function clearSnapshots(): void {
  const s = storage()
  if (!s) return
  try {
    for (const k of snapshotKeys(s)) s.removeItem(k)
  } catch {
    // best-effort
  }
}

/** Removes snapshots from older cache versions and from users other than `keepUserId`. */
export function pruneSnapshots(keepUserId: string): void {
  const s = storage()
  if (!s) return
  const keep = `${PREFIX}${encodeURIComponent(keepUserId)}:`
  try {
    for (const k of snapshotKeys(s)) if (!k.startsWith(keep)) s.removeItem(k)
  } catch {
    // best-effort
  }
}
