"use client"

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { auth } from '@/lib/firebase'

/**
 * A simple top navigation bar.  It displays links to the main
 * areas of the application.  When a user is logged in the
 * component shows a logout button; otherwise it shows a login
 * link.
 */
export default function NavBar() {
  const [user, setUser] = useState<null | { uid: string; email: string | null }>(null)
  useEffect(() => {
    const unsub = auth.onAuthStateChanged((u) => {
      if (u) {
        setUser({ uid: u.uid, email: u.email })
      } else {
        setUser(null)
      }
    })
    return unsub
  }, [])
  return (
    <nav className="bg-white shadow mb-4">
      <div className="container mx-auto flex justify-between items-center p-4">
        <Link href="/" className="font-bold text-lg">
          ShiftSwap
        </Link>
        <div className="flex gap-4 items-center">
          <Link href="/shifts/new" className="hover:underline">
            Post Shift
          </Link>
          <Link href="/my-trades" className="hover:underline">
            My Trades
          </Link>
          <Link href="/profile" className="hover:underline">
            Profile
          </Link>
          {user ? (
            <button
              onClick={() => auth.signOut()}
              className="text-red-600 hover:text-red-800"
            >
              Logout
            </button>
          ) : (
            <Link href="/login" className="hover:underline">
              Login
            </Link>
          )}
        </div>
      </div>
    </nav>
  )
}