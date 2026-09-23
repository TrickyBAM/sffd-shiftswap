import type { Metadata } from 'next'
import { Suspense } from 'react'
import AppHeader from '@/components/AppHeader'
import { LoadingBlock } from '@/components/ui'
import { BoardView } from './_components/BoardView'

export const metadata: Metadata = { title: 'Board' }

export default function BoardPage() {
  return (
    <>
      <AppHeader title="Shift Board" />
      <div className="mx-auto max-w-3xl px-4 pb-8 pt-4 md:px-6">
        {/* BoardView reads ?date and ?shift with useSearchParams. */}
        <Suspense fallback={<LoadingBlock label="Loading open shifts…" cards={3} />}>
          <BoardView />
        </Suspense>
      </div>
    </>
  )
}
