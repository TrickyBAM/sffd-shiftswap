import { Suspense } from 'react'
import NavBar from '@/components/NavBar'
import ShiftsList from '@/components/ShiftsList'

/**
 * Home page listing all open shifts available for trade.
 *
 * A top navigation bar is rendered to allow users to navigate the
 * application.  The list of shifts is loaded lazily via the
 * ShiftsList client component, which listens to Firestore for
 * updates in real time.
 */
export default function Home() {
  return (
    <>
      <NavBar />
      <main className="container mx-auto p-4">
        <h1 className="text-2xl font-bold mb-4">Open Shifts</h1>
        <Suspense fallback={<p>Loading shifts…</p>}>
          <ShiftsList />
        </Suspense>
      </main>
    </>
  )
}