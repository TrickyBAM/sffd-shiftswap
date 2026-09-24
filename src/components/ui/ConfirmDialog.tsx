'use client'

import { useRef, useState, type ReactNode } from 'react'
import { Button } from './Button'
import { Dialog } from './Dialog'

export interface ConfirmDialogProps {
  open: boolean
  onClose: () => void
  /**
   * Runs when the user confirms. May be async: the button shows a spinner and the dialog
   * stays open until it settles. It closes on success; on a thrown error it stays open —
   * show the error yourself (e.g. with a toast) inside onConfirm.
   */
  onConfirm: () => void | Promise<void>
  title: ReactNode
  description?: ReactNode
  confirmLabel?: string
  cancelLabel?: string
  /** 'danger' for destructive actions (cancel a trade, void, reject). */
  tone?: 'danger' | 'primary'
  /** Extra content, e.g. a "reason" textarea. */
  children?: ReactNode
  /** Disable the confirm button (e.g. until a required reason is typed). */
  confirmDisabled?: boolean
}

export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  description,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  tone = 'primary',
  children,
  confirmDisabled = false,
}: ConfirmDialogProps) {
  const [busy, setBusy] = useState(false)
  // Safer default focus: the non-destructive choice.
  const cancelRef = useRef<HTMLButtonElement>(null)

  async function handleConfirm() {
    if (busy) return
    setBusy(true)
    try {
      await onConfirm()
      onClose()
    } catch {
      // Keep the dialog open; the caller reports the error.
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog
      open={open}
      onClose={busy ? () => {} : onClose}
      role="alertdialog"
      title={title}
      description={description}
      initialFocusRef={cancelRef}
      closeOnOverlay={!busy}
      closeOnEscape={!busy}
      actions={
        <>
          <Button ref={cancelRef} variant="secondary" onClick={onClose} disabled={busy}>
            {cancelLabel}
          </Button>
          <Button
            variant={tone === 'danger' ? 'danger' : 'primary'}
            onClick={handleConfirm}
            loading={busy}
            disabled={confirmDisabled}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      {children}
    </Dialog>
  )
}
