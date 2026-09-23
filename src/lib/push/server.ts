// Server-side Web Push delivery (ARCHITECTURE §6.5, §9) for POST /api/push/flush.
//
// flushPushQueue() claims never-pushed notifications in batches
// (claim_push_batch, service role), sends each one to every device the member
// registered, deletes subscriptions the push service reports as gone
// (404/410), stamps last_success_at on the ones that worked, and stops when
// the queue is drained or after a time budget (~8 s).
//
// Everything it needs (service-role client, the web-push module, VAPID keys,
// clock, logger) is passed in, so tests run it with fakes. Nothing here logs a
// secret, a key or a full endpoint URL: push endpoints are capability URLs, so
// logs only ever show the push service's host name.
//
// SERVER ONLY. The node:crypto import keeps this out of browser bundles.

import { createHash, timingSafeEqual } from 'node:crypto'
import { claimPushBatch, type Sb } from '@/lib/api'
import type { VapidConfig } from '@/lib/env'
import { AppError, toAppError } from '@/lib/errors'
import type { PushBatchRow } from '@/lib/types/database'

// ---------------------------------------------------------------------------
// Tunables
// ---------------------------------------------------------------------------

/** Notifications claimed per round trip (claim_push_batch caps at 500). */
export const PUSH_BATCH_SIZE = 200
/** Stop claiming new batches after this long (a claimed batch is always finished). */
export const PUSH_TIME_BUDGET_MS = 8_000
/** How long a push service keeps an undelivered alert (1 day). */
export const PUSH_TTL_SECONDS = 86_400
/** Socket timeout for one request to a push service. */
export const PUSH_SEND_TIMEOUT_MS = 5_000
/** Push requests in flight at once. */
export const PUSH_CONCURRENCY = 20

/** Where an alert opens when its link is missing or unsafe (matches public/sw.js). */
export const PUSH_DEFAULT_URL = '/alerts'
const MAX_TITLE_CHARS = 120
// Push payloads must stay under ~4 KB after encryption; 600 characters of body
// is at most ~2.4 KB of UTF-8 even for emoji-heavy chat text.
const MAX_BODY_CHARS = 600
// Ids per PostgREST `in.(…)` filter, to keep request URLs short.
const IN_CHUNK = 100

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** The JSON payload public/sw.js understands (ARCHITECTURE §9). */
export interface PushPayload {
  title: string
  body: string
  /** Same-origin path the alert opens. */
  url: string
  /** Collapses repeats into one alert, e.g. `message:<shiftId>:<senderId>`. */
  tag?: string
}

export interface WebPushSubscription {
  endpoint: string
  keys: { p256dh: string; auth: string }
}

export interface WebPushSendOptions {
  TTL: number
  urgency: 'high'
  timeout?: number
}

/** The parts of the `web-push` module used here (tests pass a fake). */
export interface WebPushClient {
  setVapidDetails(subject: string, publicKey: string, privateKey: string): void
  sendNotification(subscription: WebPushSubscription, payload: string, options: WebPushSendOptions): Promise<unknown>
}

export interface FlushResult {
  /** Notifications claimed from the queue (each is sent at most once). */
  claimed: number
  /** Successful deliveries to a device. */
  sent: number
  /** Deliveries that failed for another reason (push service error, timeout…). */
  failed: number
  /** Subscriptions deleted because the push service said they are gone. */
  removed: number
}

type Logger = Pick<Console, 'info' | 'warn' | 'error'>

export interface FlushOptions {
  /** Service-role Supabase client (createAdminClient()). */
  admin: Sb
  webpush: WebPushClient
  vapid: VapidConfig
  batchSize?: number
  timeBudgetMs?: number
  concurrency?: number
  /** Milliseconds clock for the time budget. */
  now?: () => number
  logger?: Logger
}

interface SubscriptionRow {
  id: string
  user_id: string
  endpoint: string
  p256dh: string
  auth: string
}

interface NotificationMeta {
  id: string
  type: string
  shift_id: string | null
  actor_id: string | null
}

interface QueryResult {
  data: unknown
  error: unknown
  status?: number
}

// ---------------------------------------------------------------------------
// Authorization
// ---------------------------------------------------------------------------

function sha256(value: string): Buffer {
  return createHash('sha256').update(value, 'utf8').digest()
}

/**
 * Constant-time comparison of a provided secret with the configured one.
 * Both are hashed first so their lengths never leak. False when either is blank.
 */
export function secretsMatch(provided: string | null | undefined, expected: string | null | undefined): boolean {
  const a = provided?.trim()
  const b = expected?.trim()
  if (!a || !b) return false
  return timingSafeEqual(sha256(a), sha256(b))
}

export type FlushCaller = 'webhook' | 'member'

export interface AuthorizeFlushInput {
  /** The request's `x-webhook-secret` header. */
  secretHeader: string | null | undefined
  /** PUSH_WEBHOOK_SECRET (the same value is stored in private.app_config). */
  webhookSecret: string | null | undefined
  /** The signed-in user's id from the request cookies, or null. May throw. */
  getUserId: () => Promise<string | null>
}

