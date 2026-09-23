'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Hourglass } from 'lucide-react'
import { Badge, buttonClasses, ConfirmDialog, EmptyState, useToast } from '@/components/ui'
import { withdrawRequest, type RequestWithShift } from '@/lib/api'
import { errorMessage } from '@/lib/errors'
import { formatDate } from '@/lib/sffd/dates'
import { createClient } from '@/lib/supabase/client'
import type { Shift } from '@/lib/types/database'
import { TradeLinkCard, TradeSection } from './TradeLinkCard'
import {
  acceptLimitLabel,
  chooseCta,
  namesPreview,
  partnerOf,
  plural,
  shiftLine,
  type IncomingGroup,
} from './trades-model'

export interface PendingTabProps {
  me: string
  groups: IncomingGroup[]
  cancelRequests: Shift[]
  myRequests: RequestWithShift[]
  openPosts: Shift[]
  counts: Map<string, number>
  /** Called after a request is withdrawn (drop it locally, then refetch). */
  onWithdrawn: (requestId: string) => void
  /** Actions are disabled while showing the offline snapshot. */
  offline: boolean
}

export function PendingTab({
  me,
  groups,
  cancelRequests,
  myRequests,
  openPosts,
  counts,
  onWithdrawn,
  offline,
}: PendingTabProps) {
  const waiting = groups.length + cancelRequests.length
  if (waiting === 0 && myRequests.length === 0 && openPosts.length === 0) {
    return (
      <EmptyState
        icon={<Hourglass size={28} />}
        title="Nothing pending"
        description="When you ask for a shift, or someone asks for one of yours, it shows up here."
        action={
          <Link href="/board" className={buttonClasses({ variant: 'secondary' })}>
            Browse open shifts
          </Link>
        }
      />
    )
  }

  return (
    <div className="space-y-6">
      {waiting > 0 ? (
        <TradeSection title="Waiting on you" count={waiting}>
          {cancelRequests.map((shift) => (
            <li key={`cancel-${shift.id}`}>
              <CancelRequestCard shift={shift} me={me} />
            </li>
          ))}
          {groups.map((group) => (
            <li key={group.shift.id}>
              <IncomingCard group={group} />
            </li>
          ))}
        </TradeSection>
      ) : null}

      {myRequests.length > 0 ? (
        <TradeSection
          title="Your requests"
          count={myRequests.length}
          description="Waiting for the poster to choose. You'll get an alert either way."
        >
          {myRequests.map((request) => (
            <li key={request.id}>
              <MyRequestCard request={request} onWithdrawn={onWithdrawn} offline={offline} />
            </li>
          ))}
        </TradeSection>
      ) : null}

      {openPosts.length > 0 ? (
        <TradeSection title="Your open posts" count={openPosts.length}>
          {openPosts.map((shift) => (
            <li key={shift.id}>
              <OpenPostCard shift={shift} requests={counts.get(shift.id) ?? 0} />
            </li>
          ))}
        </TradeSection>
      ) : null}
    </div>
  )
}

function IncomingCard({ group }: { group: IncomingGroup }) {
  const { shift, requests } = group
  const names = namesPreview(requests.map((r) => r.requester_name))
  return (
    <TradeLinkCard
      shiftId={shift.id}
      date={shift.date}
      dateTone="red"
      title={chooseCta(requests.length)}
      subtitle={`Your ${shift.shift_type} on ${formatDate(shift.date, 'weekday')} · from ${names}`}
      cta={
        <span aria-hidden="true" className={buttonClasses({ size: 'sm', className: 'pointer-events-none' })}>
          Choose
        </span>
      }
    >
      {shift.return_dates.length ? <Badge tone="purple">SwapMatch</Badge> : null}
    </TradeLinkCard>
  )
}

function CancelRequestCard({ shift, me }: { shift: Shift; me: string }) {
  const partner = partnerOf(shift, me).name
  return (
    <TradeLinkCard
      shiftId={shift.id}
      date={shift.date}
      dateTone="red"
      title={`${partner} asked to cancel your trade`}
      subtitle={shiftLine(shift)}
      cta={
        <span aria-hidden="true" className={buttonClasses({ size: 'sm', className: 'pointer-events-none' })}>
          Answer
        </span>
      }
    >
      <Badge tone="yellow">Needs your answer</Badge>
      {shift.cancel_reason ? (
        <span className="w-full text-sm text-fg-muted">&ldquo;{shift.cancel_reason}&rdquo;</span>
      ) : null}
    </TradeLinkCard>
  )
}

function OpenPostCard({ shift, requests }: { shift: Shift; requests: number }) {
  const limit = acceptLimitLabel(shift.accept_limit)
  return (
    <TradeLinkCard
      shiftId={shift.id}
      date={shift.date}
      title={requests > 0 ? chooseCta(requests) : 'No requests yet'}
      subtitle={shiftLine(shift)}
    >
      <Badge tone="orange">Open</Badge>
      {shift.return_dates.length ? (
        <Badge tone="purple">SwapMatch · {plural(shift.return_dates.length, 'date')}</Badge>
      ) : null}
      {limit ? <Badge>{limit}</Badge> : null}
    </TradeLinkCard>
  )
}

function MyRequestCard({
  request,
  onWithdrawn,
  offline,
}: {
  request: RequestWithShift
  onWithdrawn: (requestId: string) => void
  offline: boolean
}) {
  const toast = useToast()
  const [confirming, setConfirming] = useState(false)
  const { shift } = request

  async function withdraw() {
    try {
      await withdrawRequest(createClient(), request.id)
    } catch (error) {
      toast.error("Couldn't withdraw your request", errorMessage(error))
      throw error
    }
    toast.success('Request withdrawn')
    onWithdrawn(request.id)
  }

  return (
    <div className="rounded-2xl border border-line bg-card">
      <TradeLinkCard
        shiftId={shift.id}
        date={shift.date}
        framed={false}
        title={`${shift.poster_name}'s ${shift.shift_type}`}
        subtitle={shiftLine(shift)}
      >
        <Badge tone="blue">Waiting for {shift.poster_name}</Badge>
        {request.return_date ? (
          <Badge tone="purple">You&apos;d work {formatDate(request.return_date, 'weekday')} in return</Badge>
        ) : null}
      </TradeLinkCard>
      <div className="flex justify-end border-t border-line px-3 py-2">
        <button
          type="button"
          onClick={() => setConfirming(true)}
          disabled={offline}
          className={buttonClasses({ variant: 'ghost', size: 'sm' })}
        >
          Withdraw request
        </button>
      </div>
      <ConfirmDialog
        open={confirming}
        onClose={() => setConfirming(false)}
        onConfirm={withdraw}
        title="Withdraw your request?"
        description={`${shift.poster_name} won't be able to pick you for ${formatDate(shift.date, 'weekday')}. You can ask again later if it's still open.`}
        confirmLabel="Withdraw"
        cancelLabel="Keep request"
        tone="danger"
      />
    </div>
  )
}
