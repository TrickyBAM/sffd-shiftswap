// In-app notifications (/alerts) — each member reads and deletes only their
// own (ARCHITECTURE §6.1 "notifications", §6.2).

import type { Notification } from '@/lib/types/database'
import { AppError } from '@/lib/errors'
import {
  assertUuid,
  callRpc,
  clampLimit,
  isUuid,
  quoteFilterValue,
  runList,
  runQuery,
  runVoid,
  type Page,
  type Sb,
} from './core'

/** Position after the last notification of a page (newest-first order). */
export interface NotificationCursor {
  created_at: string
  id: string
}

export interface ListNotificationsOptions {
  /** Page size (default 30, max 100). */
  limit?: number
  /** Cursor from the previous page's `nextCursor`; omit for the newest page. */
  before?: NotificationCursor | null
  /** Only unread ones. */
  unreadOnly?: boolean
}

/**
 * My notifications, newest first, one page at a time. Pass `nextCursor` as
 * `before` to load older ones.
 */
export async function listNotifications(
  sb: Sb,
  options: ListNotificationsOptions = {},
): Promise<Page<Notification, NotificationCursor>> {
  const limit = clampLimit(options.limit, 30, 100)
  let query = sb.from('notifications').select('*')
  if (options.unreadOnly) query = query.is('read_at', null)
  if (options.before) query = query.or(notificationCursorFilter(options.before))
  const rows = await runList<Notification>(
    query
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(limit + 1),
  )
  const items = rows.slice(0, limit)
  const last = items[items.length - 1]
  return {
    items,
    nextCursor: rows.length > limit && last ? { created_at: last.created_at, id: last.id } : null,
  }
}

/** PostgREST `or` filter for notifications older than `cursor` (created_at desc, id desc). */
export function notificationCursorFilter(cursor: NotificationCursor): string {
  const id = assertUuid(cursor.id)
  if (typeof cursor.created_at !== 'string' || Number.isNaN(Date.parse(cursor.created_at))) {
    throw new AppError('INVALID_INPUT', "Couldn't load older alerts. Refresh and try again.")
  }
  const at = quoteFilterValue(cursor.created_at)
  return `created_at.lt.${at},and(created_at.eq.${at},id.lt.${id})`
}

/**
 * Number of my unread notifications (a head-only count). RLS already limits
 * it to my rows; pass `userId` when known so the query can use the index.
 */
export async function unreadCount(sb: Sb, options: { userId?: string | null } = {}): Promise<number> {
  let query = sb.from('notifications').select('id', { count: 'exact', head: true }).is('read_at', null)
  if (options.userId) query = query.eq('user_id', assertUuid(options.userId, 'user'))
  const { count } = await runQuery<null>(query)
  return count ?? 0
}

/** Marks some of my notifications read, or all of them when `ids` is null/omitted. */
export async function markNotificationsRead(sb: Sb, ids?: readonly string[] | null): Promise<void> {
  if (ids) {
    const valid = [...new Set(ids)].filter(isUuid)
    if (!valid.length) return
    await callRpc(sb, 'mark_notifications_read', { p_ids: valid })
    return
  }
  await callRpc(sb, 'mark_notifications_read', { p_ids: null })
}

/** Deletes one of my notifications. */
export async function deleteNotification(sb: Sb, id: string): Promise<void> {
  await runVoid(sb.from('notifications').delete().eq('id', assertUuid(id, 'alert')))
}

/** Deletes all of my notifications that are already read. */
export async function deleteReadNotifications(sb: Sb): Promise<void> {
  await runVoid(sb.from('notifications').delete().not('read_at', 'is', null))
}
