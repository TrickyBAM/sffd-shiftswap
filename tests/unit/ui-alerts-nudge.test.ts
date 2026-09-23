// When the home-screen "Turn on alerts" nudge shows (UX-03; src/components/AlertsNudge.tsx).

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const push = vi.hoisted(() => ({
  isIOS: vi.fn(() => false),
  isStandalone: vi.fn(() => false),
  isPushSupported: vi.fn(() => true),
  getPushPermission: vi.fn((): NotificationPermission | 'unsupported' => 'default'),
  getCurrentPushSubscription: vi.fn(async (): Promise<unknown> => null),
}))

vi.mock('@/lib/push/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/push/client')>()),
  ...push,
}))
vi.mock('@/lib/supabase/client', () => ({ createClient: vi.fn() }))

import { detectAlertsNudge } from '@/components/AlertsNudge'
import { ALERTS_NUDGE_DISMISSED_KEY } from '@/lib/push/client'

const KEY = 'BPublicVapidKey'
let stored: Record<string, string>

beforeEach(() => {
  stored = {}
  vi.stubGlobal('window', {
    localStorage: {
      getItem: (k: string) => stored[k] ?? null,
      setItem: (k: string, v: string) => {
        stored[k] = v
      },
    },
  })
  push.isIOS.mockReturnValue(false)
  push.isStandalone.mockReturnValue(false)
  push.isPushSupported.mockReturnValue(true)
  push.getPushPermission.mockReturnValue('default')
  push.getCurrentPushSubscription.mockResolvedValue(null)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('detectAlertsNudge', () => {
  it('offers "Turn on alerts" when push works here but is off', async () => {
    await expect(detectAlertsNudge(KEY)).resolves.toBe('enable')
    push.getPushPermission.mockReturnValue('granted')
    await expect(detectAlertsNudge(KEY)).resolves.toBe('enable')
  })

  it('stays hidden once alerts are on, blocked, impossible, or dismissed', async () => {
    push.getPushPermission.mockReturnValue('granted')
    push.getCurrentPushSubscription.mockResolvedValue({ endpoint: 'x' })
    await expect(detectAlertsNudge(KEY)).resolves.toBe('hidden')

    push.getPushPermission.mockReturnValue('denied')
    await expect(detectAlertsNudge(KEY)).resolves.toBe('hidden')

    push.getPushPermission.mockReturnValue('default')
    await expect(detectAlertsNudge(null)).resolves.toBe('hidden')
    push.isPushSupported.mockReturnValue(false)
    await expect(detectAlertsNudge(KEY)).resolves.toBe('hidden')

    push.isPushSupported.mockReturnValue(true)
    stored[ALERTS_NUDGE_DISMISSED_KEY] = '1'
    await expect(detectAlertsNudge(KEY)).resolves.toBe('hidden')
  })

  it('iPhone in Safari: explain installing first; installed app: offer the switch', async () => {
    push.isIOS.mockReturnValue(true)
    push.isPushSupported.mockReturnValue(false) // Safari tabs have no PushManager
    await expect(detectAlertsNudge(KEY)).resolves.toBe('install')

    push.isStandalone.mockReturnValue(true)
    push.isPushSupported.mockReturnValue(true)
    await expect(detectAlertsNudge(KEY)).resolves.toBe('enable')
  })

  it('storage that throws never breaks it', async () => {
    vi.stubGlobal('window', {
      localStorage: {
        getItem: () => {
          throw new Error('SecurityError')
        },
      },
    })
    await expect(detectAlertsNudge(KEY)).resolves.toBe('enable')
  })
})
