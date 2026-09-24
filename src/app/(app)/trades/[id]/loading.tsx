import { TradeDetailSkeleton } from './_components/TradeDetailSkeleton'
import { TradeHeader } from './_components/TradeHeader'
import { TRADES_BACK } from './_lib/back-nav'

export default function TradeLoading() {
  return (
    <>
      <TradeHeader title="Trade" fallback={TRADES_BACK} />
      <div className="mx-auto max-w-3xl px-4 pb-8 pt-4 md:px-6">
        <TradeDetailSkeleton />
      </div>
    </>
  )
}
