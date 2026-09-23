import AppHeader from '@/components/AppHeader'
import { TradeDetailSkeleton } from './_components/TradeDetailSkeleton'

export default function TradeLoading() {
  return (
    <>
      <AppHeader title="Trade" back={{ href: '/trades', label: 'Back to Trades' }} />
      <div className="mx-auto max-w-3xl px-4 pb-8 pt-4 md:px-6">
        <TradeDetailSkeleton />
      </div>
    </>
  )
}
