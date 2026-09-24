// Web Push subscription rows and push delivery helpers (ARCHITECTURE §6.1
// "push_subscriptions", §6.5). Members insert/delete their own rows directly
// (RLS). The browser-side permission/subscribe flow is in src/lib/push/client.ts,
// which stores and removes rows only through the functions here.

import { AppError } from '@/lib/errors'
import type { PushBatchRow } from '@/lib/types/database'
import { callRpc, clampLimit, runMaybe, runVoid, type Sb } from './core'

/** Shown when the database rejects the browser's push service (endpoint check, §9). */
export const PUSH_UNSUPPORTED_MESSAGE = "Alerts aren't supported in this browser. Try Safari, Chrome, Edge or Firefox."

export { PUSH_FLUSH_PATH, requestPushFlush } from './core'

/** What the database needs from a browser PushSubscription. */
export interface PushSubscriptionInput {
  endpoint: string
  /** Base64url P-256 public key (subscription.toJSON().keys.p256dh). */
  p256dh: string
  /** Base64url auth secret (subscription.toJSON().keys.auth). */
  auth: string
  userAgent?: string | null
}

/**
 * Builds the row input from `PushSubscription.toJSON()`; null when the
 * endpoint or keys are missing.
 */
export function pushSubscriptionInput(
  json: { endpoint?: string | null; keys?: Record<string, string | undefined> | null } | null | undefined,
  userAgent?: string | null,
): PushSubscriptionInput | null {
  const endpoint = json?.endpoint?.trim()
  const p256dh = json?.keys?.p256dh?.trim()
  const auth = json?.keys?.auth?.trim()
  if (!endpoint || !p256dh || !auth) return null
  return { endpoint, p256dh, auth, userAgent: userAgent ?? null }
}

/** True for the check-constraint violation (SQLSTATE 23514) the endpoint check raises. */
function isCheckViolation(err: AppError): boolean {
  const cause = err.cause as { code?: unknown } | null | undefined
  return cause?.code === '23514' || /\[23514\]/.test(err.details ?? '')
}

/**
 * Stores this device's push subscription for me. A plain insert: the database
 * replaces any older row for the same endpoint (the device's last signed-in
 * member gets its alerts), and user_id defaults to me. A push service the
 * database doesn't accept (SQLSTATE 23514) throws INVALID_INPUT with
 * PUSH_UNSUPPORTED_MESSAGE.
 */
export async function savePushSubscription(sb: Sb, input: PushSubscriptionInput): Promise<void> {
  try {
    await runVoid(
      sb.from('push_subscriptions').insert({
        endpoint: input.endpoint,
        p256dh: input.p256dh,
        auth: input.auth,
        user_agent: input.userAgent ? input.userAgent.slice(0, 512) : null,
      }),
    )
  } catch (err) {
    // The endpoint check constraint only accepts the browser push services.
    if (err instanceof AppError && err.code === 'INVALID_INPUT' && isCheckViolation(err)) {
      throw new AppError('INVALID_INPUT', PUSH_UNSUPPORTED_MESSAGE, {
        cause: err,
        status: err.status,
        details: err.details,
      })
    }
    throw err
  }
}

/** True for the error savePushSubscription() throws when the browser's push service isn't accepted. */
export function isUnsupportedPushService(error: unknown): boolean {
  return error instanceof AppError && error.code === 'INVALID_INPUT' && error.message === PUSH_UNSUPPORTED_MESSAGE
}

/** True when I already have a stored subscription for this endpoint (RLS: my rows only). */
export async function hasPushSubscription(sb: Sb, endpoint: string): Promise<boolean> {
  if (!endpoint) return false
  const row = await runMaybe<{ id: string }>(
    sb.from('push_subscriptions').select('id').eq('endpoint', endpoint).limit(1).maybeSingle(),
  )
  return row !== null
}

/** Removes my subscription for this device's endpoint (e.g. alerts turned off, sign-out). */
export async function deletePushSubscription(sb: Sb, endpoint: string): Promise<void> {
  if (!endpoint) return
  await runVoid(sb.from('push_subscriptions').delete().eq('endpoint', endpoint))
}

/**
 * SERVICE ROLE ONLY (POST /api/push/flush): atomically claims up to `limit`
 * (default 200, max 500) unread, never-pushed notifications from the last two
 * days and marks them pushed.
 */
export async function claimPushBatch(admin: Sb, limit = 200): Promise<PushBatchRow[]> {
  const rows = await callRpc(admin, 'claim_push_batch', { p_limit: clampLimit(limit, 200, 500) })
  return Array.isArray(rows) ? rows : []
}
