'use client'

import { useState } from 'react'
import { Ban, Check, KeyRound, Pencil, RotateCcw, ShieldCheck, ShieldOff, UserX, X } from 'lucide-react'
import { Button } from '@/components/ui'
import { setMemberRole, setMemberStatus, type PendingApproval } from '@/lib/api'
import { createClient } from '@/lib/supabase/client'
import type { Profile } from '@/lib/types/database'
import { ApproveSheet } from '../../_components/ApproveSheet'
import { ReasonConfirmDialog } from '../../_components/ReasonConfirmDialog'
import { RejectDialog } from '../../_components/RejectDialog'
import { isRemoved } from '../_lib/query'
import { RemovedAccount } from './RemovedAccount'
import { RemoveMemberDialog } from './RemoveMemberDialog'
import { ResetPasswordDialog } from './ResetPasswordDialog'

type Open =
  | 'suspend'
  | 'reactivate'
  | 'make-admin'
  | 'remove-admin'
  | 'reset'
  | 'approve'
  | 'reject'
  | 'remove'
  | null

export interface MemberActionsProps {
  member: Profile
  /** The signed-in admin's id (some actions can't be done to yourself). */
  myId: string
  onEdit: () => void
  /** Reload after any change. */
  onChanged: () => void
}

function asApproval(member: Profile): PendingApproval {
  return { member, rosterNote: null, rosterId: null, attempts: 0, autoApproveBlocked: false, submittedAt: null }
}

/**
 * Edit, approve/reject, suspend/reactivate, admin access, password reset and
 * account removal for one member. A removed account only shows what happened
 * (and Finish removal if its login step didn't complete).
 */
export function MemberActions({ member, myId, onEdit, onChanged }: MemberActionsProps) {
  const [open, setOpen] = useState<Open>(null)
  const close = () => setOpen(null)
  const name = member.full_name || member.email || 'this member'
  const isMe = member.id === myId
  const setUp = member.status !== 'onboarding' && member.rank !== null && member.station !== null

  if (isRemoved(member)) return <RemovedAccount member={member} onChanged={onChanged} />

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold uppercase tracking-wide text-fg-dim">Manage</h3>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {setUp ? (
          <Button variant="secondary" icon={<Pencil size={18} aria-hidden="true" />} onClick={onEdit}>
            Edit details
          </Button>
        ) : null}

        {member.status === 'pending' || member.status === 'rejected' ? (
          <Button icon={<Check size={18} aria-hidden="true" />} onClick={() => setOpen('approve')} disabled={!setUp}>
            Approve
          </Button>
        ) : null}
        {(member.status === 'pending' || member.status === 'onboarding') && !isMe ? (
          <Button variant="danger" icon={<X size={18} aria-hidden="true" />} onClick={() => setOpen('reject')}>
            Reject
          </Button>
        ) : null}

        {member.status === 'approved' && !isMe ? (
          <Button variant="danger" icon={<Ban size={18} aria-hidden="true" />} onClick={() => setOpen('suspend')}>
            Suspend
          </Button>
        ) : null}
        {member.status === 'suspended' && !isMe ? (
          <Button
            variant="secondary"
            icon={<RotateCcw size={18} aria-hidden="true" />}
            onClick={() => setOpen('reactivate')}
          >
            Reactivate
          </Button>
        ) : null}

        {member.role === 'member' && member.status === 'approved' ? (
          <Button
            variant="secondary"
            icon={<ShieldCheck size={18} aria-hidden="true" />}
            onClick={() => setOpen('make-admin')}
          >
            Make admin
          </Button>
        ) : null}
        {member.role === 'admin' ? (
          <Button
            variant="secondary"
            icon={<ShieldOff size={18} aria-hidden="true" />}
            onClick={() => setOpen('remove-admin')}
          >
            Remove admin
          </Button>
        ) : null}

        {!isMe ? (
          <Button variant="secondary" icon={<KeyRound size={18} aria-hidden="true" />} onClick={() => setOpen('reset')}>
            Reset password
          </Button>
        ) : null}

        {!isMe ? (
          <Button variant="danger" icon={<UserX size={18} aria-hidden="true" />} onClick={() => setOpen('remove')}>
            Remove member
          </Button>
        ) : null}
      </div>

      {isMe ? (
        <p className="text-sm text-fg-muted">
          This is you. Another admin has to change your status, and you change your own password from your Profile.
        </p>
      ) : null}
      {!setUp ? (
        <p className="text-sm text-fg-muted">
          They haven&apos;t finished signing up yet, so there&apos;s nothing to approve or edit.
        </p>
      ) : null}

      {open === 'approve' ? (
        <ApproveSheet
          approval={asApproval(member)}
          onClose={close}
          onApproved={() => {
            close()
            onChanged()
          }}
        />
      ) : null}

      {open === 'reject' ? <RejectDialog member={member} onClose={close} onRejected={onChanged} /> : null}

      {open === 'suspend' ? (
        <ReasonConfirmDialog
          title={`Suspend ${name}?`}
          description="They won't be able to post or request shifts. Their upcoming open posts come down and their pending requests close. Confirmed trades stay; void them from Trades if needed."
          confirmLabel="Suspend"
          reason="required"
          reasonHint="They see this in their alert."
          action={(reason) => setMemberStatus(createClient(), member.id, 'suspended', reason)}
          successTitle={`${name} is suspended`}
          failureTitle={`Couldn't suspend ${name}`}
          onClose={close}
          onDone={onChanged}
        />
      ) : null}

      {open === 'reactivate' ? (
        <ReasonConfirmDialog
          title={`Reactivate ${name}?`}
          description="They can trade again right away. Posts taken down when they were suspended don't come back."
          confirmLabel="Reactivate"
          tone="primary"
          reason="optional"
          action={(reason) => setMemberStatus(createClient(), member.id, 'approved', reason)}
          successTitle={`${name} is active again`}
          failureTitle={`Couldn't reactivate ${name}`}
          onClose={close}
          onDone={onChanged}
        />
      ) : null}

      {open === 'make-admin' ? (
        <ReasonConfirmDialog
          title={`Make ${name} an admin?`}
          description="Admins approve sign-ups, edit members, reset passwords, void trades and can see everyone's phone and email."
          confirmLabel="Make admin"
          tone="primary"
          reason="none"
          action={() => setMemberRole(createClient(), member.id, 'admin')}
          successTitle={`${name} is now an admin`}
          failureTitle={`Couldn't make ${name} an admin`}
          onClose={close}
          onDone={onChanged}
        />
      ) : null}

      {open === 'remove-admin' ? (
        <ReasonConfirmDialog
          title={isMe ? 'Remove your own admin access?' : `Remove admin access from ${name}?`}
          description={
            isMe
              ? "You'll lose access to the admin panel right away. Another admin can give it back."
              : 'They stay a member and can keep trading.'
          }
          confirmLabel="Remove admin"
          reason="none"
          action={() => setMemberRole(createClient(), member.id, 'member')}
          successTitle={isMe ? "You're no longer an admin" : `${name} is no longer an admin`}
          failureTitle="Couldn't remove admin access"
          onClose={close}
          onDone={() => {
            // A full page load, so every screen forgets the admin role at once.
            if (isMe) window.location.replace('/calendar')
            else onChanged()
          }}
        />
      ) : null}

      {open === 'reset' ? <ResetPasswordDialog member={member} onClose={close} onReset={onChanged} /> : null}

      {open === 'remove' ? <RemoveMemberDialog member={member} onClose={close} onRemoved={onChanged} /> : null}
    </div>
  )
}
