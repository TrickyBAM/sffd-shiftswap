// Browser push helpers (src/lib/push/client.ts) with a fake browser: rows are
// written only through src/lib/api/push.ts, a rejected push service reads
// "Alerts aren't supported in this browser", and sign-out cleanup keeps the
// service worker's offline page.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { AppError } from '@/lib/errors'

const api = vi.hoisted(() => ({
  savePushSubscription: vi.fn(),
  deletePushSubscription: vi.fn(),
  hasPushSubscription: vi.fn(),
}))

vi.mock('@/lib/api/push', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api/push')>()),
  ...api,
}))

import { PUSH_UNSUPPORTED_MESSAGE } from '@/lib/api/push'
import {
  clearAppCaches,
  closeShownNotifications,
  resyncPushSubscription,
  subscribeToPush,
  unsubscribeFromPush,
} from '@/lib/push/client'

const sb = {} as SupabaseClient
const VAPID = 'BAECAwQ' // any base64url
const ENDPOINT = 'https://fcm.googleapis.com/fcm/send/abc'

interface FakeSubscription {
  endpoint: string
  options: { applicationServerKey: ArrayBuffer | null }
  toJSON: () => { endpoint: string; keys: { p256dh: string; auth: string } }
  unsubscribe: ReturnType<typeof vi.fn>
}

function fakeSubscription(key: Uint8Array | null): FakeSubscription {
  return {
    endpoint: ENDPOINT,
    options: { applicationServerKey: key ? (key.buffer.slice(0) as ArrayBuffer) : null },
    toJSON: () => ({ endpoint: ENDPOINT, keys: { p256dh: 'p', auth: 'a' } }),
    unsubscribe: vi.fn(async () => true),
  }
}

let current: FakeSubscription | null
let shown: Array<{ close: ReturnType<typeof vi.fn> }>
let cacheKeys: string[]
const deleted: string[] = []

function installBrowser({ permission = 'granted' as NotificationPermission } = {}) {
  current = null
  shown = [{ close: vi.fn() }, { close: vi.fn() }]
  cacheKeys = ['shiftswap-static-abc123', 'shiftswap-pages-v3', 'other-cache']
  deleted.length = 0
  const keyBytes = Uint8Array.from(atob(VAPID.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (VAPID.length % 4)) % 4)), (c) =>
    c.charCodeAt(0),
  )
  const registration = {
    pushManager: {
      getSubscription: vi.fn(async () => current),
      subscribe: vi.fn(async () => {
        current = fakeSubscription(keyBytes)
        return current
      }),
    },
    getNotifications: vi.fn(async () => shown),
  }
  const Notification = { permission, requestPermission: vi.fn(async () => permission) }
  vi.stubGlobal('Notification', Notification)
  vi.stubGlobal('window', { PushManager: {}, Notification, atob, matchMedia: () => ({ matches: false }) })
  vi.stubGlobal('navigator', {
    userAgent: 'Mozilla/5.0 (Linux; Android 14) Chrome/130',
    platform: 'Linux',
    maxTouchPoints: 5,
    serviceWorker: {
      getRegistration: vi.fn(async () => registration),
      register: vi.fn(async () => registration),
      ready: Promise.resolve(registration),
    },
  })
  vi.stubGlobal('caches', {
    keys: async () => cacheKeys,
    delete: async (key: string) => {
      deleted.push(key)
      return true
    },
  })
  return { registration, keyBytes }
}

