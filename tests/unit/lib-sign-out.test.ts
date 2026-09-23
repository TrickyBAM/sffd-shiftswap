// The one sign-out (src/lib/auth/sign-out.ts): every step is best effort, the
// session always ends up gone, and the page always does a full load of /login.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  signOut: vi.fn(),
  unsubscribeFromPush: vi.fn(),
  closeShownNotifications: vi.fn(),
  clearAppCaches: vi.fn(),
  clearSnapshots: vi.fn(),
  order: [] as string[],
}))

vi.mock('@/lib/supabase/client', () => ({ createClient: mocks.createClient }))
vi.mock('@/lib/offline-cache', () => ({ clearSnapshots: mocks.clearSnapshots }))
vi.mock('@/lib/push/client', () => ({
  ALERTS_NUDGE_DISMISSED_KEY: 'shiftswap:alerts-nudge:dismissed',
  PUSH_BANNER_DISMISSED_KEY: 'shiftswap:alerts:push-banner-dismissed',
  unsubscribeFromPush: mocks.unsubscribeFromPush,
  closeShownNotifications: mocks.closeShownNotifications,
  clearAppCaches: mocks.clearAppCaches,
}))

import { DEVICE_PROMPT_KEYS, SIGNED_OUT_PATH, signOutOnThisDevice } from '@/lib/auth/sign-out'

let cookieJar: string[]
const replace = vi.fn()
const storage = new Map<string, string>()

beforeEach(() => {
  mocks.order.length = 0
  cookieJar = ['sb-abc-auth-token.0=part0', 'sb-abc-auth-token.1=part1', 'theme=dark']
  storage.clear()
  for (const key of DEVICE_PROMPT_KEYS) storage.set(key, '1')
  storage.set('something-else', 'keep')
  replace.mockReset()

  const track =
    (name: string, value: unknown = undefined) =>
    async () => {
      mocks.order.push(name)
      return value
    }
  mocks.signOut.mockReset().mockImplementation(track('signOut', { error: null }))
  mocks.createClient.mockReset().mockReturnValue({ auth: { signOut: mocks.signOut } })
  mocks.unsubscribeFromPush.mockReset().mockImplementation(track('unsubscribe', true))
  mocks.closeShownNotifications.mockReset().mockImplementation(track('closeNotifications'))
  mocks.clearAppCaches.mockReset().mockImplementation(track('clearCaches'))
  mocks.clearSnapshots.mockReset().mockImplementation(() => {
    mocks.order.push('clearSnapshots')
  })

  vi.stubGlobal('window', {
    location: { replace },
    localStorage: { removeItem: (key: string) => storage.delete(key) },
  })
  vi.stubGlobal('document', {
    get cookie() {
      return cookieJar.join('; ')
    },
    set cookie(value: string) {
      const name = value.split('=')[0]
      if (/Max-Age=0/.test(value)) cookieJar = cookieJar.filter((c) => c.split('=')[0] !== name)
    },
  })
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('signOutOnThisDevice', () => {
  it('runs every step in order and ends with a full load of /login', async () => {
    await signOutOnThisDevice()
    expect(mocks.order).toEqual(['unsubscribe', 'clearSnapshots', 'closeNotifications', 'clearCaches', 'signOut'])
    expect(mocks.signOut).toHaveBeenCalledWith({ scope: 'local' })
    expect(replace).toHaveBeenCalledWith(SIGNED_OUT_PATH)
    expect(SIGNED_OUT_PATH).toBe('/login')
    // Session ended cleanly, so the cookies were left to auth-js.
    expect(cookieJar).toHaveLength(3)
  })

  it('forgets this device’s alert-prompt choices for the next member', async () => {
    await signOutOnThisDevice()
    for (const key of DEVICE_PROMPT_KEYS) expect(storage.has(key)).toBe(false)
    expect(storage.get('something-else')).toBe('keep')
  })

  it('a failed /logout (offline) still signs out and still goes to /login', async () => {
    mocks.signOut.mockResolvedValue({ error: Object.assign(new Error('Failed to fetch'), { name: 'AuthRetryableFetchError' }) })
    mocks.unsubscribeFromPush.mockRejectedValue(new TypeError('Failed to fetch'))
    await signOutOnThisDevice()
    expect(replace).toHaveBeenCalledWith('/login')
    // Belt and braces: the session cookies are removed by hand.
    expect(cookieJar).toEqual(['theme=dark'])
  })

  it('a thrown sign-out error still ends on /login', async () => {
    mocks.signOut.mockRejectedValue(new Error('boom'))
    await signOutOnThisDevice()
    expect(replace).toHaveBeenCalledWith('/login')
    expect(cookieJar).toEqual(['theme=dark'])
  })

  it('does not hang on a step that never finishes', async () => {
    vi.useFakeTimers()
    mocks.unsubscribeFromPush.mockImplementation(() => new Promise(() => {}))
    mocks.signOut.mockImplementation(() => new Promise(() => {}))
    const done = signOutOnThisDevice()
    await vi.runAllTimersAsync()
    await done
    expect(mocks.clearSnapshots).toHaveBeenCalled()
    expect(replace).toHaveBeenCalledWith('/login')
    expect(cookieJar).toEqual(['theme=dark'])
  })

  it('without a Supabase client it still clears local data and goes to /login', async () => {
    mocks.createClient.mockImplementation(() => {
      throw new Error('Supabase is not configured')
    })
    await signOutOnThisDevice()
    expect(mocks.unsubscribeFromPush).not.toHaveBeenCalled()
    expect(mocks.clearSnapshots).toHaveBeenCalled()
    expect(mocks.clearAppCaches).toHaveBeenCalled()
    expect(replace).toHaveBeenCalledWith('/login')
  })
})