/**
 * Who may trigger a flush: the database webhook (shared secret header) or any
 * signed-in member (the app calls flush after actions that notify someone).
 * Returns null when neither applies.
 */
export async function authorizeFlush(input: AuthorizeFlushInput): Promise<FlushCaller | null> {
  if (secretsMatch(input.secretHeader, input.webhookSecret)) return 'webhook'
  try {
    return (await input.getUserId()) ? 'member' : null
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// Payloads
// ---------------------------------------------------------------------------

function truncate(text: string, max: number): string {
  const chars = Array.from(text)
  return chars.length <= max ? text : `${chars.slice(0, max - 1).join('')}…`
}

function hasControlChars(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i)
    if (code < 0x20 || code === 0x7f) return true
  }
  return false
}

/** A same-origin path for the alert to open; anything else becomes /alerts. */
export function safePushUrl(url: unknown): string {
  if (typeof url !== 'string') return PUSH_DEFAULT_URL
  const value = url.trim()
  if (!value.startsWith('/') || value.startsWith('//') || value.includes('\\') || hasControlChars(value)) {
    return PUSH_DEFAULT_URL
  }
  return value
}

/** The collapse tag for an alert: chat alerts per (shift, sender); others none. */
export function pushTagFor(meta: Pick<NotificationMeta, 'type' | 'shift_id' | 'actor_id'> | null | undefined): string | undefined {
  if (meta?.type === 'message' && meta.shift_id && meta.actor_id) return `message:${meta.shift_id}:${meta.actor_id}`
  return undefined
}

/** Builds the payload for one claimed notification. */
export function buildPushPayload(row: Pick<PushBatchRow, 'title' | 'body' | 'url'>, tag?: string | null): PushPayload {
  const payload: PushPayload = {
    title: truncate((row.title ?? '').trim() || 'ShiftSwap', MAX_TITLE_CHARS),
    body: truncate((row.body ?? '').trim(), MAX_BODY_CHARS),
    url: safePushUrl(row.url),
  }
  if (tag) payload.tag = tag
  return payload
}

/** The push service's host name, for logs (never the full capability URL). */
export function endpointHost(endpoint: string): string {
  try {
    return new URL(endpoint).host || 'unknown push service'
  } catch {
    return 'unknown push service'
  }
}

/** HTTP status from a web-push error (WebPushError.statusCode), if any. */
export function pushErrorStatus(error: unknown): number | null {
  const status = (error as { statusCode?: unknown } | null)?.statusCode
  return typeof status === 'number' && Number.isFinite(status) ? status : null
}

/** 404 / 410: the subscription expired or was revoked; delete it. */
export function isGoneStatus(status: number | null): boolean {
  return status === 404 || status === 410
}

// ---------------------------------------------------------------------------
// Database helpers (service role)
// ---------------------------------------------------------------------------

function chunks<T>(items: readonly T[], size = IN_CHUNK): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

async function run(query: PromiseLike<QueryResult>): Promise<unknown> {
  let res: QueryResult
  try {
    res = await query
  } catch (err) {
    throw toAppError(err)
  }
  if (res.error) throw toAppError(res.error, { status: res.status })
  return res.data
}

async function loadSubscriptions(admin: Sb, userIds: readonly string[]): Promise<SubscriptionRow[]> {
  const rows: SubscriptionRow[] = []
  for (const ids of chunks(userIds)) {
    const data = await run(admin.from('push_subscriptions').select('id, user_id, endpoint, p256dh, auth').in('user_id', ids))
    if (Array.isArray(data)) rows.push(...(data as SubscriptionRow[]))
  }
  return rows
}

async function loadTags(admin: Sb, notificationIds: readonly string[]): Promise<Map<string, string>> {
  const tags = new Map<string, string>()
  for (const ids of chunks(notificationIds)) {
    const data = await run(admin.from('notifications').select('id, type, shift_id, actor_id').in('id', ids))
    for (const meta of Array.isArray(data) ? (data as NotificationMeta[]) : []) {
      const tag = pushTagFor(meta)
      if (tag) tags.set(meta.id, tag)
    }
  }
  return tags
}

/** Puts claimed notifications back in the queue (after a failure before sending). */
async function releaseClaim(admin: Sb, notificationIds: readonly string[], log: Logger): Promise<void> {
  try {
    for (const ids of chunks(notificationIds)) {
      await run(admin.from('notifications').update({ pushed_at: null }).in('id', ids))
    }
  } catch (err) {
    log.warn(`[push] could not return ${notificationIds.length} alert(s) to the queue: ${toAppError(err).code}`)
  }
}

/** Deletes gone subscriptions; returns how many were deleted. */
async function removeSubscriptions(admin: Sb, ids: readonly string[], log: Logger): Promise<number> {
  let removed = 0
  for (const part of chunks(ids)) {
    try {
      await run(admin.from('push_subscriptions').delete().in('id', part))
      removed += part.length
    } catch (err) {
      log.warn(`[push] could not remove ${part.length} expired subscription(s): ${toAppError(err).code}`)
    }
  }
  return removed
}

