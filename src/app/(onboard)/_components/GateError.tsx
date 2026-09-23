'use client'

import { useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { ErrorState } from '@/components/ui/ErrorState'
import { SignOutButton } from './SignOutButton'

export interface GateErrorProps {
  title: string
  message: string
  /** Offer "Sign out" next to "Try again" (e.g. when the profile is missing). */
  offerSignOut?: boolean
}

/** Full-screen problem for the (onboard) layout: Try again re-runs the server render. */
export function GateError({ title, message, offerSignOut = false }: GateErrorProps) {
  const router = useRouter()
  const [retrying, startRetry] = useTransition()

  return (
    <ErrorState
      title={title}
      message={message}
      onRetry={() => startRetry(() => router.refresh())}
      retrying={retrying}
      action={offerSignOut ? <SignOutButton /> : undefined}
    />
  )
}
