import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  getPublicEnv,
  getServerEnv,
  getVapidConfig,
  isPushConfigured,
  isSupabaseConfigured,
  MissingEnvError,
} from '@/lib/env'

const VARS = [
  'NEXT_PUBLIC_SUPABASE_URL',
  'SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  'SUPABASE_SECRET_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
  'NEXT_PUBLIC_VAPID_PUBLIC_KEY',
  'VAPID_PRIVATE_KEY',
  'VAPID_SUBJECT',
  'PUSH_WEBHOOK_SECRET',
]

beforeEach(() => {
  // Start every test from a blank environment.
  for (const name of VARS) vi.stubEnv(name, '')
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe('getPublicEnv', () => {
  it('accepts the publishable key', () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://abc.supabase.co/')
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', 'sb_publishable_123')
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'legacy-anon')
    expect(getPublicEnv()).toEqual({
      supabaseUrl: 'https://abc.supabase.co',
      supabaseKey: 'sb_publishable_123',
      vapidPublicKey: null,
    })
    expect(isSupabaseConfigured()).toBe(true)
  })

  it('falls back to the legacy anon key and trims values', () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', '  https://abc.supabase.co  ')
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', ' eyJanon ')
    vi.stubEnv('NEXT_PUBLIC_VAPID_PUBLIC_KEY', 'BPub')
    expect(getPublicEnv()).toEqual({ supabaseUrl: 'https://abc.supabase.co', supabaseKey: 'eyJanon', vapidPublicKey: 'BPub' })
  })

  it('throws a clear MissingEnvError naming what is missing', () => {
    expect(isSupabaseConfigured()).toBe(false)
    let error: unknown
    try {
      getPublicEnv()
    } catch (e) {
      error = e
    }
    expect(error).toBeInstanceOf(MissingEnvError)
    const err = error as MissingEnvError
    expect(err.message).toMatch(/Supabase is not configured/)
    expect(err.message).toMatch(/NEXT_PUBLIC_SUPABASE_URL/)
    expect(err.message).toMatch(/NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY \(or NEXT_PUBLIC_SUPABASE_ANON_KEY\)/)
    expect(err.message).toMatch(/Vercel/)
    expect(err.missing).toHaveLength(2)

    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://abc.supabase.co')
    expect(() => getPublicEnv()).toThrow(/missing NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY/)
  })

  it('rejects a malformed URL', () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'abc.supabase.co')
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'k')
    expect(isSupabaseConfigured()).toBe(false)
    expect(() => getPublicEnv()).toThrow(/not a valid URL/)
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'ftp://abc.supabase.co')
    expect(() => getPublicEnv()).toThrow(MissingEnvError)
  })
})

describe('getServerEnv', () => {
  it('accepts the secret key, or the legacy service-role key', () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://abc.supabase.co')
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'eyJservice')
    expect(getServerEnv()).toEqual({
      supabaseUrl: 'https://abc.supabase.co',
      supabaseSecretKey: 'eyJservice',
      vapid: null,
      pushWebhookSecret: null,
    })
    vi.stubEnv('SUPABASE_SECRET_KEY', 'sb_secret_abc')
    expect(getServerEnv().supabaseSecretKey).toBe('sb_secret_abc')
  })

  it('accepts SUPABASE_URL server-side (set by the Vercel integration)', () => {
    vi.stubEnv('SUPABASE_URL', 'https://xyz.supabase.co')
    vi.stubEnv('SUPABASE_SECRET_KEY', 'sb_secret_abc')
    expect(getServerEnv().supabaseUrl).toBe('https://xyz.supabase.co')
  })

  it('includes VAPID and webhook config when complete', () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://abc.supabase.co')
    vi.stubEnv('SUPABASE_SECRET_KEY', 'sb_secret_abc')
    vi.stubEnv('NEXT_PUBLIC_VAPID_PUBLIC_KEY', 'BPub')
    vi.stubEnv('VAPID_PRIVATE_KEY', 'priv')
    expect(getServerEnv().vapid).toBeNull() // subject still missing
    expect(isPushConfigured()).toBe(false)
    vi.stubEnv('VAPID_SUBJECT', 'mailto:admin@example.com')
    vi.stubEnv('PUSH_WEBHOOK_SECRET', 'shh')
    expect(getServerEnv()).toMatchObject({
      vapid: { publicKey: 'BPub', privateKey: 'priv', subject: 'mailto:admin@example.com' },
      pushWebhookSecret: 'shh',
    })
    expect(isPushConfigured()).toBe(true)
    expect(getVapidConfig()).toEqual({ publicKey: 'BPub', privateKey: 'priv', subject: 'mailto:admin@example.com' })
  })

  it('throws clear errors when required values are missing', () => {
    expect(() => getServerEnv()).toThrow(/missing NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY \(or SUPABASE_SERVICE_ROLE_KEY\)/)
    expect(() => getVapidConfig()).toThrow(/NEXT_PUBLIC_VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT/)
  })

  it('refuses to run in a browser', () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://abc.supabase.co')
    vi.stubEnv('SUPABASE_SECRET_KEY', 'sb_secret_abc')
    vi.stubGlobal('window', {})
    expect(() => getServerEnv()).toThrow(/only be called on the server/)
    expect(() => getVapidConfig()).toThrow(/only be called on the server/)
  })
})