beforeEach(() => {
  api.savePushSubscription.mockReset().mockResolvedValue(undefined)
  api.deletePushSubscription.mockReset().mockResolvedValue(undefined)
  api.hasPushSubscription.mockReset().mockResolvedValue(false)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('subscribeToPush', () => {
  it('stores the subscription through the API layer (plain insert)', async () => {
    installBrowser()
    await expect(subscribeToPush(sb, VAPID)).resolves.toEqual({ ok: true, endpoint: ENDPOINT })
    expect(api.savePushSubscription).toHaveBeenCalledWith(sb, {
      endpoint: ENDPOINT,
      p256dh: 'p',
      auth: 'a',
      userAgent: 'Mozilla/5.0 (Linux; Android 14) Chrome/130',
    })
  })

  it('a push service the database rejects (23514) says alerts are not supported, and unsubscribes', async () => {
    installBrowser()
    api.savePushSubscription.mockRejectedValue(new AppError('INVALID_INPUT', PUSH_UNSUPPORTED_MESSAGE))
    const result = await subscribeToPush(sb, VAPID)
    expect(result).toEqual({ ok: false, reason: 'unsupported', message: PUSH_UNSUPPORTED_MESSAGE })
    expect(PUSH_UNSUPPORTED_MESSAGE).toMatch(/^Alerts aren't supported in this browser/)
    expect(current?.unsubscribe).toHaveBeenCalled()
  })

  it('signed out and other failures get their own reasons', async () => {
    installBrowser()
    api.savePushSubscription.mockRejectedValueOnce(new AppError('NOT_SIGNED_IN'))
    await expect(subscribeToPush(sb, VAPID)).resolves.toMatchObject({ ok: false, reason: 'not-signed-in' })
    api.savePushSubscription.mockRejectedValueOnce(new AppError('NETWORK'))
    await expect(subscribeToPush(sb, VAPID)).resolves.toMatchObject({ ok: false, reason: 'failed' })
  })

  it('stops at a blocked permission without touching the database', async () => {
    installBrowser({ permission: 'denied' })
    await expect(subscribeToPush(sb, VAPID)).resolves.toMatchObject({ ok: false, reason: 'denied' })
    expect(api.savePushSubscription).not.toHaveBeenCalled()
  })
})

describe('resync, unsubscribe and sign-out helpers', () => {
  it('resync does nothing when my row is already stored, and re-saves when it is gone', async () => {
    const { keyBytes } = installBrowser()
    current = fakeSubscription(keyBytes)
    api.hasPushSubscription.mockResolvedValueOnce(true)
    await expect(resyncPushSubscription(sb)).resolves.toBe(true)
    expect(api.savePushSubscription).not.toHaveBeenCalled()

    await expect(resyncPushSubscription(sb)).resolves.toBe(true)
    expect(api.savePushSubscription).toHaveBeenCalledTimes(1)

    api.savePushSubscription.mockRejectedValueOnce(new AppError('NETWORK'))
    await expect(resyncPushSubscription(sb)).resolves.toBe(false)
  })

  it('unsubscribe deletes my row through the API and unsubscribes the browser', async () => {
    const { keyBytes } = installBrowser()
    const sub = fakeSubscription(keyBytes)
    current = sub
    await expect(unsubscribeFromPush(sb)).resolves.toBe(true)
    expect(api.deletePushSubscription).toHaveBeenCalledWith(sb, ENDPOINT)
    expect(sub.unsubscribe).toHaveBeenCalled()

    // Offline: the browser is still unsubscribed, but it reports the failure.
    current = fakeSubscription(keyBytes)
    api.deletePushSubscription.mockRejectedValueOnce(new AppError('NETWORK'))
    await expect(unsubscribeFromPush(sb)).resolves.toBe(false)
    expect(current.unsubscribe).toHaveBeenCalled()
  })

  it('closeShownNotifications closes every alert on screen', async () => {
    installBrowser()
    await closeShownNotifications()
    for (const n of shown) expect(n.close).toHaveBeenCalled()
  })

  it('clearAppCaches keeps the service worker static cache (offline page) and drops the rest', async () => {
    installBrowser()
    await clearAppCaches()
    expect(deleted.sort()).toEqual(['other-cache', 'shiftswap-pages-v3'])
  })

  it('helpers are harmless without a browser', async () => {
    vi.unstubAllGlobals()
    await expect(closeShownNotifications()).resolves.toBeUndefined()
    await expect(clearAppCaches()).resolves.toBeUndefined()
  })
})
