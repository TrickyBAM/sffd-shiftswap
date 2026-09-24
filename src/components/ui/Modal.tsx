'use client'

import { useEffect, useEffectEvent, useRef, type ReactNode, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { useIsClient } from '@/hooks/useIsClient'
import { cn } from './cn'

/*
 * Shared modal machinery for Sheet, Dialog and ConfirmDialog:
 * portal to <body>, role=dialog + aria-modal + aria-labelledby, focus moved in on open,
 * Tab/Shift+Tab trapped, Esc and overlay tap close, focus restored on close, body scroll
 * locked. A module-level stack makes nested modals behave: only the top one reacts.
 */

const FOCUSABLE = [
  'a[href]',
  'area[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  'iframe',
  'summary',
  '[contenteditable="true"]',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

function focusableIn(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (el) => !el.hasAttribute('inert') && el.getClientRects().length > 0,
  )
}

const modalStack: object[] = []
const isTop = (token: object) => modalStack[modalStack.length - 1] === token

let scrollLocks = 0
let savedOverflow = ''
let savedPaddingRight = ''

function lockScroll() {
  if (scrollLocks++ > 0) return
  const body = document.body
  savedOverflow = body.style.overflow
  savedPaddingRight = body.style.paddingRight
  // Keep the layout from shifting when the desktop scrollbar disappears.
  const scrollbar = window.innerWidth - document.documentElement.clientWidth
  if (scrollbar > 0) body.style.paddingRight = `${scrollbar}px`
  body.style.overflow = 'hidden'
}

function unlockScroll() {
  if (--scrollLocks > 0) return
  scrollLocks = 0
  document.body.style.overflow = savedOverflow
  document.body.style.paddingRight = savedPaddingRight
}

export interface ModalProps {
  open: boolean
  onClose: () => void
  /** id of the element that names the dialog (its visible title). */
  labelledBy: string
  describedBy?: string
  role?: 'dialog' | 'alertdialog'
  /** Element to focus on open; defaults to the panel itself so the title is read first. */
  initialFocusRef?: RefObject<HTMLElement | null>
  closeOnOverlay?: boolean
  closeOnEscape?: boolean
  /** 'sheet' = bottom sheet on phones / centered card on desktop; 'center' = always centered. */
  placement: 'sheet' | 'center'
  panelClassName?: string
  children: ReactNode
}

export function Modal({
  open,
  onClose,
  labelledBy,
  describedBy,
  role = 'dialog',
  initialFocusRef,
  closeOnOverlay = true,
  closeOnEscape = true,
  placement,
  panelClassName,
  children,
}: ModalProps) {
  const isClient = useIsClient()
  const panelRef = useRef<HTMLDivElement>(null)

  const requestClose = useEffectEvent(() => onClose())
  const escapeCloses = useEffectEvent(() => closeOnEscape)
  const getInitialFocus = useEffectEvent(() => initialFocusRef?.current ?? null)

  useEffect(() => {
    if (!open || !isClient) return
    const panel = panelRef.current
    if (!panel) return

    const token = {}
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null
    modalStack.push(token)
    lockScroll()
    ;(getInitialFocus() ?? panel).focus({ preventScroll: true })

    const onKeyDown = (event: KeyboardEvent) => {
      if (!isTop(token)) return
      if (event.key === 'Escape') {
        if (!escapeCloses()) return
        event.preventDefault()
        event.stopPropagation()
        requestClose()
        return
      }
      if (event.key !== 'Tab') return
      const items = focusableIn(panel)
      if (items.length === 0) {
        event.preventDefault()
        panel.focus({ preventScroll: true })
        return
      }
      const first = items[0]
      const last = items[items.length - 1]
      const active = document.activeElement
      if (event.shiftKey && (active === first || active === panel || !panel.contains(active))) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && (active === last || !panel.contains(active))) {
        event.preventDefault()
        first.focus()
      }
    }

    // Pull focus back if it escapes (e.g. a click on the page behind), except into the
    // toast region, whose action buttons must stay usable while a sheet is open.
    const onFocusIn = (event: FocusEvent) => {
      if (!isTop(token)) return
      const target = event.target as Node | null
      if (!target || panel.contains(target)) return
      if (target instanceof Element && target.closest('[data-toast-region]')) return
      panel.focus({ preventScroll: true })
    }

    document.addEventListener('keydown', onKeyDown)
    document.addEventListener('focusin', onFocusIn)

    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.removeEventListener('focusin', onFocusIn)
      const index = modalStack.indexOf(token)
      if (index >= 0) modalStack.splice(index, 1)
      unlockScroll()
      if (previouslyFocused?.isConnected) previouslyFocused.focus({ preventScroll: true })
    }
  }, [open, isClient])

  if (!open || !isClient) return null

  return createPortal(
    <div
      className={cn(
        'fixed inset-0 z-[70] flex justify-center',
        placement === 'sheet' ? 'items-end md:items-center md:p-6' : 'items-center p-4',
      )}
    >
      <div
        aria-hidden="true"
        className="animate-fade-in absolute inset-0 bg-black/70 backdrop-blur-[2px]"
        onClick={closeOnOverlay ? () => onClose() : undefined}
      />
      <div
        ref={panelRef}
        role={role}
        aria-modal="true"
        aria-labelledby={labelledBy}
        aria-describedby={describedBy}
        tabIndex={-1}
        className={cn(
          'relative flex w-full flex-col border border-line-strong bg-card shadow-2xl outline-none',
          placement === 'sheet'
            ? 'animate-sheet-up md:animate-pop-in max-h-[92dvh] rounded-t-3xl md:max-h-[85dvh] md:max-w-lg md:rounded-3xl'
            : 'animate-pop-in max-h-[85dvh] max-w-md rounded-3xl',
          panelClassName,
        )}
      >
        {children}
      </div>
    </div>,
    document.body,
  )
}
