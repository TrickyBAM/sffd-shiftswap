import { Skeleton, SkeletonCard } from '@/components/ui/Skeleton'

/**
 * Shown inside the app frame (navigation stays put) while a page's server data
 * loads. Mirrors AppHeader + a column of cards so nothing jumps when the page
 * arrives.
 */
export default function AppLoading() {
  return (
    <div role="status" aria-live="polite">
      <span className="sr-only">Loading…</span>
      <div aria-hidden="true" className="glass-nav sticky top-0 z-30 border-b border-line pt-safe px-safe">
        <div className="mx-auto flex min-h-16 max-w-3xl items-center gap-2 px-4 py-2 md:px-6">
          <Skeleton className="h-8 w-40" />
          <div className="flex-1" />
          <Skeleton className="h-11 w-11 rounded-full" />
        </div>
      </div>
      <div aria-hidden="true" className="mx-auto w-full max-w-3xl space-y-3 px-4 py-4 md:px-6">
        <Skeleton className="h-24 w-full rounded-2xl" />
        <SkeletonCard />
        <SkeletonCard />
        <SkeletonCard className="hidden sm:block" />
      </div>
    </div>
  )
}
