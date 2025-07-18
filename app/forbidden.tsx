/**
 * Custom 403 page.  This page is rendered when the
 * experimental `forbidden()` API is used in a Server Action or
 * Route Handler.  It provides a simple message and a link back to
 * the homepage as suggested in the Next.js 15.1 release notes【426253857038578†L210-L304】.
 */
import Link from 'next/link'

export default function Forbidden() {
  return (
    <div className="flex h-screen flex-col items-center justify-center space-y-4">
      <h2 className="text-2xl font-bold">Forbidden</h2>
      <p>You are not authorized to access this resource.</p>
      <Link href="/" className="text-blue-600 hover:underline">
        Return Home
      </Link>
    </div>
  )
}