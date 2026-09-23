import { Suspense } from 'react'
import type { Metadata } from 'next'
import AppHeader from '@/components/AppHeader'
import { Card } from '@/components/ui'
import { CalendarView } from './_components/CalendarView'
import { MonthGridSkeleton } from './_components/MonthGrid'

export const metadata: Metadata = {
  title: 'Calendar',
}

/** Home (ARCHITECTURE §7.1): my month, what's coming up and my balance. ?month=YYYY-MM opens a month. */
export default function CalendarPage() {
  return (
    // CalendarView reads ?month= with useSearchParams, which needs a Suspense boundary.
    <Suspense fallback={<CalendarFallback />}>
      <CalendarView />
    </Suspense>
  )
}

function CalendarFallback() {
  return (
    <>
      <AppHeader title="Calendar" />
      <div className="mx-auto max-w-3xl space-y-4 px-4 pb-6 pt-4 md:px-6">
        <Card padding="none" className="p-2 sm:p-4">
          <MonthGridSkeleton />
        </Card>
      </div>
    </>
  )
}
