'use client'

import { Check, ClipboardList, X } from 'lucide-react'
import { Avatar, Badge, Button, Card } from '@/components/ui'
import type { PendingApproval } from '@/lib/api'
import { formatInstant, stationWithBattalion, timeAgo, tourText } from '../_lib/format'
import { ContactButtons } from './ContactButtons'

export interface ApprovalCardProps {
  approval: PendingApproval
  onApprove: (approval: PendingApproval) => void
  onReject: (approval: PendingApproval) => void
}

/** One sign-up waiting for approval: who they are, how to reach them, the roster check. */
export function ApprovalCard({ approval, onApprove, onReject }: ApprovalCardProps) {
  const { member, rosterNote, autoApproveBlocked, attempts, submittedAt } = approval
  const name = member.full_name || member.email || 'New member'

  return (
    <Card as="li" className="animate-fade-in-up">
      <div className="flex items-start gap-3">
        <Avatar name={name} colorKey={member.id} />
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-base font-semibold text-fg">{name}</h3>
          <p className="text-sm text-fg-muted">
            {member.rank ?? 'No rank'} · {stationWithBattalion(member.station)} · {tourText(member.tour)}
          </p>
          <p className="mt-0.5 text-xs text-fg-dim">
            Signed up <time dateTime={member.created_at} title={formatInstant(member.created_at)}>{timeAgo(member.created_at)}</time>
            {submittedAt && submittedAt !== member.created_at ? (
              <>
                {' '}
                · last updated{' '}
                <time dateTime={submittedAt} title={formatInstant(submittedAt)}>
                  {timeAgo(submittedAt)}
                </time>
              </>
            ) : null}
          </p>
        </div>
      </div>

      <dl className="mt-4 grid grid-cols-1 gap-x-4 gap-y-2 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-xs text-fg-dim">Employee ID</dt>
          <dd className="text-fg">{member.employee_id || <span className="text-fg-muted">Not given</span>}</dd>
        </div>
        <div>
          <dt className="text-xs text-fg-dim">Phone</dt>
          <dd className="text-fg">{member.phone || <span className="text-fg-muted">Not given</span>}</dd>
        </div>
        <div className="sm:col-span-2">
          <dt className="text-xs text-fg-dim">Email</dt>
          <dd className="break-all text-fg">{member.email || <span className="text-fg-muted">Not given</span>}</dd>
        </div>
      </dl>

      <ContactButtons
        className="mt-3"
        name={name}
        phone={member.phone}
        email={member.email || null}
        smsBody={`Hi ${name.split(' ')[0] || 'there'}, this is the ShiftSwap admin about your sign-up.`}
      />

      <div className="mt-4 rounded-xl border border-line bg-elevated/60 p-3">
        <p className="flex items-center gap-2 text-sm font-semibold text-fg">
          <ClipboardList size={16} aria-hidden="true" className="text-accent-blue" />
          Roster check
        </p>
        <p className="mt-1 text-sm text-fg-muted">
          {rosterNote ?? 'No roster note was recorded for this sign-up.'}
        </p>
        {autoApproveBlocked || attempts > 1 ? (
          <div className="mt-2 flex flex-wrap gap-2">
            {autoApproveBlocked ? (
              <Badge tone="yellow">Auto-approve stopped after {attempts} tries</Badge>
            ) : (
              <Badge tone="neutral">Submitted {attempts} times</Badge>
            )}
          </div>
        ) : null}
      </div>

      <div className="mt-4 flex flex-col gap-2 sm:flex-row">
        <Button
          icon={<Check size={18} aria-hidden="true" />}
          onClick={() => onApprove(approval)}
          aria-label={`Approve ${name}`}
          className="sm:flex-1"
        >
          Approve
        </Button>
        <Button
          variant="danger"
          icon={<X size={18} aria-hidden="true" />}
          onClick={() => onReject(approval)}
          aria-label={`Reject ${name}`}
          className="sm:flex-1"
        >
          Reject
        </Button>
      </div>
    </Card>
  )
}
