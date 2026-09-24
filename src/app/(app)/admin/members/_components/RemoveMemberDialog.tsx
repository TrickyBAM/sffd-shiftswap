'use client'

import { useState } from 'react'
import { ConfirmDialog, useToast } from '@/components/ui'
import { FormAlert } from '@/components/forms/FormAlert'
import { AppError, NETWORK_MESSAGE } from '@/lib/errors'
import type { Profile } from '@/lib/types/database'
import { removeMember } from '../../actions'
import { ReasonField, reasonOk } from '../../_components/ReasonField'
import { loginClosureWarning, removalSummary } from '../_lib/remove'

export interface RemoveMemberDialogProps {
  member: Pick<Profile, 'id' | 'full_name' | 'email'>
  onClose: () => void
  /** Called after the account was removed (reload the member and the list). */
  onRemoved: () => void
}

/**
 * Removes a member's account at their request (privacy page "Removing your
 * account"). Says exactly what happens, asks for a reason for the activity
 * log, then runs the removeMember server action.
 */
export function RemoveMemberDialog({ member, onClose, onRemoved }: RemoveMemberDialogProps) {
  const toast = useToast()
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)
  const name = member.full_name || member.email || 'this member'

  async function confirm() {
    setError(null)
    let result: Awaited<ReturnType<typeof removeMember>>
    try {
      result = await removeMember(member.id, reason.trim())
    } catch {
      result = { ok: false, code: 'NETWORK', message: NETWORK_MESSAGE }
    }
    if (!result.ok) {
      setError(result.message)
      toast.error(result.code === 'LAST_ADMIN' ? 'ShiftSwap needs at least one admin' : `Couldn't remove ${name}`, result.message)
      throw new AppError(result.code, result.message)
    }
    toast.success(`${name}'s account was removed`, removalSummary(result.board))
    const warning = loginClosureWarning(result.login)
    if (warning) toast.show({ tone: 'warning', title: 'Their login needs another try', description: warning, duration: 0 })
    onRemoved()
  }

  return (
    <ConfirmDialog
      open
      onClose={onClose}
      onConfirm={confirm}
      title={`Remove ${name}'s account?`}
      description="Only do this when they ask to leave ShiftSwap. It can't be undone."
      confirmLabel="Remove member"
      tone="danger"
      confirmDisabled={!reasonOk(reason)}
    >
      <div className="space-y-4">
        <ul className="list-disc space-y-1.5 pl-5 text-sm text-fg-muted">
          <li>
            Their <span className="text-fg">phone number, email and employee ID are erased</span>, their alerts are
            switched off and their calendar link stops working.
          </li>
          <li>
            They <span className="text-fg">can&apos;t sign in any more</span>. If they come back, they sign up again with
            their email.
          </li>
          <li>
            Their open posts come down and pending requests close. Confirmed trades stay; void them in Trades if they
            won&apos;t happen.
          </li>
          <li>
            <span className="text-fg">Trade history keeps their name</span>, so other members&apos; past trades and
            balances still make sense.
          </li>
        </ul>
        <ReasonField
          value={reason}
          onChange={(value) => {
            setReason(value)
            if (error) setError(null)
          }}
          label="Reason"
          hint="Kept in the activity log."
          required
          placeholder="For example: Retired. Asked by text on Sep 23 to be removed."
        />
        {error ? <FormAlert>{error}</FormAlert> : null}
      </div>
    </ConfirmDialog>
  )
}
