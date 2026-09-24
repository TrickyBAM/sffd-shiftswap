import { Suspense } from 'react'
import type { Metadata } from 'next'
import { LoadingBlock } from '@/components/ui'
import { AdminFrame } from '../_components/AdminFrame'
import { TradesView } from './_components/TradesView'

export const metadata: Metadata = { title: 'Admin · Trades' }

export default function AdminTradesPage() {
  return (
    <AdminFrame title="Trades">
      {/* TradesView reads ?status= with useSearchParams, which needs a Suspense boundary. */}
      <Suspense fallback={<LoadingBlock label="Loading trades…" cards={3} />}>
        <TradesView />
      </Suspense>
    </AdminFrame>
  )
}
