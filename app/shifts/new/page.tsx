"use client"

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { addDoc, collection, Timestamp } from 'firebase/firestore'
import { auth, db } from '@/lib/firebase'

/**
 * Page for creating a new shift offer.  The user can specify the
 * date, shift type, rank and optional return dates.  The shift is
 * stored in the `shifts` collection with a status of `open` and
 * linked to the poster's UID.  If the user is not logged in,
 * they are redirected to the login page.
 */
import NavBar from '@/components/NavBar'

export default function NewShiftPage() {
  const router = useRouter()
  const user = auth.currentUser
  const [date, setDate] = useState('')
  const [shiftType, setShiftType] = useState<'24-Hour' | 'PM'>('24-Hour')
  const [rank, setRank] = useState('Firefighter')
  const [station, setStation] = useState('')
  const [battalion, setBattalion] = useState('')
  const [division, setDivision] = useState('')
  const [returnDates, setReturnDates] = useState('')

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!user) {
      router.push('/login')
      return
    }
    // Parse return dates as an array of strings separated by commas
    const returns = returnDates
      .split(',')
      .map((d) => d.trim())
      .filter((d) => d.length > 0)
    await addDoc(collection(db, 'shifts'), {
      posterUid: user.uid,
      posterName: user.email ?? '',
      date,
      shiftType,
      rank,
      station,
      battalion,
      division,
      returnDates: returns,
      acceptLimit: { type: '', value: '' },
      status: 'open',
      createdAt: Timestamp.now(),
    })
    router.push('/')
  }

  return (
    <>
      <NavBar />
      <main className="container mx-auto p-4">
        <h1 className="text-2xl font-bold mb-4">Post a New Shift</h1>
        <form onSubmit={handleSubmit} className="space-y-4 max-w-xl">
        <div>
          <label className="block text-sm font-medium mb-1" htmlFor="date">
            Date
          </label>
          <input
            id="date"
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="w-full border rounded px-3 py-2"
            required
          />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1" htmlFor="shiftType">
            Shift Type
          </label>
          <select
            id="shiftType"
            value={shiftType}
            onChange={(e) => setShiftType(e.target.value as '24-Hour' | 'PM')}
            className="w-full border rounded px-3 py-2"
          >
            <option value="24-Hour">24-Hour</option>
            <option value="PM">PM</option>
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium mb-1" htmlFor="rank">
            Rank
          </label>
          <select
            id="rank"
            value={rank}
            onChange={(e) => setRank(e.target.value)}
            className="w-full border rounded px-3 py-2"
          >
            <option value="Firefighter">Firefighter</option>
            <option value="EMT">EMT</option>
            <option value="Medic">Medic</option>
            <option value="Lieutenant">Lieutenant</option>
            <option value="Captain">Captain</option>
            <option value="Chief">Chief</option>
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium mb-1" htmlFor="station">
            Station
          </label>
          <input
            id="station"
            type="text"
            value={station}
            onChange={(e) => setStation(e.target.value)}
            className="w-full border rounded px-3 py-2"
            placeholder="e.g. Station 1"
          />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium mb-1" htmlFor="battalion">
              Battalion
            </label>
            <input
              id="battalion"
              type="text"
              value={battalion}
              onChange={(e) => setBattalion(e.target.value)}
              className="w-full border rounded px-3 py-2"
              placeholder="e.g. B1"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1" htmlFor="division">
              Division
            </label>
            <input
              id="division"
              type="text"
              value={division}
              onChange={(e) => setDivision(e.target.value)}
              className="w-full border rounded px-3 py-2"
              placeholder="e.g. D1"
            />
          </div>
        </div>
        <div>
          <label className="block text-sm font-medium mb-1" htmlFor="returnDates">
            Return Dates (comma-separated)
          </label>
          <input
            id="returnDates"
            type="text"
            value={returnDates}
            onChange={(e) => setReturnDates(e.target.value)}
            className="w-full border rounded px-3 py-2"
            placeholder="YYYY-MM-DD, YYYY-MM-DD, …"
          />
        </div>
          <button
            type="submit"
            className="rounded bg-green-600 px-4 py-2 text-white hover:bg-green-700"
          >
            Post Shift
          </button>
        </form>
      </main>
    </>
  )
}