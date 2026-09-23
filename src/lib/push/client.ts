/**
 * Browser-side Web Push + PWA helpers (ARCHITECTURE §6.5, §8).
 *
 * Every function is safe to import anywhere; the browser-only ones return a harmless
 * value on the server. Subscription rows are written only through src/lib/api/push.ts
 * (savePushSubscription / deletePushSubscription): a plain insert that the database
 * turns into "this device now alerts the member who signed in last" (§9).
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import {
  deletePushSubscription,
  hasPushSubscription,
  isUnsupportedPushService,
  pushSubscriptionInput,
  PUSH_UNSUPPORTED_MESSAGE,
  savePushSubscription,
} from '@/lib/api/push'
import { isAppError } from '@/lib/errors'

export type PushPermission = NotificationPermission | 'unsupported'

export type PushFailureReason =
  | 'unsupported' // browser has no service worker / Push API (or iPhone not installed)
  | 'no-key' // NEXT_PUBLIC_VAPID_PUBLIC_KEY is not configured
  | 'denied' // the user blocked notifications for this site
  | 'dismissed' // the user closed the permission prompt without choosing
  | 'not-signed-in'
  | 'failed' // anything else (network, database, push service)

export type PushResult =
  | { ok: true; endpoint: string }
  | { ok: false; reason: PushFailureReason; message: string }

/**
 * localStorage keys for "don't show this alerts prompt again" on this device.
 * Sign-out clears them so the next member on a shared phone gets the prompt.
 */
export const ALERTS_NUDGE_DISMISSED_KEY = 'shiftswap:alerts-nudge:dismissed'
export const PUSH_BANNER_DISMISSED_KEY = 'shiftswap:alerts:push-banner-dismissed'

const SW_URL = '/sw.js'
const SW_READY_TIMEOUT_MS = 10_000

const MESSAGES: Record<PushFailureReason, string> = {
  unsupported: "This browser can't show ShiftSwap alerts.",
  'no-key': "Alerts aren't set up on the server yet. Ask an admin.",
  denied: 'Notifications are blocked for ShiftSwap. Turn them on in your phone or browser settings.',
  dismissed: 'Alerts were not turned on.',
  'not-signed-in': 'Please sign in again, then turn on alerts.',
  failed: "Couldn't turn on alerts. Check your connection and try again.",
}

function fail(reason: PushFailureReason, message = MESSAGES[reason]): PushResult {
  return { ok: false, reason, message }
}

const isBrowser = () => typeof window !== 'undefined' && typeof navigator !== 'undefined'

/** Service worker + Push API + Notification API are all present. */
export function isPushSupported(): boolean {
  return (
    isBrowser() &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  )
}

/** iPhone, iPod or iPad (iPadOS reports itself as a Mac with touch). */
export function isIOS(): boolean {
  if (!isBrowser()) return false
  const ua = navigator.userAgent
  if (/iPad|iPhone|iPod/.test(ua)) return true
  return navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1
}

/** Running as an installed app (home-screen icon) rather than in a browser tab. */
export function isStandalone(): boolean {
  if (!isBrowser()) return false
  const iosStandalone = (navigator as Navigator & { standalone?: boolean }).standalone === true
  return iosStandalone || window.matchMedia?.('(display-mode: standalone)').matches === true
}

/**
 * iPhone/iPad Safari only offers Web Push to apps added to the Home Screen (iOS 16.4+).
 * True when the user must install the app before alerts can work.
 */
export function needsInstallForPush(): boolean {
  return isIOS() && !isStandalone()
}

export function getPushPermission(): PushPermission {
  if (!isPushSupported()) return 'unsupported'
  return Notification.permission
}

/** VAPID public key (base64url) → bytes for PushManager.subscribe(). */
export function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = window.atob(base64)
  const bytes = new Uint8Array(new ArrayBuffer(raw.length))
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i)
  return bytes
}

function sameKey(a: ArrayBuffer | null, b: Uint8Array): boolean {
  if (!a) return false
  const left = new Uint8Array(a)
  if (left.length !== b.length) return false
  for (let i = 0; i < left.length; i++) if (left[i] !== b[i]) return false
  return true
}

/**
 * The active service worker registration, registering /sw.js if nothing is registered
 * yet (PWARegister only registers in production builds).
 */
async function getRegistration(): Promise<ServiceWorkerRegistration> {
  const existing = await navigator.serviceWorker.getRegistration('/')
  if (!existing) await navigator.serviceWorker.register(SW_URL, { scope: '/', updateViaCache: 'none' })
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('Service worker did not become ready')), SW_READY_TIMEOUT_MS)
  })
  try {
    return await Promise.race([navigator.serviceWorker.ready, timeout])
  } finally {
    clearTimeout(timer)
  }
}

/** The browser's current push subscription for this app, if any. */
export async function getCurrentPushSubscription(): Promise<PushSubscription | null> {
  if (!isPushSupported()) return null
  const registration = await navigator.serviceWorker.getRegistration('/')
  if (!registration) return null
  return registration.pushManager.getSubscription()
}

/**
 * Store this device's subscription for the signed-in member (src/lib/api/push.ts).
 * A plain insert: the database's BEFORE INSERT trigger replaces a row for the same
 * endpoint, even one another account on this device left behind, so the device
 * always alerts whoever turned alerts on last. Throws AppError.
 */
