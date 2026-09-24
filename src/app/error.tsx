'use client' // Error boundaries must be Client Components

import { useEffect } from 'react'
import Link from 'next/link'
import { AlertTriangle, RotateCw } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { buttonClasses } from '@/components/ui/button-styles'

/**
 * Fallback for unexpected errors in any route segment below the root layout.
 * Server Component error messages are replaced by Next.js in production, so we show a
 * friendly message plus the digest (a reference code that matches the server logs).
 */
export default function ErrorPage({
  error,
  retry,
}: {
  error: Error & { digest?: string }
  retry: () => void
}) {
  useEffect(() => {
    console.error(error)
  }, [error])

  return (
    <main id="main" className="flex min-h-dvh items-center justify-center px-4 pt-safe pb-safe">
      <div role="alert" className="animate-fade-in-up w-full max-w-sm text-center">
        <div
          aria-hidden="true"
          className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-2xl border border-sffd-red/25 bg-sffd-red/10 text-sffd-red-text"
        >
          <AlertTriangle size={30} />
        </div>
        <h1 className="mb-2 font-display text-4xl tracking-wide text-fg">Something went wrong</h1>
        <p className="mb-8 text-sm text-fg-muted">
          ShiftSwap hit a problem loading this screen. It&apos;s usually a bad connection — try
          again. If it keeps happening, let an admin know.
        </p>
        <div className="flex flex-col gap-2">
          <Button size="lg" fullWidth onClick={() => retry()} icon={<RotateCw size={18} aria-hidden="true" />}>
            Try again
          </Button>
          <Link href="/calendar" className={buttonClasses({ variant: 'secondary', size: 'lg', fullWidth: true })}>
            Go home
          </Link>
        </div>
        {error.digest ? (
          <p className="mt-6 text-xs text-fg-dim">
            Reference: <span className="font-mono">{error.digest}</span>
          </p>
        ) : null}
      </div>
    </main>
  )
}
