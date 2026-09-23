'use client' // Error boundaries must be Client Components

import { useEffect } from 'react'
import Link from 'next/link'
import AppHeader from '@/components/AppHeader'
import { ErrorState } from '@/components/ui/ErrorState'
import { buttonClasses } from '@/components/ui/button-styles'
import { toAppError } from '@/lib/errors'

/**
 * Unexpected errors in any signed-in page. Rendered inside the app layout, so
 * the navigation and header stay usable. Server errors arrive with their
 * message hidden by Next.js; toAppError() turns anything into plain English
 * (e.g. the connection message when Supabase can't be reached).
 */
export default function AppError({
  error,
  retry,
}: {
  error: Error & { digest?: string }
  retry: () => void
}) {
  useEffect(() => {
    console.error(error)
  }, [error])

  const message = toAppError(error).message

  return (
    <>
      <AppHeader title="Something went wrong" />
      <div className="mx-auto w-full max-w-3xl px-4 py-6 md:px-6">
        <ErrorState
          title="This screen didn't load"
          message={message}
          onRetry={() => retry()}
          action={
            <Link href="/calendar" className={buttonClasses({ variant: 'ghost' })}>
              Go to my calendar
            </Link>
          }
        />
        {error.digest ? (
          <p className="mt-4 text-center text-xs text-fg-dim">
            Reference: <span className="font-mono">{error.digest}</span>
          </p>
        ) : null}
      </div>
    </>
  )
}
