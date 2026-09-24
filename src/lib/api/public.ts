// Endpoints that work without a member session (ARCHITECTURE §6.3 "Public")
// and the server-only sign-up rate limit. Used by route handlers:
// /api/keepalive, /api/calendar/[token] and the sign-up route.

import type { CalendarFeedRow, KeepaliveResult } from '@/lib/types/database'
import { callRpc, isUuid, type Sb } from './core'

/** Touches the database so the free tier registers activity (app_keepalive). */
export async function appKeepalive(sb: Sb): Promise<KeepaliveResult> {
  const result = await callRpc(sb, 'app_keepalive', {})
  return { ok: result?.ok === true }
}

/**
 * Calendar feed rows for a member's secret token (calendar_feed): today−30 to
 * today+365. Empty for an unknown/malformed token or a member who isn't
 * approved. Works with an anonymous client.
 */
export async function getCalendarFeed(sb: Sb, token: string): Promise<CalendarFeedRow[]> {
  if (!isUuid(token)) return []
  const rows = await callRpc(sb, 'calendar_feed', { p_token: token })
  return Array.isArray(rows) ? rows : []
}

/**
 * SERVICE ROLE ONLY (sign-up route): records a sign-up attempt for a hashed
 * client IP and returns false once that IP has made `max` attempts within
 * `windowMinutes` (signup_rate_check).
 */
export async function signupRateCheck(
  admin: Sb,
  ipHash: string,
  options: { max?: number; windowMinutes?: number } = {},
): Promise<boolean> {
  const allowed = await callRpc(admin, 'signup_rate_check', {
    p_ip_hash: ipHash,
    p_max: options.max ?? 5,
    p_window_minutes: options.windowMinutes ?? 60,
  })
  return allowed === true
}
