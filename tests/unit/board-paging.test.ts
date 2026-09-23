import { describe, expect, it } from 'vitest'
import { boardCursorOf, type BoardCursor } from '@/lib/api'
import { addDays } from '@/lib/sffd/dates'
import type { Shift } from '@/lib/types/database'
import {
  compareBoardPosition,
  fillPage,
  reloadPageBudget,
  reloadThrough,
  type BoardPageFetcher,
} from '@/app/(app)/board/_lib/paging'

function row(n: number, overrides: Partial<Shift> = {}): Shift {
  const id = `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`
  return {
    id,
    poster_id: '00000000-0000-4000-8000-000000000009',
    poster_name: 'Mike Lee',
    rank: 'Firefighter',
    station: 19,
    battalion: 9,
    division: 3,
    // Three shifts a day, in id order.
    date: addDays('2026-10-01', Math.floor(n / 3)),
    shift_type: '24-Hour',
    hours: 24,
    starts_at: '2026-10-01T15:00:00Z',
    status: 'open',
    return_dates: [],
    accept_limit: 'anyone',
    notes: null,
    coverer_id: null,
    coverer_name: null,
    confirmed_at: null,
    return_leg_of: null,
    return_leg_id: null,
    cancel_requested_by: null,
    cancel_requested_at: null,
    cancel_reason: null,
    cancelled_at: null,
    cancelled_by: null,
    cancel_note: null,
    created_at: `2026-09-20T18:00:${String(n % 60).padStart(2, '0')}.000000+00:00`,
    updated_at: '2026-09-20T18:00:00Z',
    ...overrides,
  }
}

/** A fake listBoardShifts over `rows` (keyset pages, like the real one). */
function board(rows: Shift[]): { fetchPage: BoardPageFetcher; calls: number[] } {
  const sorted = [...rows].sort(compareBoardPosition)
  const calls: number[] = []
  const fetchPage: BoardPageFetcher = async (after, limit) => {
    calls.push(limit)
    const rest = after ? sorted.filter((r) => compareBoardPosition(r, after) > 0) : sorted
    const items = rest.slice(0, limit)
    const last = items[items.length - 1]
    return { items, nextCursor: rest.length > limit && last ? boardCursorOf(last) : null }
  }
  return { fetchPage, calls }
}

const ids = (items: Shift[]) => items.map((s) => Number(s.id.slice(-12)))
const all = () => true

describe('compareBoardPosition', () => {
  it('orders by date, then created_at, then id', () => {
    const a = row(1)
    expect(compareBoardPosition(a, a)).toBe(0)
    expect(compareBoardPosition(a, row(1, { date: '2026-10-02' }))).toBe(-1)
    expect(compareBoardPosition(a, { ...a, created_at: '2026-09-20T18:00:02+00:00' })).toBe(-1)
    // Same millisecond, more microseconds.
    expect(compareBoardPosition({ ...a, created_at: '2026-09-20T18:00:01.000001+00:00' }, { ...a, created_at: '2026-09-20T18:00:01.000002+00:00' })).toBe(-1)
    expect(compareBoardPosition(a, { ...a, id: '10000000-0000-4000-8000-ffffffffffff' })).toBe(-1)
  })
})

describe('fillPage (TF-3: hidden SwapMatch rows)', () => {
  const rows = Array.from({ length: 30 }, (_, i) => row(i))

  it('returns one page and where to carry on', async () => {
    const { fetchPage, calls } = board(rows)
    const page = await fillPage(fetchPage, { after: null, want: 10, pageSize: 10, maxPages: 5, keep: all })
    expect(ids(page.items)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9])
    expect(page.nextCursor).toEqual(boardCursorOf(rows[9]))
    expect(calls).toEqual([10])
  })

  it('tops a page up when rows are hidden, so it isn’t short or empty', async () => {
    const { fetchPage, calls } = board(rows)
    const odd = (s: Shift) => Number(s.id.slice(-12)) % 2 === 1
    const page = await fillPage(fetchPage, { after: null, want: 10, pageSize: 10, maxPages: 5, keep: odd })
    expect(ids(page.items)).toEqual([1, 3, 5, 7, 9, 11, 13, 15, 17, 19])
    expect(calls).toHaveLength(2)
    // "Load more" continues after the last row read, hidden or not.
    const next = await fillPage(fetchPage, { after: page.nextCursor, want: 10, pageSize: 10, maxPages: 5, keep: odd })
    expect(ids(next.items)).toEqual([21, 23, 25, 27, 29])
    expect(next.nextCursor).toBeNull()
  })

  it('stops after maxPages and still offers "Load more"', async () => {
    const { fetchPage, calls } = board(rows)
    const page = await fillPage(fetchPage, { after: null, want: 10, pageSize: 5, maxPages: 2, keep: () => false })
    expect(page.items).toEqual([])
    expect(page.nextCursor).toEqual(boardCursorOf(rows[9]))
    expect(calls).toHaveLength(2)
  })
})

