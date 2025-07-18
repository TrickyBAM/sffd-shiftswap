"use client"

import { useState } from 'react'
import { doc, updateDoc, addDoc, collection, Timestamp } from 'firebase/firestore'
import { auth, db } from '@/lib/firebase'
import { useRouter } from 'next/navigation'
import type { Shift } from '@/types/sffd'

interface Props {
  shift: Shift
}

/**
 * Renders a single shift with details and an Accept button.
 *
 * When the user clicks Accept, a matched trade document is
 * created and the shift status is updated to `covered`.  If the
 * user is not logged in, they are redirected to the login page.
 */
export default function ShiftCard({ shift }: Props) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const user = auth.currentUser

  const handleAccept = async () => {
    if (!user) {
      router.push('/login')
      return
    }
    setLoading(true)
    try {
      // Create a new matched trade document.  The return date will be
      // the first item in the returnDates array if it exists.  You can
      // extend this logic to allow the user to choose a return date.
      await addDoc(collection(db, 'matchedTrades'), {
        originalShiftId: shift.id,
        originalDate: shift.date,
        returnDate: shift.returnDates?.[0] ?? null,
        posterUid: shift.posterUid,
        takerUid: user.uid,
        status: 'confirmed',
        createdAt: Timestamp.now(),
      })
      // Update the shift status to indicate it has been covered.
      await updateDoc(doc(db, 'shifts', shift.id), { status: 'covered' })
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="border p-4 rounded shadow bg-white space-y-2">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-semibold">
            {shift.date} ({shift.shiftType})
          </h2>
          <p className="text-sm text-gray-500">
            {shift.station} – {shift.rank}
          </p>
        </div>
        <button
          onClick={handleAccept}
          className="bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded disabled:opacity-50"
          disabled={loading || shift.status !== 'open'}
        >
          {loading ? 'Processing…' : 'Accept'}
        </button>
      </div>
    </div>
  )
}