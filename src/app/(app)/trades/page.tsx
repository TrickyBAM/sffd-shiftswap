import { Suspense } from 'react'
import type { Metadata } from 'next'
import AppHeader from '@/components/AppHeader'
import { TradesHub } from './_components/TradesHub'
import { TradesSkeleton } from './_components/TradesSkeleton'

export const metadata: Metadata = { title: 'Trades' }

export default function TradesPage() {
  return (
    <>
      <AppHeader title="Trades" subtitle="Requests, confirmed trades and who owes whom" />
      <div className="mx-auto max-w-3xl px-4 py-4 md:px-6">
        {/* TradesHub reads ?tab= with useSearchParams, which needs a Suspense boundary. */}
        <Suspense fallback={<TradesSkeleton />}>
          <TradesHub />
        </Suspense>
      </div>
    </>
  )
}
