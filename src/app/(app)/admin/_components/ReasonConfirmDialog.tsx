'use client'

import { useState, type ReactNode } from 'react'
import { ConfirmDialog, useToast } from '@/components/ui'
import { FormAlert } from '@/components/forms/FormAlert'
import { toAppError } from '@/lib/errors'
import { ReasonField, reasonOk } from './ReasonField'

export interface ReasonConfirmDialogProps {
  title: string
  description?: ReactNode
  confirmLabel: string
  tone?: 'danger' | 'primary'
  /** 'required' (at least a few characters), 'optional', or 'none' (no reason box). */
  reason?: 'required' | 'optional' | 'none'
  reasonLabel?: string
  reasonHint?: string
  reasonPlaceholder?: string
  /** Makes the change. Throws (an AppError) on failure. */
  action: (reason: string) => Promise<void>
  /** Toast shown after it worked. */
  successTitle: string
  successDescription?: string
  /** Toast title when it failed; the friendly error message is the description. */
  failureTitle: string
  onClose: () => void
  /** Called after a successful change, before the dialog closes (reload lists here). */
  onDone: () => void
  /** Extra content shown above the reason box. */
  children?: ReactNode
}

/**
 * An admin confirmation with an optional or required reason. Failures keep
 * the dialog open, show the friendly message inside it and as a toast.
 */
export function ReasonConfirmDialog({
  title,
  description,
  confirmLabel,
  tone = 'danger',
  reason: reasonMode = 'optional',
  reasonLabel,
  reasonHint,
  reasonPlaceholder,
  action,
  successTitle,
  successDescription,
  failureTitle,
  onClose,
  onDone,
  children,
}: ReasonConfirmDialogProps) {
  const toast = useToast()
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)

  async function confirm() {
    setError(null)
    try {
      await action(reasonMode === 'none' ? '' : reason.trim())
    } catch (err) {
      const failure = toAppError(err)
      setError(failure.message)
      toast.error(failure.code === 'LAST_ADMIN' ? 'ShiftSwap needs at least one admin' : failureTitle, failure.message)
      throw err
    }
    toast.success(successTitle, successDescription)
    onDone()
  }

  return (
    <ConfirmDialog
      open
      onClose={onClose}
      onConfirm={confirm}
      title={title}
      description={description}
      confirmLabel={confirmLabel}
      tone={tone}
      confirmDisabled={reasonMode === 'required' && !reasonOk(reason)}
    >
      <div className="space-y-4">
        {children}
        {reasonMode !== 'none' ? (
          <ReasonField
            value={reason}
            onChange={(value) => {
              setReason(value)
              if (error) setError(null)
            }}
            label={reasonLabel ?? (reasonMode === 'required' ? 'Reason' : 'Reason (optional)')}
            hint={reasonHint}
            required={reasonMode === 'required'}
            placeholder={reasonPlaceholder}
          />
        ) : null}
        {error ? <FormAlert>{error}</FormAlert> : null}
      </div>
    </ConfirmDialog>
  )
}
