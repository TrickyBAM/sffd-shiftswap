'use client'

import { useState } from 'react'
import Link from 'next/link'
import {
  ArrowLeftRight,
  CalendarPlus,
  ChevronRight,
  ClipboardList,
  History,
  RotateCw,
  ShieldCheck,
  UserRound,
  type LucideIcon,
} from 'lucide-react'
import { Button, Card, EmptyState, ErrorState, Field, LoadingBlock, Select, cn } from '@/components/ui'
import { relativeTime } from '@/lib/format'
import { createClient } from '@/lib/supabase/client'
import { formatInstant, withinLastWeek } from '../../_lib/format'
import { usePagedList } from '../../_lib/usePagedList'
import { ACTIVITY_FILTER_GROUPS, ACTIVITY_FILTER_VALUES, type ActivityKind } from '../_lib/describe'
import { loadActivityPage, type ActivityItem } from '../_lib/load'

const KIND_ICONS: Record<ActivityKind, { icon: LucideIcon; className: string }> = {
  member: { icon: UserRound, className: 'bg-accent-blue/12 text-accent-blue' },
  post: { icon: CalendarPlus, className: 'bg-accent-orange/12 text-accent-orange' },
  trade: { icon: ArrowLeftRight, className: 'bg-accent-green/12 text-accent-green' },
  admin: { icon: ShieldCheck, className: 'bg-sffd-red/12 text-sffd-red-text' },
  roster: { icon: ClipboardList, className: 'bg-accent-purple/12 text-accent-purple' },
  other: { icon: History, className: 'bg-white/[0.06] text-fg-muted' },
}

function ActivityRow({ item }: { item: ActivityItem }) {
  const { entry, line } = item
  const { icon: Icon, className } = KIND_ICONS[line.kind]
  const body = (
    <>
      <span aria-hidden="true" className={cn('flex h-10 w-10 shrink-0 items-center justify-center rounded-full', className)}>
        <Icon size={18} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium text-fg">{line.text}</span>
        {line.detail ? <span className="mt-0.5 block text-sm text-fg-muted">{line.detail}</span> : null}
        <time dateTime={entry.created_at} title={formatInstant(entry.created_at)} className="mt-0.5 block text-xs text-fg-dim">
          {withinLastWeek(entry.created_at)
            ? `${relativeTime(entry.created_at)} · ${formatInstant(entry.created_at)}`
            : formatInstant(entry.created_at)}
        </time>
      </span>
      {line.href ? <ChevronRight size={18} aria-hidden="true" className="mt-2.5 shrink-0 text-fg-dim" /> : null}
    </>
  )
  return (
    <li>
      {line.href ? (
        <Link href={line.href} className="flex min-h-16 gap-3 px-4 py-3 transition-colors hover:bg-white/[0.03]">
          {body}
        </Link>
      ) : (
        <div className="flex min-h-16 gap-3 px-4 py-3">{body}</div>
      )}
    </li>
  )
}

/** /admin/activity — everything that happened, newest first, in plain English. */
export function ActivityView() {
  const [action, setAction] = useState('')
  const list = usePagedList<ActivityItem, number>(
    (cursor) => loadActivityPage(createClient(), action, cursor),
    `activity|${action}`,
  )

  return (
    <div className="space-y-4">
      <div className="flex items-end gap-2">
        <Field label="Show" className="min-w-0 flex-1">
          <Select
            value={action}
            onChange={(event) => {
              const next = event.target.value
              setAction(ACTIVITY_FILTER_VALUES.has(next) ? next : '')
            }}
          >
            {ACTIVITY_FILTER_GROUPS.map((group) => (
              <optgroup key={group.label} label={group.label}>
                {group.options.map((option) => (
                  <option key={option.value || 'all'} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </optgroup>
            ))}
          </Select>
        </Field>
        <Button
          variant="secondary"
          size="icon"
          aria-label="Refresh activity"
          onClick={list.reload}
          disabled={list.loading}
          className="mb-0.5"
        >
          <RotateCw size={18} aria-hidden="true" className={list.loading && list.loaded ? 'animate-spin' : undefined} />
        </Button>
      </div>

      {list.error ? (
        <ErrorState title="Couldn't load activity" message={list.error.message} onRetry={list.reload} />
      ) : !list.loaded ? (
        <LoadingBlock label="Loading activity…" cards={4} />
      ) : list.items.length === 0 ? (
        <EmptyState
          icon={<History size={28} />}
          title="Nothing yet"
          description={action ? 'Nothing of this kind has happened yet.' : 'Sign-ups, posts, trades and admin actions show up here.'}
        />
      ) : (
        <>
          <Card padding="none" className={cn(list.loading && 'opacity-60')} aria-busy={list.loading || undefined}>
            <ul className="divide-y divide-white/[0.06]">
              {list.items.map((item) => (
                <ActivityRow key={item.entry.id} item={item} />
              ))}
            </ul>
          </Card>
          {list.moreError ? (
            <p role="alert" className="text-center text-sm text-sffd-red-text">
              {list.moreError.message}
            </p>
          ) : null}
          {list.hasMore ? (
            <Button variant="secondary" fullWidth loading={list.loadingMore} onClick={list.loadMore}>
              {list.moreError ? 'Try again' : 'Load more'}
            </Button>
          ) : (
            <p className="text-center text-sm text-fg-dim">That&apos;s everything.</p>
          )}
        </>
      )}
    </div>
  )
}
