import { Skeleton, SkeletonCard } from '@/components/ui/Skeleton'

/**
 * Default loading UI while a route's server data streams in. Mirrors the app layout
 * (header + cards) so the page doesn't jump when content arrives.
 */
export default function Loading() {
  return (
    <div role="status" aria-live="polite" className="mx-auto w-full max-w-3xl px-4 pt-safe md:px-6">
      <span className="sr-only">Loading…</span>
      <div aria-hidden="true" className="flex min-h-16 items-center gap-3 py-2">
        <Skeleton className="h-8 w-40" />
        <div className="flex-1" />
        <Skeleton className="h-11 w-11 rounded-full" />
      </div>
      <div className="mt-4 space-y-3">
        <Skeleton className="h-24 w-full rounded-2xl" />
        <SkeletonCard />
        <SkeletonCard />
      </div>
    </div>
  )
}
