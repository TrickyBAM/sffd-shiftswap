'use client'

import { useId, type ReactNode, type RefObject } from 'react'
import { Modal } from './Modal'
import { cn } from './cn'

export interface DialogProps {
  open: boolean
  onClose: () => void
  title: ReactNode
  description?: ReactNode
  /** Use 'alertdialog' for confirmations that interrupt the user. */
  role?: 'dialog' | 'alertdialog'
  /** Buttons row, right-aligned on desktop and stacked full-width on phones. */
  actions?: ReactNode
  initialFocusRef?: RefObject<HTMLElement | null>
  closeOnOverlay?: boolean
  closeOnEscape?: boolean
  className?: string
  children?: ReactNode
}

/** Small centered dialog (confirmations, short forms). */
export function Dialog({
  open,
  onClose,
  title,
  description,
  role = 'dialog',
  actions,
  initialFocusRef,
  closeOnOverlay = true,
  closeOnEscape = true,
  className,
  children,
}: DialogProps) {
  const id = useId()
  const titleId = `dialog-${id}-title`
  const descriptionId = description ? `dialog-${id}-desc` : undefined

  return (
    <Modal
      open={open}
      onClose={onClose}
      role={role}
      labelledBy={titleId}
      describedBy={descriptionId}
      initialFocusRef={initialFocusRef}
      closeOnOverlay={closeOnOverlay}
      closeOnEscape={closeOnEscape}
      placement="center"
      panelClassName={cn('p-5', className)}
    >
      <h2 id={titleId} className="font-display text-2xl leading-tight text-fg">
        {title}
      </h2>
      {description ? (
        <p id={descriptionId} className="mt-1 text-sm text-fg-muted">
          {description}
        </p>
      ) : null}
      {children ? <div className="mt-4 min-h-0 overflow-y-auto">{children}</div> : null}
      {actions ? (
        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">{actions}</div>
      ) : null}
    </Modal>
  )
}
