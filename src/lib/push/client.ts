/**
 * Browser-side Web Push + PWA helpers (ARCHITECTURE §6.5, §8).
 *
 * Every function is safe to import anywhere; the browser-only ones return a harmless
 * value on the server. Subscriptions are stored in public.push_subscriptions through the
 * signed-in user's Supabase client (RLS: select/insert/delete own rows; no update).
 */

import type { SupabaseClient } from '@supabase/supabase-js'

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

type SaveOutcome = 'saved' | 'owned-by-someone-else' | 'error'

/** Insert the subscription row for `userId`; an existing identical endpoint row is left alone. */
async function saveSubscription(
  sb: SupabaseClient,
  userId: string,
  subscription: PushSubscription,
): Promise<SaveOutcome> {
  const json = subscription.toJSON()
  const p256dh = json.keys?.p256dh
  const auth = json.keys?.auth
  if (!json.endpoint || !p256dh || !auth) return 'error'

  // ignoreDuplicates → INSERT … ON CONFLICT (endpoint) DO NOTHING, which needs only the
  // INSERT grant (members have no UPDATE on push_subscriptions).
  const { error } = await sb.from('push_subscriptions').upsert(
    {
      user_id: userId,
      endpoint: json.endpoint,
      p256dh,
      auth,
      user_agent: navigator.userAgent.slice(0, 500),
    },
    { onConflict: 'endpoint', ignoreDuplicates: true },
  )
  if (error) return 'error'

  // RLS only shows our own rows: if the endpoint exists but we can't see it, another
  // account on this device registered it (e.g. a shared phone after a sign-out).
  const { data, error: readError } = await sb
    .from('push_subscriptions')
    .select('id')
    .eq('endpoint', json.endpoint)
    .maybeSingle()
  if (readError) return 'error'
  return data ? 'saved' : 'owned-by-someone-else'
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

  try {
    const { data: userData, error: userError } = await sb.auth.getUser()
    const userId = userData.user?.id
    if (userError || !userId) return fail('not-signed-in')

    const registration = await getRegistration()
    const applicationServerKey = urlBase64ToUint8Array(vapidPublicKey)

    let subscription = await registration.pushManager.getSubscription()
    // A subscription made with a different (rotated) VAPID key can't receive our pushes.
    if (subscription && !sameKey(subscription.options.applicationServerKey, applicationServerKey)) {
      await subscription.unsubscribe().catch(() => false)
      subscription = null
    }
    subscription ??= await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey })

    let outcome = await saveSubscription(sb, userId, subscription)
    if (outcome === 'owned-by-someone-else') {
      // Get a fresh endpoint for this account instead of sharing the other one's.
      await subscription.unsubscribe().catch(() => false)
      subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey })
      outcome = await saveSubscription(sb, userId, subscription)
    }
    if (outcome !== 'saved') return fail('failed')
    return { ok: true, endpoint: subscription.endpoint }
  } catch {
    return fail('failed')
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
    const { data } = await sb.auth.getUser()
    if (!data.user) return false
    return (await saveSubscription(sb, data.user.id, subscription)) === 'saved'
  } catch {
    return false
  }
}

/**
 * Turn off alerts on this device: delete our row and unsubscribe the browser.
 * Call before signing out so the next person on this phone doesn't get your alerts.
 */
export async function unsubscribeFromPush(sb: SupabaseClient): Promise<boolean> {
  try {
    const subscription = await getCurrentPushSubscription()
    if (!subscription) return true
    const { error } = await sb.from('push_subscriptions').delete().eq('endpoint', subscription.endpoint)
    const unsubscribed = await subscription.unsubscribe().catch(() => false)
    return !error && unsubscribed
  } catch {
    return false
  }
}

/**
 * Delete every Cache Storage entry for this origin (static assets + offline page) and
 * ask the service worker to do the same. Used on sign-out.
 */
export async function clearAppCaches(): Promise<void> {
  if (!isBrowser()) return
  try {
    navigator.serviceWorker?.controller?.postMessage({ type: 'CLEAR_CACHES' })
  } catch {
    // No controlling worker: nothing to tell.
  }
  if (typeof caches === 'undefined') return
  try {
    const keys = await caches.keys()
    await Promise.all(keys.map((key) => caches.delete(key)))
  } catch {
    // Cache Storage can be unavailable (private mode); nothing cached then.
  }
}
