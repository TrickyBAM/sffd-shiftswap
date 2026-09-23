// Browser sign-out (ARCHITECTURE §9 "Sign-out sequence"): stop this device's
// push alerts, clear the service-worker caches and offline snapshots, then end
// the session on this device only. Every step is best effort; the member always
// ends up on the login page with a full reload, so nothing from their session
// stays in memory for the next person on a shared phone.

import { clearAppCaches, unsubscribeFromPush } from '@/lib/push/client'
import { clearSnapshots } from '@/lib/offline-cache'
import { createClient } from '@/lib/supabase/client'

// The session cookies @supabase/ssr writes (split into .0, .1… when large).
const AUTH_COOKIE_RE = /^sb-.+-auth-token(?:\.\d+)?$/

/**
 * supabase-js keeps the session when the sign-out request itself fails (e.g.
 * offline), so remove the session cookies by hand in that case.
 */
function forgetSessionCookies(): void {
  try {
    for (const part of document.cookie.split(';')) {
      const name = part.split('=')[0]?.trim()
      if (name && AUTH_COOKIE_RE.test(name)) {
        document.cookie = `${name}=; Max-Age=0; path=/; SameSite=Lax`
      }
    }
  } catch {
    // Cookies unavailable: nothing stored there to forget.
  }
}

export async function signOutOnThisDevice(): Promise<void> {
  let sb: ReturnType<typeof createClient> | null = null
  try {
    sb = createClient()
  } catch {
    // Supabase isn't configured: there's no session to end.
  }
  if (sb) await unsubscribeFromPush(sb)
  await clearAppCaches()
  clearSnapshots()
  if (sb) {
    let failed = false
    try {
      const { error } = await sb.auth.signOut({ scope: 'local' })
      failed = Boolean(error)
    } catch {
      failed = true
    }
    if (failed) forgetSessionCookies()
  }
  window.location.replace('/login')
}
