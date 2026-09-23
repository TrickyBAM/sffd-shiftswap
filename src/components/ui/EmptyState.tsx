import type { ReactNode } from 'react'
import { cn } from './cn'

export interface EmptyStateProps {
  /** A lucide icon element, e.g. <CalendarX size={28} />. Rendered decoratively. */
  icon?: ReactNode
  title: ReactNode
  description?: ReactNode
  /** Usually a Button or a Link styled with buttonClasses(). */
  action?: ReactNode
  className?: string
}

export function EmptyState({ icon, title, description, action, className }: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center rounded-2xl border border-dashed border-line-strong px-6 py-10 text-center',
        className,
      )}
    >
      {icon ? (
        <div
          aria-hidden="true"
          className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl border border-line bg-card text-fg-dim"
        >
          {icon}
        </div>
      ) : null}
      <p className="font-display text-2xl text-fg">{title}</p>
      {description ? <p className="mt-1 max-w-sm text-sm text-fg-muted">{description}</p> : null}
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  )
}
