'use client'

import { useTransition } from 'react'
import { useRouter } from 'next/navigation'
import AppHeader from '@/components/AppHeader'
import { ErrorState } from '@/components/ui'

/**
 * Shown by the admin layout when it couldn't check who is signed in (network
 * or database trouble). Never treated as "not an admin" (ARCHITECTURE §7.1).
 */
export function AdminGateError({ message }: { message: string }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  return (
    <>
      <AppHeader title="Admin" />
      <div className="mx-auto max-w-3xl px-4 pt-6 md:px-6">
        <ErrorState
          title="Couldn't open the admin panel"
          message={message}
          retrying={pending}
          onRetry={() => startTransition(() => router.refresh())}
        />
      </div>
    </>
  )
}
