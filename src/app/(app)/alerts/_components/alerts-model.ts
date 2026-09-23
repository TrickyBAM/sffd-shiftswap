// Pure helpers for /alerts: relative times, safe deep links and merging a
// refreshed first page into the pages already on screen. Unit-tested in
// tests/unit/trades-alerts.test.ts.

import type { NotificationCursor } from '@/lib/api'
import { diffDays, formatDate, formatTimePT, todayPT } from '@/lib/sffd/dates'
import type { Notification } from '@/lib/types/database'

/** Alerts per page ("Load more" fetches the next one). */
export const ALERTS_PAGE_SIZE = 30

/**
 * "Just now", "5 min ago", "3 hr ago", "Yesterday", "4 days ago", "Sep 12",
 * "Dec 30, 2025". Calendar days are counted in Pacific time.
 */
export function relativeTime(iso: string, nowMs: number): string {
  const t = Date.parse(iso)
  if (!Number.isFinite(t) || !Number.isFinite(nowMs)) return ''
  const seconds = Math.max(0, (nowMs - t) / 1000)
  if (seconds < 45) return 'Just now'
  const minutes = Math.max(1, Math.round(seconds / 60))
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.floor(minutes / 60)
  const then = todayPT(new Date(t))
  const today = todayPT(new Date(nowMs))
  const days = diffDays(then, today)
  if (hours < 24 && days <= 1) return `${hours} hr ago`
  if (days === 1) return 'Yesterday'
  if (days < 7) return `${days} days ago`
  return formatDate(then, then.slice(0, 4) === today.slice(0, 4) ? 'short' : 'medium')
}

/** Full date and time for a tooltip / datetime title: "Sep 23, 2026, 3:45 PM". */
export function fullTimestamp(iso: string): string {
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return ''
  const d = new Date(t)
  return `${formatDate(todayPT(d), 'medium')}, ${formatTimePT(d)}`
}

/**
 * An alert's in-app link, only if it is a same-origin path ("/trades/…").
 * Anything else (absolute URLs, protocol-relative "//host") falls back to /trades.
 */
export function safeAlertUrl(url: string | null | undefined): string {
  const value = (url ?? '').trim()
  if (!value.startsWith('/') || value.startsWith('//') || value.startsWith('/\\')) return '/trades'
  return value
}

/** Sort key comparison matching the list order (created_at desc, id desc). */
function isOlderThan(a: Pick<Notification, 'created_at' | 'id'>, b: NotificationCursor): boolean {
  const ta = Date.parse(a.created_at)
  const tb = Date.parse(b.created_at)
  if (ta !== tb) return ta < tb
  return a.id < b.id
}

export interface AlertPages {
  items: Notification[]
  /** Cursor for "Load more"; null when everything is loaded. */
  cursor: NotificationCursor | null
}

/**
 * Merges a freshly loaded newest page into what's on screen: the newest page
 * replaces everything it covers (new, changed and deleted alerts), and older
 * alerts already loaded below it are kept with their "Load more" cursor.
 */
export function mergeNewestPage(current: AlertPages, page: { items: Notification[]; nextCursor: NotificationCursor | null }): AlertPages {
  if (!page.nextCursor) return { items: page.items, cursor: null }
  const boundary = page.nextCursor
  const seen = new Set(page.items.map((n) => n.id))
  const older = current.items.filter((n) => !seen.has(n.id) && isOlderThan(n, boundary))
  if (older.length === 0) return { items: page.items, cursor: page.nextCursor }
  return { items: [...page.items, ...older], cursor: current.cursor }
}

/** Appends an older page, skipping anything already shown. */
export function appendPage(current: AlertPages, page: { items: Notification[]; nextCursor: NotificationCursor | null }): AlertPages {
  const seen = new Set(current.items.map((n) => n.id))
  return { items: [...current.items, ...page.items.filter((n) => !seen.has(n.id))], cursor: page.nextCursor }
}

/** Marks the given alerts (or all when ids is null) read at `atIso`, locally. */
export function markReadLocally(items: readonly Notification[], ids: readonly string[] | null, atIso: string): Notification[] {
  const only = ids ? new Set(ids) : null
  return items.map((n) => (!n.read_at && (!only || only.has(n.id)) ? { ...n, read_at: atIso } : n))
}
