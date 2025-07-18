"use client"

import { useState } from 'react'
import { createUserWithEmailAndPassword } from 'firebase/auth'
import { doc, setDoc, Timestamp } from 'firebase/firestore'
import { auth, db } from '@/lib/firebase'
import { useRouter } from 'next/navigation'
import Link from 'next/link'

/**
 * Registration page for new users.  Users provide basic
 * information which is stored in the `users` collection in
 * Firestore.  Only email and password are required; additional
 * fields can be captured later via the profile page.
 */
export default function SignupPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [error, setError] = useState('')
  const router = useRouter()

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    try {
      const { user } = await createUserWithEmailAndPassword(auth, email, password)
      // Create a corresponding user document in Firestore with default values.
      await setDoc(doc(db, 'users', user.uid), {
        uid: user.uid,
        email: user.email,
        name,
        rank: 'Firefighter',
        station: '',
        battalion: '',
        division: '',
        phone: '',
        tradeStats: { covered: 0, given: 0, balance: 0 },
        createdAt: Timestamp.now(),
      })
      router.push('/')
    } catch (err: any) {
      setError(err.message)
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center p-4 bg-gray-50">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-md space-y-4 rounded bg-white p-8 shadow"
      >
        <h1 className="text-2xl font-bold">Sign Up</h1>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <input
          className="w-full rounded border px-3 py-2"
          type="text"
          placeholder="Full Name (optional)"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <input
          className="w-full rounded border px-3 py-2"
          type="email"
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
        <input
          className="w-full rounded border px-3 py-2"
          type="password"
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
        <button
          type="submit"
          className="w-full rounded bg-blue-600 py-2 text-white hover:bg-blue-700"
        >
          Create Account
        </button>
        <p className="text-sm text-center">
          Already have an account?{' '}
          <Link href="/login" className="text-blue-600 hover:underline">
            Log in
          </Link>
        </p>
      </form>
    </main>
  )
}