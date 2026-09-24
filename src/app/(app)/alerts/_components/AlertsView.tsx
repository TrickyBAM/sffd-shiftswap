'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { BellOff, CheckCheck, Trash2 } from 'lucide-react'
import { Button, buttonClasses, ConfirmDialog, EmptyState, ErrorState, LoadingBlock, useToast } from '@/components/ui'
import { OfflineRibbon } from '@/components/OfflineRibbon'
import { useProfile } from '@/components/providers/ProfileProvider'
import { announceNotificationsChanged } from '@/hooks/useUnreadCount'
import { useRealtimeRefetch } from '@/hooks/useRealtimeRefetch'
import { deleteNotification, deleteReadNotifications, listNotifications, markNotificationsRead } from '@/lib/api'
import { errorMessage } from '@/lib/errors'
import { createClient } from '@/lib/supabase/client'
import type { Notification } from '@/lib/types/database'
import { AlertItem } from './AlertItem'
import {
  ALERTS_PAGE_SIZE,
  appendPage,
  markReadLocally,
  mergeNewestPage,
  safeAlertUrl,
  type AlertPages,
} from './alerts-model'
import { PushBanner } from './PushBanner'

type Status = 'loading' | 'error' | 'ready'

/** Waits for `promise`, but gives up after `ms` (navigation shouldn't hang on a slow network). */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | undefined> {
  return Promise.race([promise, new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), ms))])
}

