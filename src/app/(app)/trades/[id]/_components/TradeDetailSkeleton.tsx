import { Skeleton, SkeletonCard } from '@/components/ui'

/** Placeholder for the trade page while it loads. */
export function TradeDetailSkeleton() {
  return (
    <div role="status" aria-live="polite" className="space-y-4">
      <span className="sr-only">Loading this trade…</span>
      <div className="rounded-2xl border border-line bg-card p-4">
        <Skeleton className="h-5 w-24" />
        <Skeleton className="mt-3 h-8 w-3/4" />
        <Skeleton className="mt-3 h-4 w-1/2" />
        <Skeleton className="mt-2 h-4 w-2/3" />
      </div>
      <SkeletonCard />
      <SkeletonCard />
    </div>
  )
}
