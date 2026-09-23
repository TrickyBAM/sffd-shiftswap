// Web Push subscription rows and push delivery helpers (ARCHITECTURE §6.1
// "push_subscriptions", §6.5). Members insert/delete their own rows directly
// (RLS). The browser-side permission/subscribe flow is in src/lib/push/client.ts.

import { AppError } from '@/lib/errors'
import type { PushBatchRow, PushSubscriptionRow } from '@/lib/types/database'
import { callRpc, clampLimit, runList, runVoid, type Sb } from './core'

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

/**
 * Stores this device's push subscription for me. A plain insert: the database
 * replaces any older row for the same endpoint (the device's last signed-in
 * member gets its alerts), and user_id defaults to me.
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
    if (err instanceof AppError && err.code === 'INVALID_INPUT') {
      throw new AppError('INVALID_INPUT', "This browser's alert service isn't supported. Try Safari, Chrome, Edge or Firefox.", {
        cause: err,
        status: err.status,
        details: err.details,
      })
    }
    throw err
  }
}

/** Removes my subscription for this device's endpoint (e.g. alerts turned off, sign-out). */
export async function deletePushSubscription(sb: Sb, endpoint: string): Promise<void> {
  if (!endpoint) return
  await runVoid(sb.from('push_subscriptions').delete().eq('endpoint', endpoint))
}

/** My stored push subscriptions (one per device), newest first. */
export async function listMyPushSubscriptions(sb: Sb): Promise<PushSubscriptionRow[]> {
  return runList<PushSubscriptionRow>(
    sb.from('push_subscriptions').select('*').order('created_at', { ascending: false }),
  )
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
