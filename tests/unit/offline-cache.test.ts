import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  clearSnapshots,
  loadSnapshot,
  MAX_SNAPSHOT_CHARS,
  pruneSnapshots,
  removeSnapshot,
  saveSnapshot,
} from '@/lib/offline-cache'

/** Minimal in-memory Storage with an optional quota (in characters). */
class MemoryStorage {
  private map = new Map<string, string>()
  constructor(private quota = Infinity) {}
  get length() {
    return this.map.size
  }
  clear() {
    this.map.clear()
  }
  getItem(key: string) {
    return this.map.has(key) ? this.map.get(key)! : null
  }
  key(index: number) {
    return [...this.map.keys()][index] ?? null
  }
  removeItem(key: string) {
    this.map.delete(key)
  }
  setItem(key: string, value: string) {
    const used = [...this.map.entries()].reduce((n, [k, v]) => (k === key ? n : n + v.length), 0)
    if (used + value.length > this.quota) {
      const err = new Error('The quota has been exceeded.')
      err.name = 'QuotaExceededError'
      throw err
    }
    this.map.set(key, String(value))
  }
  keys() {
    return [...this.map.keys()]
  }
}

let store: MemoryStorage

beforeEach(() => {
  store = new MemoryStorage()
  vi.stubGlobal('localStorage', store)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('offline snapshots', () => {
  it('round-trips data with the save time', () => {
    const now = new Date('2026-09-23T22:45:00Z')
    expect(saveSnapshot('calendar:2026-09', 'user-1', { days: [1, 2, 3] }, now)).toBe(true)
    expect(loadSnapshot('calendar:2026-09', 'user-1')).toEqual({
      data: { days: [1, 2, 3] },
      savedAt: '2026-09-23T22:45:00.000Z',
    })
    // Stored under a versioned, per-user key.
    expect(store.keys()).toEqual(['shiftswap:snap:v1:user-1:calendar:2026-09'])
  })

  it('never returns another user’s snapshot', () => {
    saveSnapshot('board', 'user-1', ['a'])
    expect(loadSnapshot('board', 'user-2')).toBeNull()
    // Even if the key were forged, the envelope's userId must match.
    const key = 'shiftswap:snap:v1:user-2:board'
    store.setItem(key, store.getItem('shiftswap:snap:v1:user-1:board')!)
    expect(loadSnapshot('board', 'user-2')).toBeNull()
  })

  it('ignores missing, corrupt and old-version entries', () => {
    expect(loadSnapshot('nothing', 'user-1')).toBeNull()
    store.setItem('shiftswap:snap:v1:user-1:bad', '{not json')
    expect(loadSnapshot('bad', 'user-1')).toBeNull()
    store.setItem('shiftswap:snap:v1:user-1:old', JSON.stringify({ v: 0, userId: 'user-1', savedAt: 'x', data: 1 }))
    expect(loadSnapshot('old', 'user-1')).toBeNull()
  })

  it('refuses oversized snapshots', () => {
    expect(saveSnapshot('big', 'user-1', 'x'.repeat(MAX_SNAPSHOT_CHARS))).toBe(false)
    expect(store.length).toBe(0)
  })

  it('refuses unserialisable data', () => {
    const cyclic: Record<string, unknown> = {}
    cyclic.self = cyclic
    expect(saveSnapshot('cyclic', 'user-1', cyclic)).toBe(false)
    expect(saveSnapshot('big', 'user-1', BigInt(1))).toBe(false)
  })

  it('frees space from other users when the quota is hit, then retries', () => {
    store = new MemoryStorage(400)
    vi.stubGlobal('localStorage', store)
    expect(saveSnapshot('board', 'someone-else', 'y'.repeat(250))).toBe(true)
    expect(saveSnapshot('board', 'user-1', 'z'.repeat(250))).toBe(true)
    expect(loadSnapshot('board', 'someone-else')).toBeNull()
    expect(loadSnapshot<string>('board', 'user-1')?.data).toHaveLength(250)
    // Still too big on its own → false, no throw.
    expect(saveSnapshot('trades', 'user-1', 'q'.repeat(500))).toBe(false)
  })

  it('remove / prune / clear', () => {
    saveSnapshot('a', 'user-1', 1)
    saveSnapshot('b', 'user-1', 2)
    saveSnapshot('a', 'user-2', 3)
    store.setItem('shiftswap:snap:v0:user-1:a', 'legacy')
    store.setItem('unrelated', 'keep me')
    removeSnapshot('b', 'user-1')
    expect(loadSnapshot('b', 'user-1')).toBeNull()
    pruneSnapshots('user-1')
    expect(store.keys().sort()).toEqual(['shiftswap:snap:v1:user-1:a', 'unrelated'])
    clearSnapshots()
    expect(store.keys()).toEqual(['unrelated'])
  })

  it('is a no-op without storage, or when storage throws', () => {
    vi.stubGlobal('localStorage', undefined)
    expect(saveSnapshot('a', 'user-1', 1)).toBe(false)
    expect(loadSnapshot('a', 'user-1')).toBeNull()
    expect(() => clearSnapshots()).not.toThrow()

    const throwing = {
      get length() {
        throw new Error('SecurityError')
      },
      getItem() {
        throw new Error('SecurityError')
      },
      setItem() {
        throw new Error('SecurityError')
      },
      removeItem() {
        throw new Error('SecurityError')
      },
      key() {
        throw new Error('SecurityError')
      },
      clear() {},
    }
    vi.stubGlobal('localStorage', throwing)
    expect(saveSnapshot('a', 'user-1', 1)).toBe(false)
    expect(loadSnapshot('a', 'user-1')).toBeNull()
    expect(() => removeSnapshot('a', 'user-1')).not.toThrow()
    expect(() => pruneSnapshots('user-1')).not.toThrow()
    expect(() => clearSnapshots()).not.toThrow()
  })

  it('requires a key and user id', () => {
    expect(saveSnapshot('', 'user-1', 1)).toBe(false)
    expect(saveSnapshot('a', '', 1)).toBe(false)
    expect(loadSnapshot('', 'user-1')).toBeNull()
  })
})
