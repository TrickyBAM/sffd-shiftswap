import { NextRequest, NextResponse } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const updateSession = vi.hoisted(() => vi.fn())
vi.mock('@/lib/supabase/session', () => ({ updateSession }))

import { config, proxy } from '@/proxy'
import nextConfig from '../../next.config'

const ORIGIN = 'https://shiftswap.test'

beforeEach(() => {
  updateSession.mockReset()
  updateSession.mockResolvedValue(NextResponse.next())
})

describe('proxy', () => {
  it('delegates every request to updateSession (legacy redirects live in next.config.ts)', async () => {
    for (const path of ['/calendar', '/dashboard']) {
      const req = new NextRequest(`${ORIGIN}${path}`)
      await proxy(req)
      expect(updateSession).toHaveBeenLastCalledWith(req)
    }
  })

  it('returns the response updateSession built', async () => {
    const req = new NextRequest(`${ORIGIN}/calendar`)
    const res = await proxy(req)
    expect(updateSession).toHaveBeenCalledWith(req)
    expect(res.headers.get('x-middleware-next')).toBe('1')
  })

  it('matcher excludes static files, the service worker, manifest and icons', () => {
    const re = new RegExp(`^${config.matcher[0]}$`)
    for (const p of ['/', '/calendar', '/board', '/api/keepalive', '/login', '/trades/abc']) expect(re.test(p), p).toBe(true)
    for (const p of ['/sw.js', '/manifest.webmanifest', '/icons/icon-192.png', '/favicon.ico', '/_next/static/x.js', '/apple-icon.png', '/logo.svg']) {
      expect(re.test(p), p).toBe(false)
    }
  })
})

describe('legacy redirects (next.config.ts, the only copy)', () => {
  it.each([
    ['/dashboard', '/calendar'],
    ['/shift-board', '/board'],
    ['/post-shift', '/post'],
    ['/notifications', '/alerts'],
    ['/schedule-setup', '/profile'],
    ['/forgot-password', '/login'],
    ['/reset-password', '/login'],
    ['/verify-email', '/login'],
    ['/auth/callback', '/login'],
  ])('%s → %s (temporary)', async (source, destination) => {
    const redirects = (await nextConfig.redirects?.()) ?? []
    expect(redirects).toContainEqual({ source, destination, permanent: false })
  })

  it('serves /sw.js with the deploy version so open apps can spot a new deploy', async () => {
    const headers = (await nextConfig.headers?.()) ?? []
    const sw = headers.find((h) => h.source === '/sw.js')
    expect(sw?.headers.find((h) => h.key === 'X-App-Version')?.value).toBe(nextConfig.env?.NEXT_PUBLIC_APP_VERSION)
    expect(sw?.headers.find((h) => h.key === 'Cache-Control')?.value).toContain('no-store')
  })
})