describe('reloadThrough (NEXT-04: live refresh keeps loaded pages)', () => {
  const rows = Array.from({ length: 150 }, (_, i) => row(i))

  it('reloads everything already loaded, past one page of 100', async () => {
    const { fetchPage } = board(rows)
    const through: BoardCursor = boardCursorOf(rows[119])
    const page = await reloadThrough(fetchPage, { through, pageSize: 100, maxPages: 10, keep: all })
    expect(page.items).toHaveLength(120)
    expect(ids(page.items).at(-1)).toBe(119)
    expect(page.nextCursor).toEqual(through)
    // "Load more" carries on right after it: nothing skipped, nothing repeated.
    const more = await fillPage(fetchPage, { after: page.nextCursor, want: 20, pageSize: 20, maxPages: 1, keep: all })
    expect(ids(more.items)).toEqual(Array.from({ length: 20 }, (_, i) => 120 + i))
  })

  it('picks up new posts inside the loaded range and drops taken ones', async () => {
    const through = boardCursorOf(rows[39])
    const changed = [...rows.filter((r) => Number(r.id.slice(-12)) !== 5), row(500, { date: '2026-10-02' })]
    const { fetchPage } = board(changed)
    const page = await reloadThrough(fetchPage, { through, pageSize: 100, maxPages: 10, keep: all })
    expect(ids(page.items)).not.toContain(5)
    expect(ids(page.items)).toContain(500)
    expect(page.items).toHaveLength(40)
    expect(page.nextCursor).toEqual(through)
  })

  it('stops without an extra request when a page ends exactly at the last loaded row', async () => {
    const { fetchPage, calls } = board(rows)
    const through = boardCursorOf(rows[99])
    const page = await reloadThrough(fetchPage, { through, pageSize: 100, maxPages: 10, keep: all })
    expect(page.items).toHaveLength(100)
    expect(page.nextCursor).toEqual(through)
    expect(calls).toEqual([100])
  })

  it('reloads the whole board when the member had reached the end', async () => {
    const { fetchPage } = board(rows)
    const page = await reloadThrough(fetchPage, { through: null, pageSize: 100, maxPages: 10, keep: all })
    expect(page.items).toHaveLength(150)
    expect(page.nextCursor).toBeNull()
  })

  it('applies the same hidden-row filter', async () => {
    const { fetchPage } = board(rows)
    const page = await reloadThrough(fetchPage, {
      through: boardCursorOf(rows[19]),
      pageSize: 100,
      maxPages: 10,
      keep: (s) => Number(s.id.slice(-12)) < 10,
    })
    expect(ids(page.items)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9])
    expect(page.nextCursor).toEqual(boardCursorOf(rows[19]))
  })
})

describe('reloadPageBudget', () => {
  it('reads what the member had plus a page of new posts, within limits', () => {
    const options = { pageSize: 100, extraRows: 20, maxPages: 10 }
    expect(reloadPageBudget(0, options)).toBe(1)
    expect(reloadPageBudget(15, options)).toBe(1)
    expect(reloadPageBudget(90, options)).toBe(2)
    expect(reloadPageBudget(250, options)).toBe(3)
    expect(reloadPageBudget(5000, options)).toBe(10)
  })
})
