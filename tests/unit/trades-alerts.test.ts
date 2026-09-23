// Helpers behind /alerts (src/app/(app)/alerts/_components/alerts-model.ts).
import { describe, expect, it } from 'vitest'
import type { Notification } from '@/lib/types/database'
import {
  appendPage,
  fullTimestamp,
  markReadLocally,
  mergeNewestPage,
  relativeTime,
  safeAlertUrl,
} from '@/app/(app)/alerts/_components/alerts-model'

function alert(n: number, createdAt: string, overrides: Partial<Notification> = {}): Notification {
  return {
    id: `30000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
    user_id: '00000000-0000-4000-8000-000000000001',
    type: 'request_received',
    title: `Alert ${n}`,
    body: '',
    url: '/trades',
    shift_id: null,
    actor_id: null,
    read_at: null,
    pushed_at: null,
    created_at: createdAt,
    ...overrides,
  }
}

const cursorOf = (n: Notification) => ({ created_at: n.created_at, id: n.id })

describe('relativeTime', () => {
  // 2026-09-23 12:00 Pacific (PDT)
  const now = Date.parse('2026-09-23T19:00:00Z')

  it('uses short relative wording', () => {
    expect(relativeTime('2026-09-23T18:59:30Z', now)).toBe('Just now')
    expect(relativeTime('2026-09-23T18:55:00Z', now)).toBe('5 min ago')
    expect(relativeTime('2026-09-23T16:00:00Z', now)).toBe('3 hr ago')
  })

  it('counts calendar days in Pacific time', () => {
    // 2026-09-22 08:00 Pacific
    expect(relativeTime('2026-09-22T15:00:00Z', now)).toBe('Yesterday')
    expect(relativeTime('2026-09-19T19:00:00Z', now)).toBe('4 days ago')
    expect(relativeTime('2026-09-02T19:00:00Z', now)).toBe('Sep 2')
    expect(relativeTime('2025-12-30T19:00:00Z', now)).toBe('Dec 30, 2025')
  })

  it('never shows negative times or garbage', () => {
    expect(relativeTime('2026-09-23T19:05:00Z', now)).toBe('Just now')
    expect(relativeTime('not a date', now)).toBe('')
  })

  it('formats a full timestamp in Pacific time', () => {
    expect(fullTimestamp('2026-09-23T22:45:00Z')).toBe('Sep 23, 2026, 3:45 PM')
  })
})

describe('safeAlertUrl', () => {
  it('keeps same-origin paths and rejects everything else', () => {
    expect(safeAlertUrl('/trades/abc')).toBe('/trades/abc')
    expect(safeAlertUrl('/board?shift=1')).toBe('/board?shift=1')
    expect(safeAlertUrl('https://evil.example')).toBe('/trades')
    expect(safeAlertUrl('//evil.example/x')).toBe('/trades')
    expect(safeAlertUrl('/\\evil.example')).toBe('/trades')
    expect(safeAlertUrl('javascript:alert(1)')).toBe('/trades')
    expect(safeAlertUrl('')).toBe('/trades')
    expect(safeAlertUrl(null)).toBe('/trades')
  })
})

describe('paging', () => {
  const a = Array.from({ length: 6 }, (_, i) => alert(10 - i, `2026-09-23T1${9 - i}:00:00Z`))
  // a[0] newest … a[5] oldest

  it('replaces everything when the newest page is complete', () => {
    const merged = mergeNewestPage({ items: a.slice(0, 4), cursor: cursorOf(a[3]) }, { items: a.slice(0, 2), nextCursor: null })
    expect(merged.items.map((n) => n.id)).toEqual([a[0].id, a[1].id])
    expect(merged.cursor).toBeNull()
  })

  it('keeps older loaded pages below a refreshed first page', () => {
    const fresh = alert(99, '2026-09-23T20:00:00Z')
    const current = { items: a, cursor: cursorOf(a[5]) }
    // a[1] was deleted elsewhere; a new alert arrived.
    const merged = mergeNewestPage(current, { items: [fresh, a[0], a[2]], nextCursor: cursorOf(a[2]) })
    expect(merged.items.map((n) => n.id)).toEqual([fresh.id, a[0].id, a[2].id, a[3].id, a[4].id, a[5].id])
    expect(merged.cursor).toEqual(cursorOf(a[5]))
  })

  it("uses the page's cursor when nothing older was loaded", () => {
    const merged = mergeNewestPage({ items: [], cursor: null }, { items: a.slice(0, 3), nextCursor: cursorOf(a[2]) })
    expect(merged.items).toHaveLength(3)
    expect(merged.cursor).toEqual(cursorOf(a[2]))
  })

  it('appends older pages without duplicates', () => {
    const next = appendPage({ items: a.slice(0, 3), cursor: cursorOf(a[2]) }, { items: a.slice(2, 5), nextCursor: null })
    expect(next.items.map((n) => n.id)).toEqual(a.slice(0, 5).map((n) => n.id))
    expect(next.cursor).toBeNull()
  })

  it('marks alerts read locally', () => {
    const items = [alert(1, '2026-09-23T10:00:00Z'), alert(2, '2026-09-23T09:00:00Z', { read_at: 'x' })]
    const one = markReadLocally(items, [items[0].id], 'now')
    expect(one[0].read_at).toBe('now')
    expect(one[1].read_at).toBe('x')
    expect(markReadLocally(items, null, 'now').every((n) => n.read_at)).toBe(true)
  })
})
