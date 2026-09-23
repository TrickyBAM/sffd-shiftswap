'use client'

import { useState } from 'react'
import { Inbox } from 'lucide-react'
import { EmptyState, ErrorState, LoadingBlock, cn } from '@/components/ui'
import { useProfile } from '@/components/providers/ProfileProvider'
import { useRealtimeRefetch } from '@/hooks/useRealtimeRefetch'
import { listPendingApprovals, type PendingApproval } from '@/lib/api'
import { createClient } from '@/lib/supabase/client'
import { listRecentlyJoined } from '../_lib/queries'
import { useAsyncData } from '../_lib/useAsyncData'
import { ApprovalCard } from './ApprovalCard'
import { ApproveSheet } from './ApproveSheet'
import { RecentlyJoined, RECENT_DAYS } from './RecentlyJoined'
import { RejectDialog } from './RejectDialog'
import { useAdmin } from './AdminProvider'

/** /admin — sign-ups waiting for approval, and who joined recently. */
export function ApprovalsView() {
  const { profile } = useProfile()
  const { refreshOverview } = useAdmin()
  const pending = useAsyncData(() => listPendingApprovals(createClient()), 'pending')
  const recent = useAsyncData(() => listRecentlyJoined(createClient(), RECENT_DAYS), 'recent')
  const [approving, setApproving] = useState<PendingApproval | null>(null)
  const [rejecting, setRejecting] = useState<PendingApproval | null>(null)

  const reloadAll = () => {
    pending.reload()
    recent.reload()
    void refreshOverview()
  }

  // New sign-ups notify every admin (member_pending / member_auto_approved),
  // so a new alert for me is the cue to reload the queue.
  useRealtimeRefetch(
    { table: 'notifications', event: 'INSERT', filter: `user_id=eq.${profile.id}` },
    () => {
      pending.reload()
      recent.reload()
    },
    { name: 'admin-approvals' },
  )

  const items = pending.data ?? []

  return (
    <div className="space-y-8">
      <section aria-labelledby="pending-heading">
        <div className="mb-3 flex items-baseline justify-between gap-3">
          <h2 id="pending-heading" className="font-display text-2xl text-fg">
            Waiting for approval
          </h2>
          {pending.data && items.length > 0 ? (
            <span className="text-sm text-fg-muted">{items.length} waiting</span>
          ) : null}
        </div>

        {pending.error ? (
          <ErrorState message={pending.error.message} onRetry={pending.reload} />
        ) : !pending.data ? (
          <LoadingBlock label="Loading sign-ups…" cards={2} />
        ) : items.length === 0 ? (
          <EmptyState
            icon={<Inbox size={28} />}
            title="No one waiting"
            description="New sign-ups that don't match the roster show up here."
          />
        ) : (
          <ul className={cn('space-y-3', pending.loading && 'opacity-60')} aria-busy={pending.loading || undefined}>
            {items.map((approval) => (
              <ApprovalCard
                key={approval.member.id}
                approval={approval}
                onApprove={setApproving}
                onReject={setRejecting}
              />
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="recent-heading">
        <h2 id="recent-heading" className="mb-1 font-display text-2xl text-fg">
          Recently joined
        </h2>
        <p className="mb-3 text-sm text-fg-muted">Approved in the last {RECENT_DAYS} days.</p>
        <RecentlyJoined recent={recent} />
      </section>

      {approving ? (
        <ApproveSheet
          key={approving.member.id}
          approval={approving}
          onClose={() => setApproving(null)}
          onApproved={() => {
            setApproving(null)
            reloadAll()
          }}
        />
      ) : null}

      {rejecting ? (
        <RejectDialog
          key={rejecting.member.id}
          member={rejecting.member}
          onClose={() => setRejecting(null)}
          onRejected={reloadAll}
        />
      ) : null}
    </div>
  )
}
