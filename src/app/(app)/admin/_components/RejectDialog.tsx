'use client'

import { rejectMember } from '@/lib/api'
import { createClient } from '@/lib/supabase/client'
import type { Profile } from '@/lib/types/database'
import { ReasonConfirmDialog } from './ReasonConfirmDialog'

export interface RejectDialogProps {
  member: Pick<Profile, 'id' | 'full_name' | 'email'>
  onClose: () => void
  onRejected: () => void
}

/** Turn down a sign-up. A reason is required: the applicant sees it. */
export function RejectDialog({ member, onClose, onRejected }: RejectDialogProps) {
  const name = member.full_name || member.email || 'this applicant'
  return (
    <ReasonConfirmDialog
      title={`Reject ${name}?`}
      description="They'll see your reason and won't be able to trade. You can still approve them later from Members."
      confirmLabel="Reject"
      reason="required"
      reasonHint="Shown to them. For example: “You're not on the fire-side roster. Text Brian if that's wrong.”"
      action={(reason) => rejectMember(createClient(), member.id, reason)}
      successTitle={`${name} was turned down`}
      failureTitle={`Couldn't reject ${name}`}
      onClose={onClose}
      onDone={onRejected}
    />
  )
}
