import type { ReactNode } from 'react'
import { AlertTriangle } from 'lucide-react'
import { cn } from '@/components/ui/cn'

export interface FormAlertProps {
  children: ReactNode
  /** Extra content under the message (e.g. a link). */
  action?: ReactNode
  className?: string
}

/** A form-level error (e.g. "That email and password don't match"), announced when it appears. */
export function FormAlert({ children, action, className }: FormAlertProps) {
  return (
    <div
      role="alert"
      className={cn(
        'flex items-start gap-3 rounded-xl border border-sffd-red/30 bg-sffd-red/10 px-4 py-3 text-sm text-fg',
        className,
      )}
    >
      <AlertTriangle size={18} aria-hidden="true" className="mt-0.5 shrink-0 text-sffd-red-text" />
      <div className="min-w-0 space-y-1">
        <p>{children}</p>
        {action}
      </div>
    </div>
  )
}
