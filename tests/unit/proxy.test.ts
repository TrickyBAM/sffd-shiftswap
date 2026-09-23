import { NextRequest, NextResponse } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const updateSession = vi.hoisted(() => vi.fn())
vi.mock('@/lib/supabase/session', () => ({ updateSession }))

import { config, proxy } from '@/proxy'

const ORIGIN = 'https://shiftswap.test'

beforeEach(() => {
  updateSession.mockReset()
  updateSession.mockResolvedValue(NextResponse.next())
})

describe('proxy', () => {
  it.each([
    ['/dashboard', '/calendar'],
    ['/shift-board', '/board'],
    ['/post-shift', '/post'],
    ['/notifications', '/alerts'],
    ['/schedule-setup', '/profile'],
    ['/dashboard/', '/calendar'],
  ])('redirects legacy %s → %s', async (from, to) => {
    const res = await proxy(new NextRequest(`${ORIGIN}${from}?x=1`))
    expect(res.status).toBe(307)
    expect(res.headers.get('location')).toBe(`${ORIGIN}${to}?x=1`)
    expect(updateSession).not.toHaveBeenCalled()
  })

  it('delegates everything else to updateSession', async () => {
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
