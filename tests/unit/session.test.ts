import { AuthApiError, AuthRetryableFetchError } from '@supabase/supabase-js'
import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type CookieToSet = { name: string; value: string; options: Record<string, unknown> }

const mocks = vi.hoisted(() => ({
  getClaims: vi.fn(),
  /** Cookies the fake client "refreshes" (via setAll) during getClaims(). */
  refresh: null as CookieToSet[] | null,
  createServerClient: vi.fn(),
}))

vi.mock('@supabase/ssr', () => ({
  createServerClient: mocks.createServerClient.mockImplementation(
    (_url: string, _key: string, options: { cookies: { setAll: (c: CookieToSet[], h: Record<string, string>) => void } }) => ({
      auth: {
        async getClaims() {
          if (mocks.refresh) {
            options.cookies.setAll(mocks.refresh, {
              'Cache-Control': 'private, no-cache, no-store, must-revalidate, max-age=0',
              Expires: '0',
              Pragma: 'no-cache',
            })
          }
          return mocks.getClaims()
        },
      },
    }),
  ),
}))

import { isAuthPage, isPublicPath, safeNextPath, updateSession } from '@/lib/supabase/session'

const ORIGIN = 'https://shiftswap.test'
const AUTH_COOKIE = 'sb-abc-auth-token=base64-session'
const SIGNED_IN = { data: { claims: { sub: 'user-1' }, header: {}, signature: new Uint8Array() }, error: null }

function request(path: string, cookie?: string) {
  return new NextRequest(`${ORIGIN}${path}`, { headers: cookie ? { cookie } : {} })
}

function location(res: Response): string | null {
  const loc = res.headers.get('location')
  return loc ? loc.replace(ORIGIN, '') : null
}

const passedThrough = (res: Response) => res.headers.get('x-middleware-next') === '1'

beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://abc.supabase.co')
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', 'sb_publishable_test')
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', '')
  mocks.getClaims.mockReset()
  mocks.createServerClient.mockClear()
  mocks.refresh = null
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('path helpers', () => {
  it('isPublicPath', () => {
    for (const p of [
      '/login',
      '/signup',
      '/privacy',
      '/offline',
      '/api/keepalive',
      '/api/push/flush',
      '/api/calendar/0b7c',
      '/sw.js',
      '/manifest.webmanifest',
      '/icons/icon-192.png',
      '/favicon.ico',
      '/_next/static/chunk.js',
    ]) {
      expect(isPublicPath(p), p).toBe(true)
    }
    for (const p of ['/', '/calendar', '/board', '/trades/123', '/admin', '/api/other', '/api/calendar', '/loginx', '/privacy-x']) {
      expect(isPublicPath(p), p).toBe(false)
    }
  })

  it('isAuthPage', () => {
    expect(isAuthPage('/login')).toBe(true)
    expect(isAuthPage('/signup')).toBe(true)
    expect(isAuthPage('/login/extra')).toBe(true)
    expect(isAuthPage('/logins')).toBe(false)
    expect(isAuthPage('/calendar')).toBe(false)
  })

  it('safeNextPath only allows same-site relative paths', () => {
    expect(safeNextPath('/trades')).toBe('/trades')
    expect(safeNextPath('/board?shift=abc#x')).toBe('/board?shift=abc#x')
    expect(safeNextPath('/trades/../admin')).toBe('/admin')
    for (const bad of [
      null,
      undefined,
      '',
      'trades',
      'https://evil.example',
      '//evil.example',
      '/\\evil.example',
      '/\tevil',
      '/%0a',
      '/login',
      '/signup?next=/x',
      'javascript:alert(1)',
    ]) {
      // '/%0a' is an encoded (harmless) path; everything else must be rejected.
      if (bad === '/%0a') expect(safeNextPath(bad)).toBe('/%0a')
      else expect(safeNextPath(bad), String(bad)).toBeNull()
    }
  })
})

