'use client'

import { ConfirmDialog, useToast } from '@/components/ui'
import { withdrawRequest } from '@/lib/api'
import { toAppError } from '@/lib/errors'
import { createClient } from '@/lib/supabase/client'
import type { ShiftRequest } from '@/lib/types/database'
import { isStaleDataError, toastActionError } from '../_lib/errors'

/** Same wording wherever a member withdraws a request (UX-05). */
export const WITHDRAW_REQUEST_TITLE = 'Withdraw your request?'
export const WITHDRAW_REQUEST_DESCRIPTION = "You'll lose your place in line."

export interface WithdrawRequestDialogProps {
  /** The pending request to withdraw; the dialog is open while this is set. */
  request: ShiftRequest | null
  /** Who gets told ("Mike Lee has been told."). */
  posterName: string
  onClose: () => void
  /** After it's withdrawn, or when the page turned out to be out of date. */
  onChanged: () => void | Promise<void>
}

/**
 * Asks before withdrawing a request: pending requests are answered oldest
 * first, so asking again later puts the member at the back of the line.
 */
export function WithdrawRequestDialog({ request, posterName, onClose, onChanged }: WithdrawRequestDialogProps) {
  const toast = useToast()

  async function withdraw() {
    if (!request) return
    try {
      await withdrawRequest(createClient(), request.id)
    } catch (err) {
      toastActionError(toast, err, "Couldn't withdraw your request")
      // Keep the dialog open only when trying again could help.
      if (toAppError(err).code === 'NETWORK') throw err
      if (isStaleDataError(err)) await onChanged()
      return
    }
    toast.success('Request withdrawn', `${posterName} has been told.`)
    await onChanged()
  }

  return (
    <ConfirmDialog
      open={request != null}
      onClose={onClose}
      onConfirm={withdraw}
      title={WITHDRAW_REQUEST_TITLE}
      description={WITHDRAW_REQUEST_DESCRIPTION}
      confirmLabel="Withdraw"
      cancelLabel="Keep request"
      tone="danger"
    />
  )
}
