'use client'

import type { ReactNode } from 'react'
import { AlertTriangle, RotateCw } from 'lucide-react'
import { Button } from './Button'
import { cn } from './cn'

export interface ErrorStateProps {
  title?: ReactNode
  /** The friendly message to show (e.g. AppError.message from the API layer). */
  message?: ReactNode
  /** Shows a "Try again" button when provided. */
  onRetry?: () => void
  retrying?: boolean
  retryLabel?: string
  /** Extra actions next to Retry (e.g. a "Go to calendar" link). */
  action?: ReactNode
  className?: string
}

/** Inline error for a data view that failed to load. Announced to screen readers. */
export function ErrorState({
  title = "Couldn't load this",
  message = 'Check your connection and try again.',
  onRetry,
  retrying = false,
  retryLabel = 'Try again',
  action,
  className,
}: ErrorStateProps) {
  return (
    <div
      role="alert"
      className={cn(
        'flex flex-col items-center rounded-2xl border border-sffd-red/25 bg-sffd-red/[0.06] px-6 py-8 text-center',
        className,
      )}
    >
      <div
        aria-hidden="true"
        className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-sffd-red/15 text-sffd-red-text"
      >
        <AlertTriangle size={24} />
      </div>
      <p className="font-display text-2xl text-fg">{title}</p>
      {message ? <p className="mt-1 max-w-sm text-sm text-fg-muted">{message}</p> : null}
      {onRetry || action ? (
        <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
          {onRetry ? (
            <Button
              variant="secondary"
              onClick={onRetry}
              loading={retrying}
              icon={<RotateCw size={16} aria-hidden="true" />}
            >
              {retryLabel}
            </Button>
          ) : null}
          {action}
        </div>
      ) : null}
    </div>
  )
}
