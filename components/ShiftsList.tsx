"use client"

import { useEffect, useState } from 'react'
import { collection, query, where, orderBy, onSnapshot } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import ShiftCard from './ShiftCard'
import type { Shift } from '@/types/sffd'

/**
 * Fetches and renders a list of open shifts from Firestore.
 *
 * We listen to the `shifts` collection and filter for open shifts,
 * ordering them by date.  When the data changes, the component
 * updates automatically.  See the Firestore rules file for
 * permission restrictions.
 */
export default function ShiftsList() {
  const [shifts, setShifts] = useState<Shift[]>([])
  useEffect(() => {
    const q = query(
      collection(db, 'shifts'),
      where('status', '==', 'open'),
      orderBy('date')
    )
    const unsub = onSnapshot(q, (snapshot) => {
      const data: Shift[] = snapshot.docs.map((doc) => {
        // Cast Firestore data to our Shift type.  `id` is added
        // separately because it isn't included in doc.data().
        return {
          id: doc.id,
          ...(doc.data() as Omit<Shift, 'id'>),
        }
      })
      setShifts(data)
    })
    return () => unsub()
  }, [])
  if (shifts.length === 0) {
    return <p className="text-gray-600">No open shifts at the moment.</p>
  }
  return (
    <div className="grid gap-4">
      {shifts.map((shift) => (
        <ShiftCard key={shift.id} shift={shift} />
      ))}
    </div>
  )
}