async function storeSubscription(sb: SupabaseClient, subscription: PushSubscription): Promise<void> {
  const input = pushSubscriptionInput(subscription.toJSON(), navigator.userAgent)
  if (!input) throw new Error('The browser returned an incomplete push subscription.')
  await savePushSubscription(sb, input)
}

/** The PushResult for an error from storing the subscription. */
function storeFailure(error: unknown): PushResult {
  // SQLSTATE 23514: the database only accepts the browsers' real push services (§9).
  if (isUnsupportedPushService(error)) return fail('unsupported', PUSH_UNSUPPORTED_MESSAGE)
  if (isAppError(error) && error.code === 'NOT_SIGNED_IN') return fail('not-signed-in')
  return fail('failed')
}

/**
 * Turn on alerts for the signed-in user on this device. Call it from a tap handler:
 * browsers only show the permission prompt in response to a user gesture.
 */
export async function subscribeToPush(
  sb: SupabaseClient,
  vapidPublicKey: string | undefined | null,
): Promise<PushResult> {
  if (needsInstallForPush() || !isPushSupported()) return fail('unsupported')
  if (!vapidPublicKey) return fail('no-key')

  let permission = Notification.permission
  if (permission === 'default') {
    try {
      permission = await Notification.requestPermission()
    } catch {
      return fail('failed')
    }
  }
  if (permission === 'denied') return fail('denied')
  if (permission !== 'granted') return fail('dismissed')

  let subscription: PushSubscription
  try {
    const registration = await getRegistration()
    const applicationServerKey = urlBase64ToUint8Array(vapidPublicKey)

    let existing = await registration.pushManager.getSubscription()
    // A subscription made with a different (rotated) VAPID key can't receive our pushes.
    if (existing && !sameKey(existing.options.applicationServerKey, applicationServerKey)) {
      await existing.unsubscribe().catch(() => false)
      existing = null
    }
    subscription = existing ?? (await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey }))
  } catch {
    return fail('failed')
  }

  try {
    await storeSubscription(sb, subscription)
    return { ok: true, endpoint: subscription.endpoint }
  } catch (error) {
    const result = storeFailure(error)
    // The database won't take this push service: don't leave a browser
    // subscription behind that the toggle would show as "on".
    if (result.ok === false && result.reason === 'unsupported') await subscription.unsubscribe().catch(() => false)
    return result
  }
}

/**
 * Re-save the browser's existing subscription (no prompt). Use on app start / when the
 * alerts screen opens so a subscription the server pruned (404/410) or one the browser
 * rotated gets stored again. Returns false when there is nothing to heal or it failed.
 */
export async function resyncPushSubscription(sb: SupabaseClient): Promise<boolean> {
  try {
    if (getPushPermission() !== 'granted') return false
    const subscription = await getCurrentPushSubscription()
    if (!subscription) return false
    // Already stored for me: nothing to do (and no needless delete + insert).
    if (await hasPushSubscription(sb, subscription.endpoint)) return true
    await storeSubscription(sb, subscription)
    return true
  } catch {
    // Signed out, offline or rejected: try again next time the app opens.
    return false
  }
}

/**
 * Turn off alerts on this device: delete our row and unsubscribe the browser.
 * Call before signing out so the next person on this phone doesn't get your alerts.
 * Returns false when either step failed (the browser is still unsubscribed if it could be).
 */
export async function unsubscribeFromPush(sb: SupabaseClient): Promise<boolean> {
  try {
    const subscription = await getCurrentPushSubscription()
    if (!subscription) return true
    let deleted = true
    try {
      await deletePushSubscription(sb, subscription.endpoint)
    } catch {
      deleted = false
    }
    const unsubscribed = await subscription.unsubscribe().catch(() => false)
    return deleted && unsubscribed
  } catch {
    return false
  }
}

/**
 * Close the ShiftSwap alerts already showing on this device (e.g. at sign-out,
 * so the next person on a shared phone doesn't see "Mike asked for your shift").
 * Best effort; never throws.
 */
export async function closeShownNotifications(): Promise<void> {
  if (!isPushSupported()) return
  try {
    const registration = await navigator.serviceWorker.getRegistration('/')
    if (!registration?.getNotifications) return
    const shown = await registration.getNotifications()
    for (const notification of shown) notification.close()
  } catch {
    // No worker or no permission: nothing is showing.
  }
}

/** Cache Storage names the current service worker owns (static files and /offline only). */
const SW_STATIC_CACHE_PREFIX = 'shiftswap-static-'

/**
 * Sign-out cleanup for Cache Storage: deletes caches that could hold a member's
 * data, which today means only the pre-v1 worker's page caches. The service
 * worker's own static cache is kept: it holds only hashed JS/CSS, icons and the
 * /offline page (§8 — pages with member data are never cached), and deleting it
 * would break the offline screen until the next deploy.
 */
export async function clearAppCaches(): Promise<void> {
  if (!isBrowser() || typeof caches === 'undefined') return
  try {
    const keys = await caches.keys()
    await Promise.all(keys.filter((key) => !key.startsWith(SW_STATIC_CACHE_PREFIX)).map((key) => caches.delete(key)))
  } catch {
    // Cache Storage can be unavailable (private mode); nothing cached then.
  }
}
