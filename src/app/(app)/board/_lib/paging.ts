// Board paging (ARCHITECTURE §7.2 "Board": "Load more" by date, created_at, id).
// Two things the plain keyset pages don't do on their own:
//   - "Only shifts I can take" hides some rows on the client (SwapMatch posts
//     whose return dates I can't give), so a page is topped up from the next
//     ones instead of coming back short or empty.
//   - A live refresh reloads everything the member already loaded, not just
//     the first page, so the list doesn't shrink under their thumb (NEXT-04).
// Pure async helpers around a page fetcher, so they are easy to test.

import type { BoardCursor, Page } from '@/lib/api'
import type { Shift } from '@/lib/types/database'

/** Loads one board page after `after` (null = from the start). */
export type BoardPageFetcher = (after: BoardCursor | null, limit: number) => Promise<Page<Shift, BoardCursor>>

/** Rows the list shows; the others still move the cursor along. */
export type BoardRowFilter = (shift: Shift) => boolean

function compareInstant(a: string, b: string): number {
  if (a === b) return 0
  const diff = Date.parse(a) - Date.parse(b)
  if (diff) return Math.sign(diff)
  // Same millisecond: the database's own text (microseconds) decides.
  return a < b ? -1 : 1
}

/** Order of two rows (or cursors) on the board: date, then created_at, then id. */
export function compareBoardPosition(
  a: Pick<BoardCursor, 'date' | 'created_at' | 'id'>,
  b: Pick<BoardCursor, 'date' | 'created_at' | 'id'>,
): number {
  if (a.date !== b.date) return a.date < b.date ? -1 : 1
  const at = compareInstant(a.created_at, b.created_at)
  if (at) return at
  if (a.id === b.id) return 0
  return a.id < b.id ? -1 : 1
}

export interface FillOptions {
  /** Continue after this cursor; null = from the start. */
  after: BoardCursor | null
  /** Stop once this many shown rows have been collected. */
  want: number
  /** Rows per request. */
  pageSize: number
  /** Most requests, so a board full of hidden rows can't keep loading for long. */
  maxPages: number
  keep: BoardRowFilter
}

/**
 * The next page of shown rows: loads pages after `after` until `want` rows
 * pass `keep` or the board ends. `nextCursor` is where "Load more" carries on.
 */
export async function fillPage(fetchPage: BoardPageFetcher, options: FillOptions): Promise<Page<Shift, BoardCursor>> {
  const items: Shift[] = []
  let cursor = options.after
  for (let i = 0; i < Math.max(1, options.maxPages); i++) {
    const page = await fetchPage(cursor, options.pageSize)
    items.push(...page.items.filter(options.keep))
    cursor = page.nextCursor
    if (!cursor || items.length >= options.want) break
  }
  return { items, nextCursor: cursor }
}

export interface ReloadOptions {
  /**
   * The last row already loaded (the list's current nextCursor). Rows after it
   * are left for "Load more". Null = the member had reached the end, so the
   * whole board is reloaded (up to `maxPages`).
   */
  through: BoardCursor | null
  pageSize: number
  maxPages: number
  keep: BoardRowFilter
}

/**
 * How many pages a live refresh reads when the member had reached the end of
 * the list (no `through`): enough for what they had plus `extraRows` of new
 * posts, at least one page and at most `maxPages`.
 */
export function reloadPageBudget(
  shownCount: number,
  options: { pageSize: number; extraRows: number; maxPages: number },
): number {
  const pages = Math.ceil((Math.max(0, shownCount) + options.extraRows) / options.pageSize)
  return Math.min(options.maxPages, Math.max(1, pages))
}

/**
 * Reloads the board from the start through `through`, so a live refresh keeps
 * every page the member loaded. Rows posted meanwhile inside that range show
 * up; rows taken or cancelled meanwhile drop out.
 */
export async function reloadThrough(fetchPage: BoardPageFetcher, options: ReloadOptions): Promise<Page<Shift, BoardCursor>> {
  const { through } = options
  const items: Shift[] = []
  let cursor: BoardCursor | null = null
  for (let i = 0; i < Math.max(1, options.maxPages); i++) {
    const page = await fetchPage(cursor, options.pageSize)
    for (const row of page.items) {
      // Past what the member had loaded: "Load more" carries on from `through`.
      if (through && compareBoardPosition(row, through) > 0) return { items, nextCursor: through }
      if (options.keep(row)) items.push(row)
    }
    cursor = page.nextCursor
    if (!cursor) return { items, nextCursor: null }
    // This page ended exactly at `through` and more rows follow.
    if (through && compareBoardPosition(cursor, through) >= 0) return { items, nextCursor: through }
  }
  return { items, nextCursor: cursor }
}