export function AlertsView() {
  const { profile } = useProfile()
  const router = useRouter()
  const toast = useToast()

  const [pages, setPages] = useState<AlertPages>({ items: [], cursor: null })
  const [status, setStatus] = useState<Status>('loading')
  const [error, setError] = useState('')
  /** The last refresh failed; what's shown may be out of date. */
  const [stale, setStale] = useState(false)
  const [loadedAt, setLoadedAt] = useState<string | null>(null)
  const [version, setVersion] = useState(0)
  const [retrying, setRetrying] = useState(false)
  const [nowMs, setNowMs] = useState(0)

  const [loadingMore, setLoadingMore] = useState(false)
  const [loadMoreError, setLoadMoreError] = useState('')
  const [openingId, setOpeningId] = useState<string | null>(null)
  const [markingAll, setMarkingAll] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<Notification | null>(null)
  const [confirmClear, setConfirmClear] = useState(false)

  // Newest page: first load, retries and realtime refreshes (merged into older pages on screen).
  useEffect(() => {
    let cancelled = false
    Promise.resolve()
      .then(() => listNotifications(createClient(), { limit: ALERTS_PAGE_SIZE }))
      .then(
        (page) => {
          if (cancelled) return
          setPages((current) => mergeNewestPage(current, page))
          setStatus('ready')
          setStale(false)
          setRetrying(false)
          setLoadedAt(new Date().toISOString())
          setNowMs(Date.now())
        },
        (err: unknown) => {
          if (cancelled) return
          setRetrying(false)
          setError(errorMessage(err))
          setStatus((current) => (current === 'ready' ? 'ready' : 'error'))
          setStale(true)
        },
      )
    return () => {
      cancelled = true
    }
  }, [version])

  // Keep "5 min ago" labels current.
  useEffect(() => {
    const timer = setInterval(() => setNowMs(Date.now()), 60_000)
    return () => clearInterval(timer)
  }, [])

  const refresh = useCallback(() => setVersion((v) => v + 1), [])
  const retry = useCallback(() => {
    setRetrying(true)
    setVersion((v) => v + 1)
  }, [])

  useRealtimeRefetch({ table: 'notifications', filter: `user_id=eq.${profile.id}` }, refresh, {
    name: 'alerts',
    debounceMs: 300,
  })

  async function loadMore() {
    if (!pages.cursor || loadingMore) return
    setLoadingMore(true)
    setLoadMoreError('')
    try {
      const page = await listNotifications(createClient(), { limit: ALERTS_PAGE_SIZE, before: pages.cursor })
      setPages((current) => appendPage(current, page))
    } catch (err) {
      setLoadMoreError(errorMessage(err))
    } finally {
      setLoadingMore(false)
    }
  }

  async function openAlert(alert: Notification) {
    if (openingId) return
    const href = safeAlertUrl(alert.url)
    if (!alert.read_at) {
      setOpeningId(alert.id)
      setPages((current) => ({ ...current, items: markReadLocally(current.items, [alert.id], new Date().toISOString()) }))
      try {
        await withTimeout(markNotificationsRead(createClient(), [alert.id]), 2500)
      } catch {
        // Still go there; the realtime refresh shows it unread again if the update was lost.
      }
      announceNotificationsChanged()
    }
    router.push(href)
    setOpeningId(null)
  }

  async function markAllRead() {
    setMarkingAll(true)
    try {
      await markNotificationsRead(createClient(), null)
      setPages((current) => ({ ...current, items: markReadLocally(current.items, null, new Date().toISOString()) }))
      announceNotificationsChanged()
      toast.success('All alerts marked as read')
    } catch (err) {
      toast.error("Couldn't mark alerts as read", errorMessage(err))
    } finally {
      setMarkingAll(false)
    }
  }

  async function deleteOne() {
    const target = deleteTarget
    if (!target) return
    try {
      await deleteNotification(createClient(), target.id)
    } catch (err) {
      toast.error("Couldn't delete that alert", errorMessage(err))
      throw err
    }
    setPages((current) => ({ ...current, items: current.items.filter((n) => n.id !== target.id) }))
    if (!target.read_at) announceNotificationsChanged()
    toast.success('Alert deleted')
  }

  async function clearRead() {
    try {
      await deleteReadNotifications(createClient())
    } catch (err) {
      toast.error("Couldn't clear read alerts", errorMessage(err))
      throw err
    }
    setPages((current) => ({ ...current, items: current.items.filter((n) => !n.read_at) }))
    announceNotificationsChanged()
    toast.success('Read alerts cleared')
  }

  const items = pages.items
  const hasUnread = items.some((n) => !n.read_at) || Boolean(pages.cursor)
  const hasRead = items.some((n) => n.read_at) || Boolean(pages.cursor)

  return (
    <div className="space-y-4">
      <PushBanner />

      {status === 'loading' ? <LoadingBlock label="Loading your alerts…" cards={4} /> : null}

      {status === 'error' ? (
        <ErrorState title="Couldn't load your alerts" message={error} onRetry={retry} retrying={retrying} />
      ) : null}

      {status === 'ready' ? (
        <>
          {stale ? <OfflineRibbon updatedAt={loadedAt} onRetry={retry} retrying={retrying} /> : null}

          {items.length === 0 ? (
            <EmptyState
              icon={<BellOff size={28} />}
              title="No alerts"
              description="You'll get an alert when someone asks for your shift, answers your request, messages you, or posts a shift you could take."
              action={
                <Link href="/profile" className={buttonClasses({ variant: 'secondary' })}>
                  Alert settings
                </Link>
              }
            />
          ) : (
            <>
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  icon={<CheckCheck size={16} aria-hidden="true" />}
                  onClick={markAllRead}
                  loading={markingAll}
                  disabled={!hasUnread}
                >
                  Mark all as read
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  icon={<Trash2 size={16} aria-hidden="true" />}
                  onClick={() => setConfirmClear(true)}
                  disabled={!hasRead}
                >
                  Clear read alerts
                </Button>
              </div>

              <ul aria-label="Alerts, newest first" className="space-y-2">
                {items.map((alert) => (
                  <li key={alert.id}>
                    <AlertItem
                      alert={alert}
                      nowMs={nowMs}
                      opening={openingId === alert.id}
                      onOpen={openAlert}
                      onDelete={setDeleteTarget}
                    />
                  </li>
                ))}
              </ul>

              {pages.cursor ? (
                <div className="flex flex-col items-center gap-2 pt-2">
                  {loadMoreError ? (
                    <p role="alert" className="text-center text-sm text-sffd-red-text">
                      {loadMoreError}
                    </p>
                  ) : null}
                  <Button variant="secondary" onClick={loadMore} loading={loadingMore}>
                    {loadMoreError ? 'Try again' : 'Load more'}
                  </Button>
                </div>
              ) : (
                <p className="pt-2 text-center text-sm text-fg-dim">That&apos;s everything.</p>
              )}
            </>
          )}
        </>
      ) : null}

      <ConfirmDialog
        open={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        onConfirm={deleteOne}
        title="Delete this alert?"
        description={deleteTarget ? `"${deleteTarget.title}" will be removed from your alerts.` : undefined}
        confirmLabel="Delete"
        tone="danger"
      />
      <ConfirmDialog
        open={confirmClear}
        onClose={() => setConfirmClear(false)}
        onConfirm={clearRead}
        title="Clear read alerts?"
        description="Every alert you've already read is deleted. Unread alerts stay."
        confirmLabel="Clear read alerts"
        tone="danger"
      />
    </div>
  )
}
