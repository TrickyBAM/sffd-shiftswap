import { LoadingBlock, Skeleton } from '@/components/ui'

/** Placeholder for the Trades hub: the tab bar plus a few cards. */
export function TradesSkeleton() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-[54px] w-full rounded-2xl" />
      <LoadingBlock label="Loading your trades…" cards={3} />
    </div>
  )
}
