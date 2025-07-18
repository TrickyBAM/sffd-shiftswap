"use client"

import { useEffect, useState } from 'react'
import { doc, getDoc, updateDoc } from 'firebase/firestore'
import { auth, db } from '@/lib/firebase'
import NavBar from '@/components/NavBar'

/**
 * Allows the logged‑in user to view and update their personal
 * details stored in the `users` collection.  Users can update
 * station, battalion, division and phone.  Changes are saved
 * immediately to Firestore when the form is submitted.
 */
export default function ProfilePage() {
  const [loading, setLoading] = useState(true)
  const [form, setForm] = useState({
    name: '',
    station: '',
    battalion: '',
    division: '',
    phone: '',
  })
  const user = auth.currentUser

  useEffect(() => {
    async function fetchUser() {
      if (!user) return
      const docRef = doc(db, 'users', user.uid)
      const snap = await getDoc(docRef)
      if (snap.exists()) {
        const data = snap.data()
        setForm({
          name: data.name ?? '',
          station: data.station ?? '',
          battalion: data.battalion ?? '',
          division: data.division ?? '',
          phone: data.phone ?? '',
        })
      }
      setLoading(false)
    }
    fetchUser()
  }, [user])

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target
    setForm((prev) => ({ ...prev, [name]: value }))
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!user) return
    const docRef = doc(db, 'users', user.uid)
    await updateDoc(docRef, form)
    alert('Profile updated successfully')
  }

  if (!user) {
    return <p className="p-4">Please log in to view your profile.</p>
  }
  if (loading) {
    return <p className="p-4">Loading profile…</p>
  }
  return (
    <>
      <NavBar />
      <main className="container mx-auto p-4 max-w-xl">
        <h1 className="text-2xl font-bold mb-4">My Profile</h1>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="name" className="block text-sm font-medium mb-1">
              Name
            </label>
            <input
              id="name"
              name="name"
              type="text"
              value={form.name}
              onChange={handleChange}
              className="w-full border rounded px-3 py-2"
            />
          </div>
          <div>
            <label htmlFor="station" className="block text-sm font-medium mb-1">
              Station
            </label>
            <input
              id="station"
              name="station"
              type="text"
              value={form.station}
              onChange={handleChange}
              className="w-full border rounded px-3 py-2"
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor="battalion" className="block text-sm font-medium mb-1">
                Battalion
              </label>
              <input
                id="battalion"
                name="battalion"
                type="text"
                value={form.battalion}
                onChange={handleChange}
                className="w-full border rounded px-3 py-2"
              />
            </div>
            <div>
              <label htmlFor="division" className="block text-sm font-medium mb-1">
                Division
              </label>
              <input
                id="division"
                name="division"
                type="text"
                value={form.division}
                onChange={handleChange}
                className="w-full border rounded px-3 py-2"
              />
            </div>
          </div>
          <div>
            <label htmlFor="phone" className="block text-sm font-medium mb-1">
              Phone
            </label>
            <input
              id="phone"
              name="phone"
              type="tel"
              value={form.phone}
              onChange={handleChange}
              className="w-full border rounded px-3 py-2"
            />
          </div>
          <button
            type="submit"
            className="rounded bg-blue-600 px-4 py-2 text-white hover:bg-blue-700"
          >
            Save Changes
          </button>
        </form>
      </main>
    </>
  )
}