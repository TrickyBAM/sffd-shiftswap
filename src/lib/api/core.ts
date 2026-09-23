// Shared plumbing for the typed API wrappers in src/lib/api (ARCHITECTURE §7.3).
//
// Every wrapper takes a Supabase client as its first argument (browser client,
// server client or service-role client — the same code runs everywhere), calls
// one RPC or runs one read, and either returns typed data or throws an
// AppError (src/lib/errors.ts) whose message is safe to show.

import type { SupabaseClient } from '@supabase/supabase-js'
import { AppError, NETWORK_MESSAGE, toAppError } from '@/lib/errors'
import { isYmd, type Ymd } from '@/lib/sffd/dates'
import type { RpcArgs, RpcName, RpcReturns } from '@/lib/types/database'

/** The Supabase client every API function takes first. */
export type Sb = SupabaseClient

/** What awaiting a supabase-js query or RPC builder resolves to. */
interface QueryResult {
  data: unknown
  error: unknown
  status?: number
  count?: number | null
}

/** A page of rows plus the cursor for the next page (null = no more rows). */
export interface Page<T, C> {
  items: T[]
  nextCursor: C | null
}

/** Rows plus the total number of matching rows (offset pagination). */
export interface CountedPage<T> {
  items: T[]
  total: number
}

export interface CallOptions {
  /**
   * Ask the server to deliver push alerts right after a successful call
   * (for RPCs that create notifications, §6.5). Browser only; fire-and-forget.
   */
  flush?: boolean
}

/**
 * Calls an RPC with its exact SQL argument names and returns its typed result.
 * Throws AppError (with the RPC's friendly message and hint code on rule failures).
 */
export async function callRpc<F extends RpcName>(
  sb: Sb,
  fn: F,
  args: RpcArgs<F>,
  options: CallOptions = {},
): Promise<RpcReturns<F>> {
  let res: QueryResult
  try {
    res = await sb.rpc(fn, args)
  } catch (err) {
    throw toAppError(err)
  }
  if (res.error) throw toAppError(res.error, { status: res.status })
  if (options.flush) requestPushFlush()
  return (res.data ?? null) as RpcReturns<F>
}

/**
 * Awaits a supabase-js query builder and returns its data and count, or throws
 * AppError. `T` is the caller's promise about the row shape.
 */
export async function runQuery<T>(query: PromiseLike<QueryResult>): Promise<{ data: T; count: number | null }> {
  let res: QueryResult
  try {
    res = await query
  } catch (err) {
    throw toAppError(err)
  }
  if (res.error) throw toAppError(res.error, { status: res.status })
  return { data: res.data as T, count: res.count ?? null }
}

/** runQuery for list reads: always an array (an empty body counts as no rows). */
export async function runList<T>(query: PromiseLike<QueryResult>): Promise<T[]> {
  const { data } = await runQuery<T[] | null>(query)
  return Array.isArray(data) ? data : []
}

/** runQuery for `.maybeSingle()` reads: the row or null. */
export async function runMaybe<T>(query: PromiseLike<QueryResult>): Promise<T | null> {
  const { data } = await runQuery<T | null>(query)
  return data ?? null
}

/** runQuery for writes and head-only reads where no data is needed. */
export async function runVoid(query: PromiseLike<QueryResult>): Promise<void> {
  await runQuery<unknown>(query)
}

/**
 * The signed-in user's id: `userId` when the caller already knows it (saves a
 * round trip), otherwise from the verified session (auth.getClaims()).
 * Throws AppError NOT_SIGNED_IN when there is no session.
 */
export async function resolveUserId(sb: Sb, userId?: string | null): Promise<string> {
  if (userId) {
    assertUuid(userId, 'user')
    return userId
  }
  let res: Awaited<ReturnType<Sb['auth']['getClaims']>>
  try {
    res = await sb.auth.getClaims()
  } catch (err) {
    throw sessionCheckError(err)
  }
  if (res.error) throw sessionCheckError(res.error)
  const sub = res.data?.claims?.sub
  if (typeof sub !== 'string' || !sub) throw new AppError('NOT_SIGNED_IN', 'Please sign in again.')
  return sub
}

/**
 * What a failed session check means. An Auth outage (no connection, 5xx, a
 * timeout) must never look like "signed out" — the layouts show an error
 * screen with Try again instead of bouncing the member to /login (§7.1, §9).
 * Only a 4xx answer from Auth or an auth-js "no/unusable session" error means
 * the session is really gone.
 */
