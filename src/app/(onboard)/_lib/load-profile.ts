// Server-side profile load for the (onboard) layout and pages. Wrapped in
// React cache() so the layout and the page share one session check and one
// database read per request.
//
// A database or network problem is reported as { kind: 'error' } and the
// layout shows an error screen: it is never treated as "no profile" or
// "signed out" (ARCHITECTURE §7.1), so a Supabase hiccup can't bounce anyone
// back into onboarding or to the login page.

import { cache } from 'react'
import { redirect, unstable_rethrow } from 'next/navigation'
import { getMyProfile } from '@/lib/api'
import { toAppError } from '@/lib/errors'
import { createClient } from '@/lib/supabase/server'
import type { Profile } from '@/lib/types/database'
import { gateRedirect, type OnboardPage } from './gates'

/** What the member typed at sign-up (auth user_metadata), for prefilling onboarding. */
export interface SignupDetails {
  fullName: string | null
  phone: string | null
}

export type OnboardProfileLoad =
  | { kind: 'ok'; profile: Profile; signup: SignupDetails }
  | { kind: 'signed-out' }
  | { kind: 'missing' }
  | { kind: 'error'; message: string }

function metadataString(metadata: unknown, key: string): string | null {
  if (typeof metadata !== 'object' || metadata === null) return null
  const value = (metadata as Record<string, unknown>)[key]
  if (typeof value !== 'string') return null
  const text = value.trim()
  return text ? text.slice(0, 100) : null
}

/** True for failures that mean "couldn't check", not "signed out". */
function isOutage(error: ReturnType<typeof toAppError>): boolean {
  return error.code === 'NETWORK' || (error.status !== null && error.status >= 500)
}

export const loadOnboardProfile = cache(async (): Promise<OnboardProfileLoad> => {
  try {
    const supabase = await createClient()

    // Verify the session (the same check the proxy makes, so they agree).
    const claimsResult = await supabase.auth.getClaims()
    if (claimsResult.error) {
      const error = toAppError(claimsResult.error)
      if (isOutage(error)) {
        console.error(`[onboard] session check failed: ${error.code} ${error.details ?? ''}`)
        return { kind: 'error', message: error.message }
      }
      return { kind: 'signed-out' }
    }
    const claims = claimsResult.data?.claims
    const userId = typeof claims?.sub === 'string' ? claims.sub : ''
    if (!userId) return { kind: 'signed-out' }

    const profile = await getMyProfile(supabase, userId)
    if (!profile) return { kind: 'missing' }

    const metadata: unknown = claims?.user_metadata
    return {
      kind: 'ok',
      profile,
      signup: { fullName: metadataString(metadata, 'full_name'), phone: metadataString(metadata, 'phone') },
    }
  } catch (err) {
    // Let Next.js's own control-flow errors (dynamic rendering, redirects) through.
    unstable_rethrow(err)
    const error = toAppError(err)
    if (error.code === 'NOT_SIGNED_IN') return { kind: 'signed-out' }
    console.error(`[onboard] could not load the profile: ${error.code} ${error.details ?? ''}`)
    return { kind: 'error', message: error.message }
  }
})

/**
 * For an (onboard) page: loads the member and enforces the gates. Redirects
 * when the member belongs elsewhere (or is signed out). Returns null when the
 * profile couldn't be loaded — the layout is showing the error screen then, so
 * the page should render nothing.
 */
export async function requireOnboardPage(
  page: OnboardPage,
): Promise<{ profile: Profile; signup: SignupDetails } | null> {
  const result = await loadOnboardProfile()
  // redirect() throws, so these stay outside any try/catch.
  if (result.kind === 'signed-out') redirect('/login')
  if (result.kind !== 'ok') return null
  const target = gateRedirect(page, result.profile)
  if (target) redirect(target)
  return { profile: result.profile, signup: result.signup }
}
