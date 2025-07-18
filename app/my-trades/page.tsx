"use client"

import { useEffect, useState } from 'react'
import { collection, query, where, onSnapshot } from 'firebase/firestore'
import { auth, db } from '@/lib/firebase'
import NavBar from '@/components/NavBar'

interface Trade {
  id: string
  originalShiftId: string
  originalDate: string
  returnDate: string | null
  posterUid: string
  takerUid: string
  status: 'confirmed' | 'completed' | 'cancelled'
}

/**
 * Displays the logged‑in user's trades.  Both trades they posted
 * and trades they have taken are shown.  The view listens to
 * Firestore for real‑time updates.
 */
export default function MyTradesPage() {
  const [trades, setTrades] = useState<Trade[]>([])
  const user = auth.currentUser

  useEffect(() => {
    if (!user) return
    const q = query(
      collection(db, 'matchedTrades'),
      where('posterUid', '==', user.uid)
    )
    const q2 = query(
      collection(db, 'matchedTrades'),
      where('takerUid', '==', user.uid)
    )
    const unsub1 = onSnapshot(q, (snap) => {
      setTrades((prev) => {
        const others = prev.filter((t) => t.posterUid !== user.uid)
        const newTrades = snap.docs.map((doc) => ({ id: doc.id, ...(doc.data() as any) }))
        return [...others, ...newTrades]
      })
    })
    const unsub2 = onSnapshot(q2, (snap) => {
      setTrades((prev) => {
        const others = prev.filter((t) => t.takerUid !== user.uid)
        const newTrades = snap.docs.map((doc) => ({ id: doc.id, ...(doc.data() as any) }))
        return [...others, ...newTrades]
      })
    })
    return () => {
      unsub1()
      unsub2()
    }
  }, [user])

  if (!user) {
    return <p className="p-4">Please log in to view your trades.</p>
  }
  return (
    <>
      <NavBar />
      <main className="container mx-auto p-4">
        <h1 className="text-2xl font-bold mb-4">My Trades</h1>
        {trades.length === 0 ? (
          <p className="text-gray-600">No trades found.</p>
        ) : (
          <ul className="space-y-2">
            {trades.map((trade) => (
              <li key={trade.id} className="border p-4 rounded bg-white shadow">
                <p className="font-semibold">Original Date: {trade.originalDate}</p>
                <p>Return Date: {trade.returnDate || 'n/a'}</p>
                <p>Status: {trade.status}</p>
              </li>
            ))}
          </ul>
        )}
      </main>
    </>
  )
}