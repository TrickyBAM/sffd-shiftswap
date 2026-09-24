import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// The server action's collaborators: request headers, the service-role client
// and the rate-limit RPC wrapper.
const mocks = vi.hoisted(() => ({
  headers: new Map<string, string>([['x-forwarded-for', '203.0.113.9, 10.0.0.1']]),
  createUser: vi.fn(),
  rateCheck: vi.fn(),
}))

vi.mock('next/headers', () => ({
  headers: async () => ({ get: (name: string) => mocks.headers.get(name) ?? null }),
}))
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({ auth: { admin: { createUser: mocks.createUser } } }),
}))
vi.mock('@/lib/api', () => ({
  signupRateCheck: mocks.rateCheck,
}))

import { signUp } from '@/app/(auth)/signup/actions'
import { hashClientIp, hashEmailKey, issueFormToken } from '@/app/(auth)/signup/_lib/guard'
import {
  EMAIL_LIMIT,
  EMAIL_LIMIT_MESSAGE,
  NETWORK_LIMIT,
  NETWORK_LIMIT_MESSAGE,
} from '@/app/(auth)/signup/_lib/limits'

const SECRET = 'sb_secret_for_tests'

function request(overrides: Record<string, unknown> = {}) {
  return {
    fullName: 'Pat  Firefighter',
    email: 'Pat@Example.com',
    phone: '415-555-0123',
    password: 'correct horse',
    hp: '',
    token: issueFormToken(SECRET, Date.now() - 10_000),
    ...overrides,
  }
}

describe('signUp server action', () => {
  beforeEach(() => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://example.supabase.co')
    vi.stubEnv('SUPABASE_SECRET_KEY', SECRET)
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', '')
    mocks.createUser.mockReset().mockResolvedValue({ data: { user: { id: 'u1' } }, error: null })
    mocks.rateCheck.mockReset().mockResolvedValue(true)
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  it('creates a confirmed account with the name and phone as metadata', async () => {
    await expect(signUp(request())).resolves.toEqual({ ok: true })
    expect(mocks.createUser).toHaveBeenCalledWith({
      email: 'pat@example.com',
      password: 'correct horse',
      email_confirm: true,
      user_metadata: { full_name: 'Pat Firefighter', phone: '415-555-0123' },
    })
  })

  it('rate-limits by the email (3 an hour), then by the network (30 an hour)', async () => {
    await signUp(request())
    expect(mocks.rateCheck).toHaveBeenCalledTimes(2)
    const [emailCall, networkCall] = mocks.rateCheck.mock.calls
    expect(emailCall[1]).toBe(hashEmailKey('pat@example.com', SECRET))
    expect(emailCall[1]).toMatch(/^email:[0-9a-f]{64}$/)
    expect(emailCall[2]).toEqual({ max: EMAIL_LIMIT, windowMinutes: 60 })
    expect(networkCall[1]).toBe(hashClientIp('203.0.113.9', SECRET))
    expect(networkCall[2]).toEqual({ max: NETWORK_LIMIT, windowMinutes: 60 })
    expect(EMAIL_LIMIT).toBe(3)
    expect(NETWORK_LIMIT).toBe(30)
  })

  it('never passes the raw email or IP to the database', async () => {
    await signUp(request())
    for (const [, key] of mocks.rateCheck.mock.calls) {
      expect(key).not.toMatch(/pat|example|203\.0\.113/i)
    }
  })

  it('counts an IPv6 client by its /64 network', async () => {
    mocks.headers.set('x-forwarded-for', '2001:db8:aa:bb:1111:2222:3333:4444')
    try {
      await signUp(request())
      await signUp(request({ email: 'other@example.com' }))
    } finally {
      mocks.headers.set('x-forwarded-for', '203.0.113.9, 10.0.0.1')
    }
    const networkKeys = mocks.rateCheck.mock.calls.filter(([, key]) => !String(key).startsWith('email:'))
    expect(networkKeys).toHaveLength(2)
    expect(networkKeys[0][1]).toBe(hashClientIp('2001:db8:aa:bb::1', SECRET))
  })

  it('refuses when the email has had too many tries, without using up the network allowance', async () => {
    mocks.rateCheck.mockResolvedValueOnce(false)
    const result = await signUp(request())
    expect(result).toEqual({ ok: false, message: EMAIL_LIMIT_MESSAGE })
    expect(mocks.rateCheck).toHaveBeenCalledTimes(1)
    expect(mocks.createUser).not.toHaveBeenCalled()
  })

  it('refuses when the network limit is reached and suggests cellular data, not an admin', async () => {
    mocks.rateCheck.mockResolvedValueOnce(true).mockResolvedValueOnce(false)
    const result = await signUp(request())
    expect(result).toEqual({ ok: false, message: NETWORK_LIMIT_MESSAGE })
    expect(NETWORK_LIMIT_MESSAGE).toMatch(/cellular/i)
    expect(NETWORK_LIMIT_MESSAGE).not.toMatch(/admin/i)
    expect(EMAIL_LIMIT_MESSAGE).not.toMatch(/admin/i)
    expect(mocks.createUser).not.toHaveBeenCalled()
  })

  it('silently refuses a filled-in honeypot', async () => {
    const result = await signUp(request({ hp: 'http://spam.example' }))
    expect(result).toMatchObject({ ok: false, retry: 'refresh' })
    expect(mocks.rateCheck).not.toHaveBeenCalled()
    expect(mocks.createUser).not.toHaveBeenCalled()
  })

  it('refuses submissions faster than 3 seconds', async () => {
    const result = await signUp(request({ token: issueFormToken(SECRET, Date.now()) }))
    expect(result.ok).toBe(false)
    expect(mocks.createUser).not.toHaveBeenCalled()
  })

  it('refuses a forged form token', async () => {
    const result = await signUp(request({ token: issueFormToken('not the secret', Date.now() - 10_000) }))
    expect(result).toMatchObject({ ok: false, retry: 'refresh' })
    expect(mocks.createUser).not.toHaveBeenCalled()
  })

  it('validates the input and points at the field', async () => {
    const result = await signUp(request({ password: 'short' }))
    expect(result).toMatchObject({ ok: false, field: 'password' })
    expect(mocks.createUser).not.toHaveBeenCalled()
    await expect(signUp(null)).resolves.toMatchObject({ ok: false })
  })

  it('maps "already registered" to a friendly message', async () => {
    mocks.createUser.mockResolvedValue({
      data: { user: null },
      error: { name: 'AuthApiError', status: 422, code: 'email_exists', message: 'A user with this email address has already been registered' },
    })
    const result = await signUp(request())
    expect(result).toEqual({
      ok: false,
      field: 'email',
      code: 'account-exists',
      message: 'An account with this email already exists — try logging in.',
    })
  })

  it('never throws: an outage becomes a friendly message', async () => {
    mocks.createUser.mockRejectedValue(new TypeError('fetch failed'))
    const result = await signUp(request())
    expect(result).toEqual({ ok: false, message: "Can't reach ShiftSwap right now. Check your connection and try again." })
  })

  it('reports missing server configuration without leaking secrets', async () => {
    vi.stubEnv('SUPABASE_SECRET_KEY', '')
    const result = await signUp(request())
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.message).toMatch(/not configured/i)
    expect(mocks.createUser).not.toHaveBeenCalled()
  })
})
