'use client'

import { useState, type ReactNode } from 'react'
import { HandHelping } from 'lucide-react'
import { Button, Card, CardHeader } from '@/components/ui'
import { useProfile } from '@/components/providers/ProfileProvider'
import { relativeTime } from '@/lib/format'
import { formatDate } from '@/lib/sffd/dates'
import type { Shift, ShiftRequest } from '@/lib/types/database'
import { Notice } from '@/app/(app)/board/_components/Notice'
import { RequestSheet } from '@/app/(app)/board/_components/RequestSheet'
import { WithdrawRequestDialog } from '@/app/(app)/board/_components/WithdrawRequestDialog'
import { currentTime } from '@/app/(app)/board/_lib/format'
import { myCurrentRequest } from '../_lib/trade-model'

export interface RequesterPanelProps {
  /** The original posted shift. */
  shift: Shift
  /** Requests visible to me (my own, unless I'm an admin). */
  requests: readonly ShiftRequest[]
  started: boolean
  /** Actions off (offline snapshot). */
  disabled: boolean
  onChanged: () => Promise<void>
}

/**
 * Anyone but the poster: my request's status with Withdraw (asks first), or
 * "Request this shift" (the Board's request sheet, which checks eligibility
 * first).
 */
export function RequesterPanel({ shift, requests, started, disabled, onChanged }: RequesterPanelProps) {
  const { profile } = useProfile()
  const request = myCurrentRequest(requests, profile.id)
  const [sheetOpen, setSheetOpen] = useState(false)
  // The request the "Withdraw your request?" dialog is asking about.
  const [withdrawing, setWithdrawing] = useState<ShiftRequest | null>(null)
  const [nowMs] = useState(() => currentTime())
  const canRequest = shift.status === 'open' && !started
  const poster = shift.poster_name

  const requestButton = canRequest ? (
    <Button fullWidth disabled={disabled} icon={<HandHelping size={18} aria-hidden="true" />} onClick={() => setSheetOpen(true)}>
      {request ? 'Request it again' : 'Request this shift'}
    </Button>
  ) : null

  let body: ReactNode = null
  if (request?.status === 'pending') {
    body = (
      <Notice
        tone="success"
        title="You asked for this shift"
        actions={
          <Button variant="secondary" disabled={disabled} onClick={() => setWithdrawing(request)}>
            Withdraw my request
          </Button>
        }
      >
        <span className="block" suppressHydrationWarning>
          Sent {relativeTime(request.created_at, nowMs, { style: 'inline' })}. Waiting for {poster} to answer — you&apos;ll
          get an alert.
        </span>
        {request.return_date ? (
          <span className="mt-1 block">
            In return, {poster} works your {formatDate(request.return_date, 'weekday')} shift.
          </span>
        ) : null}
        {request.message ? <span className="mt-1 block break-words">Your message: “{request.message}”</span> : null}
      </Notice>
    )
  } else if (request) {
    body = (
      <div className="space-y-3">
        <Notice tone="info" title={closedTitle(request, shift)}>
          {closedText(request, shift)}
        </Notice>
        {requestButton}
      </div>
    )
  } else if (canRequest) {
    body = (
      <Card as="section" aria-labelledby="request-shift-title">
        <CardHeader
          title={<span id="request-shift-title">Want this shift?</span>}
          description={`Send ${poster} a request. We check first that you can take it.`}
        />
        {requestButton}
      </Card>
    )
  }

  return (
    <>
      {body}
      {sheetOpen ? (
        <RequestSheet
          key={shift.id}
          shiftId={shift.id}
          initialShift={shift}
          showDetailsLink={false}
          onClose={() => setSheetOpen(false)}
          onChanged={() => void onChanged()}
        />
      ) : null}
      <WithdrawRequestDialog
        request={withdrawing}
        posterName={poster}
        onClose={() => setWithdrawing(null)}
        onChanged={onChanged}
      />
    </>
  )
}

function closedTitle(request: ShiftRequest, shift: Shift): string {
  switch (request.status) {
    case 'accepted':
      return 'You were confirmed for this shift'
    case 'declined':
      return shift.status === 'covered' ? 'This shift went to another member' : 'Your request was declined'
    case 'withdrawn':
      return 'You withdrew your request'
    case 'cancelled':
      return shift.status === 'cancelled' ? 'The post was cancelled' : 'Your request was closed'
    default:
      return 'Your request'
  }
}

function closedText(request: ShiftRequest, shift: Shift): string {
  switch (request.status) {
    case 'accepted':
      return shift.status === 'open'
        ? 'The trade was undone, so the shift is open again.'
        : 'The trade was confirmed.'
    case 'declined':
      return shift.status === 'covered'
        ? `${shift.poster_name} confirmed someone else. Thanks for offering.`
        : `${shift.poster_name} said no this time. The shift is still open.`
    case 'withdrawn':
      return shift.status === 'open' ? 'You can ask again while it’s open.' : 'Nothing else to do here.'
    case 'cancelled':
      return shift.status === 'cancelled'
        ? `${shift.poster_name} took this shift off the board.`
        : shift.status === 'open'
          ? 'The trade was undone, so the shift is open again.'
          : 'Nothing else to do here.'
    default:
      return ''
  }
}
