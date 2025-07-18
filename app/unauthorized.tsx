/**
 * Custom 401 page.  Displayed when the user must log in to access a
 * page.  This page is triggered via the experimental
 * `unauthorized()` API introduced in Next.js 15.1【426253857038578†L210-L304】.
 */
import Link from 'next/link'

export default function Unauthorized() {
  return (
    <div className="flex h-screen flex-col items-center justify-center space-y-4">
      <h2 className="text-2xl font-bold">Unauthorized</h2>
      <p>Please log in to access this page.</p>
      <Link href="/login" className="text-blue-600 hover:underline">
        Go to Login
      </Link>
    </div>
  )
}