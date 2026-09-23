'use client'

import { useId, type ReactNode, type RefObject } from 'react'
import { X } from 'lucide-react'
import { Modal } from './Modal'
import { cn } from './cn'

export interface SheetProps {
  open: boolean
  onClose: () => void
  /** Visible heading; also the dialog's accessible name. */
  title: ReactNode
  /** Optional line under the title, linked with aria-describedby. */
  description?: ReactNode
  /** Visually hide the title (it still names the dialog for screen readers). */
  hideTitle?: boolean
  /** Sticky actions at the bottom (buttons). Padded for the iPhone home indicator. */
  footer?: ReactNode
  initialFocusRef?: RefObject<HTMLElement | null>
  /** Default true. Turn off while a form inside has unsaved input or a request is running. */
  closeOnOverlay?: boolean
  closeOnEscape?: boolean
  className?: string
  children?: ReactNode
}

/**
 * Accessible bottom sheet (centered card on desktop).
 *
 *   <Sheet open={open} onClose={() => setOpen(false)} title="Request this shift"
 *          footer={<Button fullWidth onClick={submit}>Send request</Button>}>
 *     …
 *   </Sheet>
 */
export function Sheet({
  open,
  onClose,
  title,
  description,
  hideTitle = false,
  footer,
  initialFocusRef,
  closeOnOverlay = true,
  closeOnEscape = true,
  className,
  children,
}: SheetProps) {
  const id = useId()
  const titleId = `sheet-${id}-title`
  const descriptionId = description ? `sheet-${id}-desc` : undefined

  return (
    <Modal
      open={open}
      onClose={onClose}
      labelledBy={titleId}
      describedBy={descriptionId}
      initialFocusRef={initialFocusRef}
      closeOnOverlay={closeOnOverlay}
      closeOnEscape={closeOnEscape}
      placement="sheet"
      panelClassName={cn('px-safe', className)}
    >
      {/* Grab handle: a visual cue only (drag-to-dismiss is not implemented). */}
      <div aria-hidden="true" className="flex justify-center pt-2.5 md:hidden">
        <span className="h-1.5 w-10 rounded-full bg-white/20" />
      </div>

      <div className="flex items-start gap-3 px-5 pb-2 pt-3 md:pt-5">
        <div className="min-w-0 flex-1">
          <h2 id={titleId} className={cn('font-display text-2xl leading-tight text-fg', hideTitle && 'sr-only')}>
            {title}
          </h2>
          {description ? (
            <p id={descriptionId} className="mt-0.5 text-sm text-fg-muted">
              {description}
            </p>
          ) : null}
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="-mr-2 -mt-1 inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-fg-muted hover:bg-white/[0.06] hover:text-fg"
        >
          <X size={20} aria-hidden="true" />
        </button>
      </div>

      <div className={cn('min-h-0 flex-1 overflow-y-auto overscroll-contain px-5', footer ? 'pb-4' : 'pb-safe-sheet')}>
        {children}
      </div>

      {footer ? (
        <div className="pb-safe-sheet border-t border-line bg-card/95 px-5 pt-3">{footer}</div>
      ) : null}
    </Modal>
  )
}