describe('updateSession', () => {
  it('skips auth entirely on public pages, public APIs and assets', async () => {
    for (const p of ['/privacy', '/offline', '/api/keepalive', '/api/push/flush', '/api/calendar/tok', '/icons/a.png']) {
      const res = await updateSession(request(p, AUTH_COOKIE))
      expect(passedThrough(res), p).toBe(true)
    }
    expect(mocks.createServerClient).not.toHaveBeenCalled()
  })

  it('sends signed-out visitors to /login with a next path (no auth call without cookies)', async () => {
    const res = await updateSession(request('/board?shift=abc'))
    expect(res.status).toBe(307)
    expect(location(res)).toBe('/login?next=%2Fboard%3Fshift%3Dabc')
    expect(mocks.getClaims).not.toHaveBeenCalled()

    const root = await updateSession(request('/'))
    expect(location(root)).toBe('/login')

    // Next's internal ?_rsc= param is not part of the return path.
    const rsc = await updateSession(request('/trades?_rsc=1x2y&tab=history'))
    expect(location(rsc)).toBe('/login?next=%2Ftrades%3Ftab%3Dhistory')
  })

  it('answers 401 JSON for signed-out API calls', async () => {
    const res = await updateSession(request('/api/something'))
    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: 'Please sign in.' })
  })

  it('lets signed-out visitors see /login and /signup', async () => {
    expect(passedThrough(await updateSession(request('/login')))).toBe(true)
    expect(passedThrough(await updateSession(request('/signup?x=1')))).toBe(true)
  })

  it('lets signed-in members through', async () => {
    mocks.getClaims.mockResolvedValue(SIGNED_IN)
    const res = await updateSession(request('/calendar', AUTH_COOKIE))
    expect(passedThrough(res)).toBe(true)
    expect(mocks.getClaims).toHaveBeenCalledTimes(1)
    const [url, key] = mocks.createServerClient.mock.calls[0]
    expect(url).toBe('https://abc.supabase.co')
    expect(key).toBe('sb_publishable_test')
  })

  it('bounces signed-in members away from /login and /signup', async () => {
    mocks.getClaims.mockResolvedValue(SIGNED_IN)
    expect(location(await updateSession(request('/login', AUTH_COOKIE)))).toBe('/calendar')
    expect(location(await updateSession(request('/signup', AUTH_COOKIE)))).toBe('/calendar')
    expect(location(await updateSession(request('/login?next=%2Ftrades%3Ftab%3Dpending', AUTH_COOKIE)))).toBe(
      '/trades?tab=pending',
    )
    expect(location(await updateSession(request('/login?next=%2F%2Fevil.example', AUTH_COOKIE)))).toBe('/calendar')
  })

  it('writes refreshed cookies (and no-cache headers) on pass-through responses', async () => {
    mocks.getClaims.mockResolvedValue(SIGNED_IN)
    mocks.refresh = [{ name: 'sb-abc-auth-token', value: 'fresh', options: { path: '/', httpOnly: false, maxAge: 3600 } }]
    const res = await updateSession(request('/board', AUTH_COOKIE))
    expect(passedThrough(res)).toBe(true)
    expect(res.cookies.get('sb-abc-auth-token')?.value).toBe('fresh')
    expect(res.headers.get('cache-control')).toMatch(/no-store/)
  })

  it('copies refreshed cookies onto redirects', async () => {
    mocks.getClaims.mockResolvedValue(SIGNED_IN)
    mocks.refresh = [
      { name: 'sb-abc-auth-token.0', value: 'chunk0', options: { path: '/', maxAge: 3600 } },
      { name: 'sb-abc-auth-token.1', value: 'chunk1', options: { path: '/', maxAge: 3600 } },
    ]
    const res = await updateSession(request('/login', AUTH_COOKIE))
    expect(location(res)).toBe('/calendar')
    expect(res.cookies.get('sb-abc-auth-token.0')?.value).toBe('chunk0')
    expect(res.cookies.get('sb-abc-auth-token.1')?.value).toBe('chunk1')
    expect(res.headers.get('set-cookie')).toMatch(/sb-abc-auth-token\.0=chunk0/)
    expect(res.headers.get('cache-control')).toMatch(/no-store/)
  })

  it('treats an invalid session as signed out and clears its cookies on the redirect', async () => {
    mocks.getClaims.mockResolvedValue({ data: null, error: new AuthApiError('Invalid Refresh Token', 400, 'refresh_token_not_found') })
    mocks.refresh = [{ name: 'sb-abc-auth-token', value: '', options: { path: '/', maxAge: 0 } }]
    const res = await updateSession(request('/trades', AUTH_COOKIE))
    expect(location(res)).toBe('/login?next=%2Ftrades')
    expect(res.headers.get('set-cookie')).toMatch(/sb-abc-auth-token=;.*Max-Age=0/i)
  })

  it('treats "no session" as signed out', async () => {
    mocks.getClaims.mockResolvedValue({ data: null, error: null })
    const res = await updateSession(request('/profile', AUTH_COOKIE))
    expect(location(res)).toBe('/login?next=%2Fprofile')
  })

  it('never throws or signs people out during a Supabase outage', async () => {
    mocks.getClaims.mockResolvedValue({ data: null, error: new AuthRetryableFetchError('fetch failed', 0) })
    expect(passedThrough(await updateSession(request('/calendar', AUTH_COOKIE)))).toBe(true)

    mocks.getClaims.mockResolvedValue({ data: null, error: new AuthApiError('upstream', 503, undefined) })
    expect(passedThrough(await updateSession(request('/calendar', AUTH_COOKIE)))).toBe(true)

    mocks.getClaims.mockRejectedValue(new TypeError('fetch failed'))
    expect(passedThrough(await updateSession(request('/calendar', AUTH_COOKIE)))).toBe(true)
    // …and an auth page still renders.
    expect(passedThrough(await updateSession(request('/login', AUTH_COOKIE)))).toBe(true)

    mocks.createServerClient.mockImplementationOnce(() => {
      throw new Error('boom')
    })
    expect(passedThrough(await updateSession(request('/calendar', AUTH_COOKIE)))).toBe(true)
  })

  it('passes requests through when Supabase is not configured (pages show the error)', async () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', '')
    const res = await updateSession(request('/calendar'))
    expect(passedThrough(res)).toBe(true)
    expect(mocks.createServerClient).not.toHaveBeenCalled()
  })
})
