// The one browser sign-out (ARCHITECTURE §9 "Sign-out sequence"; CC-2, UX-04,
// SEC-3, SEC-4, NEXT-06). Every sign-out button calls signOutOnThisDevice().
//
//   1. Stop this device's push alerts (delete the row, unsubscribe the browser).
//   2. Clear the offline snapshots and the per-device "alerts" prompt flags, so
//      the next person on a shared phone sees none of it.
//   3. Close ShiftSwap notifications already showing on the device.
//   4. Drop caches that could hold member data. The service worker's static
//      cache (hashed assets, icons, /offline) stays: it holds no member data.
//   5. End the session on this device only (scope 'local').
//   6. Always finish with a full page load of /login, so nothing from the
//      session stays in memory or in the router cache (Back can't show the
//      previous member's pages).
//
// Steps 1–4 are best effort and time-boxed, so a phone with no signal still
// signs out. A failed or unreachable /logout call counts as signed out:
// auth-js removes the local session before it reports the network error, and
// the session cookies are also removed by hand in case it didn't.

import { clearSnapshots } from '@/lib/offline-cache'
import {
  ALERTS_NUDGE_DISMISSED_KEY,
  clearAppCaches,
  closeShownNotifications,
  PUSH_BANNER_DISMISSED_KEY,
  unsubscribeFromPush,
} from '@/lib/push/client'
import { createClient } from '@/lib/supabase/client'

/** Where every sign-out ends. */
export const SIGNED_OUT_PATH = '/login'

/** localStorage keys that remember this device's prompts; cleared for the next member. */
export const DEVICE_PROMPT_KEYS: readonly string[] = Object.freeze([PUSH_BANNER_DISMISSED_KEY, ALERTS_NUDGE_DISMISSED_KEY])

/** How long each best-effort step may take before sign-out moves on. */
const STEP_TIMEOUT_MS = 4000

// The session cookies @supabase/ssr writes (split into .0, .1… when large).
const AUTH_COOKIE_RE = /^sb-.+-auth-token(?:\.\d+)?$/

/** Runs a best-effort step: never throws, gives up after `ms`. */
async function bestEffort(step: () => Promise<unknown> | unknown, ms = STEP_TIMEOUT_MS): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    await Promise.race([
      Promise.resolve().then(step),
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, ms)
      }),
    ])
  } catch {
    // Best effort: the next step still runs.
  } finally {
    clearTimeout(timer)
  }
}

/** Removes the Supabase session cookies by hand (belt and braces for step 5). */
export function forgetSessionCookies(): void {
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

/** Forgets this device's "don't show the alerts prompt again" choices. */
function forgetDevicePrompts(): void {
  try {
    for (const key of DEVICE_PROMPT_KEYS) window.localStorage.removeItem(key)
  } catch {
    // Storage blocked: nothing saved there.
  }
}

/**
 * Signs the member out on this device and loads /login. Resolves after the
 * navigation has been started (the page is going away); never rejects.
 */
export async function signOutOnThisDevice(): Promise<void> {
  let sb: ReturnType<typeof createClient> | null = null
  try {
    sb = createClient()
  } catch {
    // Supabase isn't configured: there's no session to end.
  }

  const client = sb
  if (client) await bestEffort(() => unsubscribeFromPush(client))
  await bestEffort(() => clearSnapshots())
  forgetDevicePrompts()
  await bestEffort(() => closeShownNotifications())
  await bestEffort(() => clearAppCaches())

  if (client) {
    let signedOut = false
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      // auth-js clears the stored session before it reports a failed /logout
      // call, so an error here still means "signed out" on this device.
      const result = await Promise.race([
        client.auth.signOut({ scope: 'local' }),
        new Promise<null>((resolve) => {
          timer = setTimeout(() => resolve(null), STEP_TIMEOUT_MS)
        }),
      ])
      signedOut = Boolean(result && !result.error)
    } catch {
      signedOut = false
    } finally {
      clearTimeout(timer)
    }
    // When auth-js couldn't finish (e.g. an expired token it couldn't refresh
    // offline, or a timeout), remove the session cookies by hand.
    if (!signedOut) forgetSessionCookies()
  }

  window.location.replace(SIGNED_OUT_PATH)
}
