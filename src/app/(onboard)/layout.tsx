import type { ReactNode } from 'react'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { BrandMark } from '@/app/(auth)/_components/BrandMark'
import { ProfileProvider } from '@/components/providers/ProfileProvider'
import { GateError } from './_components/GateError'
import { loadOnboardProfile } from './_lib/load-profile'

// Frame for the joining steps: /onboarding, /pending, /welcome and
// /change-password (ARCHITECTURE §7.1). Signed-in members only; no tab bar.
// Each page enforces its own gate (see _lib/gates.ts) because only the page
// knows which step it is. A database or network error shows an error screen
// with "Try again" — never "no profile".

function Frame({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col">
      <main id="main" tabIndex={-1} className="flex-1 outline-none">
        {children}
      </main>
      <footer className="px-safe pb-[calc(var(--safe-bottom)+1rem)] pt-2">
        <p className="flex flex-wrap items-center justify-center gap-x-1 text-center text-xs text-fg-dim">
          <span>Unofficial tool for SFFD members</span>
          <span aria-hidden="true">·</span>
          <Link
            href="/privacy"
            className="inline-flex min-h-11 items-center px-1 font-medium text-fg-muted underline-offset-4 hover:text-fg hover:underline"
          >
            Privacy
          </Link>
        </p>
      </footer>
    </div>
  )
}

function Problem({ title, message, offerSignOut }: { title: string; message: string; offerSignOut?: boolean }) {
  return (
    <Frame>
      <div className="flex min-h-[80dvh] flex-col items-center justify-center px-4 pt-safe">
        <div className="animate-fade-in-up w-full max-w-sm">
          <h1 className="mb-6 flex justify-center">
            <BrandMark />
          </h1>
          <GateError title={title} message={message} offerSignOut={offerSignOut} />
          <p className="mt-6 text-center text-xs text-fg-dim">
            If this keeps happening, let a ShiftSwap admin know.
          </p>
        </div>
      </div>
    </Frame>
  )
}

export default async function OnboardLayout({ children }: { children: ReactNode }) {
  const result = await loadOnboardProfile()

  // redirect() works by throwing, so it stays outside any try/catch.
  if (result.kind === 'signed-out') redirect('/login')

  if (result.kind === 'error') {
    return <Problem title="Can't load ShiftSwap" message={result.message} />
  }

  if (result.kind === 'missing') {
    return (
      <Problem
        title="Account not found"
        message="We couldn't find your ShiftSwap profile. Sign out and sign in again. If that doesn't fix it, ask an admin for help."
        offerSignOut
      />
    )
  }

  return (
    <ProfileProvider profile={result.profile}>
      <Frame>{children}</Frame>
    </ProfileProvider>
  )
}
