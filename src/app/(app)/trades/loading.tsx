import AppHeader from '@/components/AppHeader'
import { TradesSkeleton } from './_components/TradesSkeleton'

export default function TradesLoading() {
  return (
    <>
      <AppHeader title="Trades" />
      <div className="mx-auto max-w-3xl px-4 py-4 md:px-6">
        <TradesSkeleton />
      </div>
    </>
  )
}
