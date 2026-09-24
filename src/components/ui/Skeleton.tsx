import { cn } from './cn'

export interface SkeletonProps {
  className?: string
}

/** Placeholder block with a gentle shimmer (static when reduced motion is on). */
export function Skeleton({ className }: SkeletonProps) {
  return <div aria-hidden="true" className={cn('animate-shimmer rounded-lg bg-elevated', className)} />
}

export interface SkeletonTextProps {
  lines?: number
  className?: string
}

export function SkeletonText({ lines = 3, className }: SkeletonTextProps) {
  return (
    <div aria-hidden="true" className={cn('space-y-2', className)}>
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton key={i} className={cn('h-3.5', i === lines - 1 && lines > 1 ? 'w-2/3' : 'w-full')} />
      ))}
    </div>
  )
}

export function SkeletonCard({ className }: SkeletonProps) {
  return (
    <div aria-hidden="true" className={cn('rounded-2xl border border-line bg-card p-4', className)}>
      <div className="mb-4 flex items-center gap-3">
        <Skeleton className="h-10 w-10 rounded-full" />
        <div className="flex-1 space-y-2">
          <Skeleton className="h-4 w-1/2" />
          <Skeleton className="h-3 w-1/3" />
        </div>
      </div>
      <SkeletonText lines={2} />
    </div>
  )
}

export interface LoadingBlockProps {
  /** Screen-reader text; defaults to "Loading…". */
  label?: string
  /** How many skeleton cards to show. */
  cards?: number
  className?: string
}

/** A list of skeleton cards announced once as a polite status message. */
export function LoadingBlock({ label = 'Loading…', cards = 3, className }: LoadingBlockProps) {
  return (
    <div role="status" aria-live="polite" className={cn('space-y-3', className)}>
      <span className="sr-only">{label}</span>
      {Array.from({ length: cards }, (_, i) => (
        <SkeletonCard key={i} />
      ))}
    </div>
  )
}
