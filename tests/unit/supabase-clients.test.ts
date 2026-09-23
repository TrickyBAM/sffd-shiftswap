import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  createBrowserClient: vi.fn(() => ({ kind: 'browser', id: Math.random() })),
  createServerClient: vi.fn<(url: string, key: string, opts: unknown) => { kind: string }>(() => ({ kind: 'server' })),
  createClient: vi.fn<(url: string, key: string, opts: unknown) => { kind: string }>(() => ({ kind: 'admin' })),
  cookieStore: {
    getAll: vi.fn(() => [{ name: 'sb-abc-auth-token', value: 'v' }]),
    set: vi.fn(),
  },
}))

vi.mock('@supabase/ssr', () => ({
  createBrowserClient: mocks.createBrowserClient,
  createServerClient: mocks.createServerClient,
}))
vi.mock('@supabase/supabase-js', () => ({ createClient: mocks.createClient }))
vi.mock('next/headers', () => ({ cookies: async () => mocks.cookieStore }))

import { isMissingEnvError, MissingEnvError } from '@/lib/env'

beforeEach(() => {
  vi.resetModules()
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://abc.supabase.co')
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', 'sb_publishable_test')
  vi.stubEnv('SUPABASE_SECRET_KEY', 'sb_secret_test')
  mocks.createBrowserClient.mockClear()
  mocks.createServerClient.mockClear()
  mocks.createClient.mockClear()
  mocks.cookieStore.set.mockReset()
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe('browser client', () => {
  it('is a singleton in the browser', async () => {
    vi.stubGlobal('window', {})
    const { createClient } = await import('@/lib/supabase/client')
    const a = createClient()
    const b = createClient()
    expect(a).toBe(b)
    expect(mocks.createBrowserClient).toHaveBeenCalledTimes(1)
    expect(mocks.createBrowserClient).toHaveBeenCalledWith('https://abc.supabase.co', 'sb_publishable_test')
  })

  it('is not memoised during SSR', async () => {
    const { createClient } = await import('@/lib/supabase/client')
    createClient()
    createClient()
    expect(mocks.createBrowserClient).toHaveBeenCalledTimes(2)
  })

  it('fails loudly when not configured', async () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', '')
    const { createClient } = await import('@/lib/supabase/client')
    // resetModules gives a fresh env module, so match by name rather than class identity.
    expect(() => createClient()).toThrow(expect.objectContaining({ name: 'MissingEnvError' }))
    expect(isMissingEnvError(new MissingEnvError('x', []))).toBe(true)
  })
})

describe('server client', () => {
  it('reads and writes cookies through next/headers', async () => {
    const { createClient } = await import('@/lib/supabase/server')
    await createClient()
    const [url, key, opts] = mocks.createServerClient.mock.calls[0] as unknown as [
      string,
      string,
      { cookies: { getAll: () => unknown; setAll: (c: Array<{ name: string; value: string; options: object }>) => void } },
    ]
    expect(url).toBe('https://abc.supabase.co')
    expect(key).toBe('sb_publishable_test')
    expect(opts.cookies.getAll()).toEqual([{ name: 'sb-abc-auth-token', value: 'v' }])
    opts.cookies.setAll([{ name: 'a', value: '1', options: { path: '/' } }])
    expect(mocks.cookieStore.set).toHaveBeenCalledWith('a', '1', { path: '/' })
  })

  it('ignores cookie writes from Server Components (read-only cookies)', async () => {
    mocks.cookieStore.set.mockImplementation(() => {
      throw new Error('Cookies can only be modified in a Server Action or Route Handler.')
    })
    const { createClient } = await import('@/lib/supabase/server')
    await createClient()
    const opts = mocks.createServerClient.mock.calls[0][2] as { cookies: { setAll: (c: unknown[]) => void } }
    expect(() => opts.cookies.setAll([{ name: 'a', value: '1', options: {} }])).not.toThrow()
  })
})

describe('admin client', () => {
  it('uses the secret key without a persisted session', async () => {
    const { createAdminClient } = await import('@/lib/supabase/admin')
    createAdminClient()
    expect(mocks.createClient).toHaveBeenCalledWith('https://abc.supabase.co', 'sb_secret_test', {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    })
  })

  it('falls back to the legacy service-role key', async () => {
    vi.stubEnv('SUPABASE_SECRET_KEY', '')
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'eyJservice')
    const { createAdminClient } = await import('@/lib/supabase/admin')
    createAdminClient()
    expect(mocks.createClient.mock.calls[0][1]).toBe('eyJservice')
  })

  it('refuses to run in a browser or without a secret key', async () => {
    const { createAdminClient } = await import('@/lib/supabase/admin')
    vi.stubEnv('SUPABASE_SECRET_KEY', '')
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', '')
    expect(() => createAdminClient()).toThrow(/SUPABASE_SECRET_KEY/)
    vi.stubGlobal('window', {})
    expect(() => createAdminClient()).toThrow(/only be called on the server/)
  })
})
