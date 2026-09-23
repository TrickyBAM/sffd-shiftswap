import { Skeleton, SkeletonText } from '@/components/ui/Skeleton'

/** Shown while a joining step's server data loads. Mirrors OnboardHeader + a card. */
export default function OnboardLoading() {
  return (
    <div role="status" aria-live="polite">
      <span className="sr-only">Loading…</span>
      <div aria-hidden="true" className="glass-nav sticky top-0 z-30 border-b border-line pt-safe px-safe">
        <div className="mx-auto max-w-xl space-y-2 px-4 py-3">
          <Skeleton className="h-4 w-28" />
          <Skeleton className="h-7 w-48" />
        </div>
      </div>
      <div aria-hidden="true" className="mx-auto w-full max-w-xl space-y-4 px-4 py-6">
        <div className="rounded-2xl border border-line bg-card p-5">
          <SkeletonText lines={3} />
        </div>
        <div className="space-y-3 rounded-2xl border border-line bg-card p-5">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-12 w-full rounded-xl" />
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-12 w-full rounded-xl" />
        </div>
      </div>
    </div>
  )
}