async function markDelivered(admin: Sb, ids: readonly string[], log: Logger): Promise<void> {
  if (!ids.length) return
  const at = new Date().toISOString()
  for (const part of chunks(ids)) {
    try {
      await run(admin.from('push_subscriptions').update({ last_success_at: at }).in('id', part))
    } catch (err) {
      log.warn(`[push] could not record delivery time: ${toAppError(err).code}`)
    }
  }
}

// ---------------------------------------------------------------------------
// Delivery
// ---------------------------------------------------------------------------

/** Runs `worker` over `items` with at most `limit` in flight. `worker` must not throw. */
async function runPool<T>(items: readonly T[], limit: number, worker: (item: T) => Promise<void>): Promise<void> {
  let next = 0
  const lanes = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (next < items.length) {
      const item = items[next++]
      await worker(item)
    }
  })
  await Promise.all(lanes)
}

interface BatchOutcome {
  sent: number
  failed: number
  removed: number
}

async function deliverBatch(
  admin: Sb,
  webpush: WebPushClient,
  batch: readonly PushBatchRow[],
  concurrency: number,
  log: Logger,
): Promise<BatchOutcome> {
  const notificationIds = batch.map((row) => row.notification_id)
  const userIds = [...new Set(batch.map((row) => row.user_id))]

  let loaded: [SubscriptionRow[], Map<string, string>]
  try {
    loaded = await Promise.all([
      loadSubscriptions(admin, userIds),
      // Tags are a nicety: send without them rather than fail.
      loadTags(admin, notificationIds).catch(() => new Map<string, string>()),
    ])
  } catch (err) {
    await releaseClaim(admin, notificationIds, log)
    throw err
  }
  const [subscriptions, tags] = loaded

  const byUser = new Map<string, SubscriptionRow[]>()
  for (const sub of subscriptions) {
    const list = byUser.get(sub.user_id)
    if (list) list.push(sub)
    else byUser.set(sub.user_id, [sub])
  }

  const jobs: Array<{ sub: SubscriptionRow; payload: string }> = []
  for (const row of batch) {
    const devices = byUser.get(row.user_id)
    if (!devices?.length) continue
    const payload = JSON.stringify(buildPushPayload(row, tags.get(row.notification_id)))
    for (const sub of devices) jobs.push({ sub, payload })
  }

  const gone = new Set<string>()
  const delivered = new Set<string>()
  const failures = new Map<string, number>()
  let sent = 0
  let failed = 0

  await runPool(jobs, concurrency, async ({ sub, payload }) => {
    if (gone.has(sub.id)) return
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        payload,
        { TTL: PUSH_TTL_SECONDS, urgency: 'high', timeout: PUSH_SEND_TIMEOUT_MS },
      )
      sent++
      delivered.add(sub.id)
    } catch (err) {
      const status = pushErrorStatus(err)
      if (isGoneStatus(status)) {
        gone.add(sub.id)
        return
      }
      failed++
      const key = `${endpointHost(sub.endpoint)} (${status ?? 'no response'})`
      failures.set(key, (failures.get(key) ?? 0) + 1)
    }
  })

  for (const [where, count] of failures) log.warn(`[push] ${count} alert(s) failed at ${where}`)

  const removed = await removeSubscriptions(admin, [...gone], log)
  await markDelivered(admin, [...delivered].filter((id) => !gone.has(id)), log)
  return { sent, failed, removed }
}

/**
 * Sends every pending alert (§6.5): claims batches until the queue is empty,
 * a batch comes back smaller than `batchSize`, or the time budget is spent.
 * A claimed batch is always finished (claimed alerts are marked pushed).
 *
 * Throws AppError when claiming fails, when the subscriptions for a claimed
 * batch can't be loaded (that batch is put back in the queue first), or when
 * the VAPID keys are invalid.
 */
export async function flushPushQueue(options: FlushOptions): Promise<FlushResult> {
  const { admin, webpush, vapid } = options
  const now = options.now ?? Date.now
  const log = options.logger ?? console
  const batchSize = Math.min(Math.max(Math.trunc(options.batchSize ?? PUSH_BATCH_SIZE), 1), 500)
  const budget = options.timeBudgetMs ?? PUSH_TIME_BUDGET_MS
  const concurrency = Math.max(1, Math.trunc(options.concurrency ?? PUSH_CONCURRENCY))

  try {
    webpush.setVapidDetails(vapid.subject, vapid.publicKey, vapid.privateKey)
  } catch {
    // web-push validates the keys; don't echo its message (it can quote the subject).
    throw new AppError('UNKNOWN', 'Push alerts are not set up correctly on the server (check the VAPID keys and subject).')
  }

  const started = now()
  const result: FlushResult = { claimed: 0, sent: 0, failed: 0, removed: 0 }

  for (;;) {
    const batch = await claimPushBatch(admin, batchSize)
    if (!batch.length) break
    result.claimed += batch.length

    const outcome = await deliverBatch(admin, webpush, batch, concurrency, log)
    result.sent += outcome.sent
    result.failed += outcome.failed
    result.removed += outcome.removed

    if (batch.length < batchSize || now() - started >= budget) break
  }

  return result
}