export function sessionCheckError(error: unknown): AppError {
  const appError = toAppError(error)
  if (appError.code === 'NOT_SIGNED_IN' || appError.code === 'NETWORK') return appError
  const status = appError.status
  if (status !== null && status >= 500) {
    // An Auth server error is an outage, not a verdict on the session.
    return new AppError('NETWORK', NETWORK_MESSAGE, { cause: error, status, details: appError.details })
  }
  // Too many requests / timed out: try again later, the session may be fine.
  if (status === 408 || status === 429) return appError
  if (status !== null && status >= 400) {
    return new AppError('NOT_SIGNED_IN', 'Please sign in again.', { cause: error, status, details: appError.details })
  }
  const name = typeof (error as { name?: unknown } | null)?.name === 'string' ? (error as { name: string }).name : ''
  if (/^Auth\w*Error$/.test(name) && name !== 'AuthUnknownError' && name !== 'AuthRetryableFetchError') {
    // auth-js rejected the stored session itself (bad or missing token).
    return new AppError('NOT_SIGNED_IN', 'Please sign in again.', { cause: error, details: appError.details })
  }
  // Anything else (a bug, an unexpected response): not "signed out" either.
  return appError
}

// ---------------------------------------------------------------------------
// Input checks. Values interpolated into PostgREST filter strings are checked
// here first, so a bad id can never change a filter's meaning.
// ---------------------------------------------------------------------------

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_RE.test(value)
}

/** Throws AppError INVALID_INPUT unless `value` is a uuid. */
export function assertUuid(value: unknown, what = 'item'): string {
  if (!isUuid(value)) throw new AppError('INVALID_INPUT', `That ${what} link isn't valid.`)
  return value
}

/** Throws AppError INVALID_INPUT unless `value` is a real 'YYYY-MM-DD' date. */
export function assertDate(value: unknown, what = 'date'): Ymd {
  if (!isYmd(value)) throw new AppError('INVALID_INPUT', `Choose a valid ${what}.`)
  return value
}

/** Throws AppError INVALID_INPUT unless `value` is an integer. */
export function assertInt(value: unknown, what = 'number'): number {
  if (typeof value !== 'number' || !Number.isInteger(value)) throw new AppError('INVALID_INPUT', `Choose a valid ${what}.`)
  return value
}

/** Clamps a page size to 1…max (default when missing or invalid). */
export function clampLimit(limit: number | null | undefined, fallback: number, max = 200): number {
  if (typeof limit !== 'number' || !Number.isFinite(limit)) return fallback
  return Math.min(Math.max(Math.trunc(limit), 1), max)
}

/** Trims text; null when blank. */
export function blankToNull(value: string | null | undefined): string | null {
  const text = value?.trim()
  return text ? text : null
}

/**
 * Quotes a value for use inside a PostgREST logic filter (`or=(…)`), where
 * commas, periods, colons and parentheses are reserved.
 */
export function quoteFilterValue(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

/**
 * Cleans free-text search input for an `ilike` pattern: drops LIKE wildcards
 * and filter syntax, collapses whitespace, caps the length. '' when nothing is left.
 */
export function sanitizeSearch(input: string | null | undefined, maxLength = 60): string {
  return (input ?? '')
    .replace(/[%_*\\"(),:]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength)
    .trim()
}

/** An `ilike` "contains" condition for an `or=(…)` list: `col.ilike."%text%"`. */
export function ilikeContains(column: string, search: string): string {
  return `${column}.ilike.${quoteFilterValue(`%${search}%`)}`
}

/** The current instant as an ISO string (for `starts_at` comparisons). */
export function nowIso(now: Date = new Date()): string {
  return now.toISOString()
}

// ---------------------------------------------------------------------------
// Push flush (§6.5): after an RPC that created notifications, the client asks
// POST /api/push/flush to deliver them, so alerts go out even when the
// database webhook isn't configured. Coalesced, fire-and-forget, browser only.
// ---------------------------------------------------------------------------

export const PUSH_FLUSH_PATH = '/api/push/flush'
const FLUSH_DELAY_MS = 400

let flushTimer: ReturnType<typeof setTimeout> | null = null

/**
 * Ask the server to send pending push alerts now. Calls within a short window
 * are merged into one request. Does nothing on the server; never throws.
 */
export function requestPushFlush(): void {
  if (typeof window === 'undefined' || typeof fetch !== 'function' || flushTimer) return
  flushTimer = setTimeout(() => {
    flushTimer = null
    try {
      fetch(PUSH_FLUSH_PATH, { method: 'POST', credentials: 'same-origin', keepalive: true }).catch(() => {
        // Best effort: the next flush (or the database webhook) delivers them.
      })
    } catch {
      // fetch unavailable or blocked: nothing to do.
    }
  }, FLUSH_DELAY_MS)
}
