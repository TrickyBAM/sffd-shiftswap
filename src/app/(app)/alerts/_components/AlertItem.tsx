'use client'

import type { MouseEvent } from 'react'
import Link from 'next/link'
import {
  AlertTriangle,
  Ban,
  Bell,
  CalendarPlus,
  CalendarX,
  CheckCircle2,
  Inbox,
  MessageSquare,
  ShieldCheck,
  Trash2,
  Undo2,
  UserCheck,
  UserPlus,
  UserRound,
  UserX,
  XCircle,
  type LucideIcon,
} from 'lucide-react'
import { Spinner } from '@/components/ui'
import { cn } from '@/components/ui/cn'
import { relativeTime } from '@/lib/format'
import type { Notification, NotificationType } from '@/lib/types/database'
import { fullTimestamp, safeAlertUrl } from './alerts-model'

const TYPE_ICONS: Record<NotificationType, { icon: LucideIcon; className: string }> = {
  request_received: { icon: Inbox, className: 'text-accent-blue' },
  request_accepted: { icon: CheckCircle2, className: 'text-accent-green' },
  request_declined: { icon: XCircle, className: 'text-fg-muted' },
  request_withdrawn: { icon: Undo2, className: 'text-fg-muted' },
  // Orange is kept for 'my open post' (UX-11); a cancellation is a heads-up.
  post_cancelled: { icon: CalendarX, className: 'text-accent-yellow' },
  cancel_requested: { icon: AlertTriangle, className: 'text-accent-yellow' },
  trade_cancelled: { icon: CalendarX, className: 'text-accent-yellow' },
  cancel_declined: { icon: ShieldCheck, className: 'text-accent-blue' },
  trade_voided: { icon: Ban, className: 'text-sffd-red-text' },
  new_shift: { icon: CalendarPlus, className: 'text-accent-blue' },
  message: { icon: MessageSquare, className: 'text-accent-purple' },
  member_pending: { icon: UserPlus, className: 'text-accent-yellow' },
  member_auto_approved: { icon: UserCheck, className: 'text-accent-green' },
  member_approved: { icon: UserCheck, className: 'text-accent-green' },
  member_rejected: { icon: UserX, className: 'text-fg-muted' },
  account_status: { icon: UserRound, className: 'text-fg-muted' },
}

export interface AlertItemProps {
  alert: Notification
  nowMs: number
  /** Opening this alert right now (marking it read before navigating). */
  opening: boolean
  onOpen: (alert: Notification) => void
  onDelete: (alert: Notification) => void
}

export function AlertItem({ alert, nowMs, opening, onOpen, onDelete }: AlertItemProps) {
  const unread = !alert.read_at
  const { icon: Icon, className: iconClass } = TYPE_ICONS[alert.type] ?? { icon: Bell, className: 'text-fg-muted' }
  const href = safeAlertUrl(alert.url)

  function handleClick(event: MouseEvent<HTMLAnchorElement>) {
    // Let the browser handle "open in new tab" gestures.
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return
    event.preventDefault()
    onOpen(alert)
  }

  return (
    <div
      className={cn(
        'flex items-stretch rounded-2xl border',
        unread ? 'border-line-strong bg-elevated' : 'border-line bg-card',
      )}
    >
      <Link
        href={href}
        onClick={handleClick}
        aria-busy={opening || undefined}
        className="flex min-h-11 min-w-0 flex-1 items-start gap-3 rounded-2xl p-4 text-left"
      >
        <span className="relative mt-0.5 shrink-0" aria-hidden="true">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/[0.05]">
            {opening ? <Spinner size="sm" className="text-fg-muted" /> : <Icon size={20} className={iconClass} />}
          </span>
          {unread ? (
            <span className="absolute -right-1 -top-1 h-3 w-3 rounded-full bg-sffd-red ring-2 ring-surface" />
          ) : null}
        </span>
        <span className="min-w-0 flex-1">
          <span className={cn('block leading-snug text-fg', unread ? 'font-bold' : 'font-medium')}>
            {unread ? <span className="sr-only">New: </span> : null}
            {alert.title}
          </span>
          {alert.body ? (
            <span className={cn('mt-0.5 block text-sm', unread ? 'text-fg' : 'text-fg-muted')}>{alert.body}</span>
          ) : null}
          <time dateTime={alert.created_at} title={fullTimestamp(alert.created_at)} className="mt-1 block text-xs text-fg-dim">
            {relativeTime(alert.created_at, nowMs)}
          </time>
        </span>
      </Link>
      <button
        type="button"
        onClick={() => onDelete(alert)}
        aria-label={`Delete alert: ${alert.title}`}
        className="m-1 inline-flex h-11 w-11 shrink-0 items-center justify-center self-start rounded-xl text-fg-dim hover:bg-white/[0.06] hover:text-fg"
      >
        <Trash2 size={18} aria-hidden="true" />
      </button>
    </div>
  )
}
