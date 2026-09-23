'use client'

import Link from 'next/link'
import { UserPlus } from 'lucide-react'
import { Avatar, Badge, Card, EmptyState, ErrorState, LoadingBlock, cn } from '@/components/ui'
import type { AsyncData } from '../_lib/useAsyncData'
import type { RecentMember } from '../_lib/queries'
import { formatInstant, formatInstantDate, stationText } from '../_lib/format'

export const RECENT_DAYS = 14

/** Members approved in the last 14 days, and whether they matched the roster. */
export function RecentlyJoined({ recent }: { recent: AsyncData<RecentMember[]> }) {
  if (recent.error) {
    return <ErrorState message={recent.error.message} onRetry={recent.reload} />
  }
  if (!recent.data) return <LoadingBlock label="Loading recent members…" cards={2} />
  if (recent.data.length === 0) {
    return (
      <EmptyState
        icon={<UserPlus size={28} />}
        title="No one new yet"
        description={`Members approved in the last ${RECENT_DAYS} days show up here.`}
      />
    )
  }

  return (
    <Card padding="none" className={cn(recent.loading && 'opacity-60')}>
      <ul className="divide-y divide-white/[0.06]">
        {recent.data.map(({ member, approvedByName }) => {
          const name = member.full_name || member.email
          return (
            <li key={member.id}>
              <Link
                href={`/admin/members?member=${member.id}`}
                className="flex min-h-16 items-center gap-3 px-4 py-3 transition-colors hover:bg-white/[0.03]"
              >
                <Avatar name={name} colorKey={member.id} size="sm" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold text-fg">{name}</span>
                  <span className="block truncate text-sm text-fg-muted">
                    {member.rank ?? 'No rank'} · {stationText(member.station)} ·{' '}
                    {approvedByName ? `Approved by ${approvedByName}` : 'Auto-approved'}
                  </span>
                </span>
                <span className="flex shrink-0 flex-col items-end gap-1">
                  {member.roster_id ? <Badge tone="green">On roster</Badge> : <Badge tone="neutral">Not on roster</Badge>}
                  <time
                    dateTime={member.approved_at ?? undefined}
                    title={formatInstant(member.approved_at)}
                    className="text-xs text-fg-dim"
                  >
                    {formatInstantDate(member.approved_at)}
                  </time>
                </span>
              </Link>
            </li>
          )
        })}
      </ul>
    </Card>
  )
}
