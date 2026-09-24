import type { ReactNode } from 'react'
import { redirect, unstable_rethrow } from 'next/navigation'
import { BrandMark } from '@/app/(auth)/_components/BrandMark'
import { GateError } from '@/app/(onboard)/_components/GateError'
import AppShell from '@/components/AppShell'
import { ProfileProvider } from '@/components/providers/ProfileProvider'
import { getMyProfile } from '@/lib/api'
import { toAppError } from '@/lib/errors'
import { createClient } from '@/lib/supabase/server'
import type { Profile } from '@/lib/types/database'

// Gates for the signed-in app (ARCHITECTURE §7.1). The proxy only refreshes the
// session and bounces signed-out visitors; everything else is decided here,
// in this order:
//   no session                        → /login
//   status onboarding                 → /onboarding
//   status pending|rejected|suspended → /pending
//   must_change_password              → /change-password
//   TeleStaff notice not acknowledged → /welcome
// A database or network error renders an error screen with "Try again". It is
// never treated as "no profile" (that would bounce working members into
// onboarding whenever Supabase hiccups).

type ProfileLoad =
  | { kind: 'ok'; profile: Profile }
  | { kind: 'signed-out' }
  | { kind: 'missing' }
  | { kind: 'error'; message: string }

async function loadMyProfile(): Promise<ProfileLoad> {
  try {
    const supabase = await createClient()
    // Verifies the session (auth.getClaims(), the same check the proxy makes,
    // so the two never disagree and loop), then reads my own row.
    const profile = await getMyProfile(supabase)
    return profile ? { kind: 'ok', profile } : { kind: 'missing' }
  } catch (error) {
    // Let Next.js's own control-flow errors (dynamic rendering, redirects) through.
    unstable_rethrow(error)
    const appError = toAppError(error)
    if (appError.code === 'NOT_SIGNED_IN') return { kind: 'signed-out' }
    console.error(`[app layout] could not load the profile: ${appError.code} ${appError.details ?? ''}`)
    return { kind: 'error', message: appError.message }
  }
}

/** Where a member who can't use the app yet must go, or null when they're through. */
function gateFor(profile: Profile): string | null {
  if (profile.status === 'onboarding') return '/onboarding'
  if (profile.status !== 'approved') return '/pending'
  if (profile.must_change_password) return '/change-password'
  if (!profile.telestaff_ack_at) return '/welcome'
  return null
}

/**
 * Full-screen problem shown instead of the app. "Try again" re-runs this
 * layout (router.refresh, busy while it runs); "Sign out" runs the full
 * sign-out sequence (push, caches, session).
 */
function GateProblem({ title, message, offerSignOut = false }: { title: string; message: string; offerSignOut?: boolean }) {
  return (
    <main
      id="main"
      tabIndex={-1}
      className="flex min-h-dvh flex-col items-center justify-center px-4 pt-safe pb-safe outline-none"
    >
      <div className="animate-fade-in-up w-full max-w-sm">
        <h1 className="mb-6 flex justify-center">
          <BrandMark />
        </h1>
        <GateError title={title} message={message} offerSignOut={offerSignOut} />
        <p className="mt-6 text-center text-xs text-fg-dim">
          Your trades are safe. TeleStaff is still the official schedule. If this keeps happening, let a ShiftSwap
          admin know.
        </p>
      </div>
    </main>
  )
}

export default async function AppLayout({ children }: { children: ReactNode }) {
  const result = await loadMyProfile()

  // redirect() works by throwing, so it stays outside any try/catch.
  if (result.kind === 'signed-out') redirect('/login')

  if (result.kind === 'error') {
    return <GateProblem title="Can't load ShiftSwap" message={result.message} />
  }

  if (result.kind === 'missing') {
    return (
      <GateProblem
        title="Account not found"
        message="We couldn't find your ShiftSwap profile. Sign out and sign in again. If that doesn't fix it, ask an admin for help."
        offerSignOut
      />
    )
  }

  const destination = gateFor(result.profile)
  if (destination) redirect(destination)

  return (
    <ProfileProvider profile={result.profile}>
      <AppShell>{children}</AppShell>
    </ProfileProvider>
  )
}
