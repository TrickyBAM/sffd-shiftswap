import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  MAX_TOKEN_AGE_MS,
  MIN_FILL_MS,
  checkFormToken,
  clientIpFrom,
  EMAIL_KEY_PREFIX,
  hashClientIp,
  hashEmailKey,
  issueFormToken,
  rateLimitNetwork,
} from '@/app/(auth)/signup/_lib/guard'

const SECRET = 'sb_secret_test_value'
const NOW = Date.UTC(2026, 8, 23, 15, 0, 0)

describe('sign-up form token', () => {
  it('passes once the form has been open for 3 seconds', () => {
    const token = issueFormToken(SECRET, NOW)
    expect(checkFormToken(token, SECRET, NOW + MIN_FILL_MS)).toBe('ok')
    expect(checkFormToken(token, SECRET, NOW + 60_000)).toBe('ok')
  })

  it('flags submissions faster than 3 seconds', () => {
    const token = issueFormToken(SECRET, NOW)
    expect(checkFormToken(token, SECRET, NOW)).toBe('too-fast')
    expect(checkFormToken(token, SECRET, NOW + MIN_FILL_MS - 1)).toBe('too-fast')
  })

  it('expires old tokens', () => {
    const token = issueFormToken(SECRET, NOW)
    expect(checkFormToken(token, SECRET, NOW + MAX_TOKEN_AGE_MS + 1)).toBe('expired')
  })

  it('rejects forged, altered or malformed tokens', () => {
    const token = issueFormToken(SECRET, NOW)
    const [issuedAt, signature] = token.split('.')
    expect(checkFormToken(token, 'another secret', NOW + 5_000)).toBe('invalid')
    expect(checkFormToken(`${Number(issuedAt) - 10_000}.${signature}`, SECRET, NOW + 5_000)).toBe('invalid')
    expect(checkFormToken('', SECRET, NOW)).toBe('invalid')
    expect(checkFormToken('123', SECRET, NOW)).toBe('invalid')
    expect(checkFormToken(undefined, SECRET, NOW)).toBe('invalid')
    expect(checkFormToken('x'.repeat(300), SECRET, NOW)).toBe('invalid')
  })
})

describe('client IP key', () => {
  const headers = (values: Record<string, string>) => (name: string) => values[name] ?? null

  it('uses the first x-forwarded-for address, then x-real-ip', () => {
    expect(clientIpFrom(headers({ 'x-forwarded-for': ' 203.0.113.9 , 10.0.0.1' }))).toBe('203.0.113.9')
    expect(clientIpFrom(headers({ 'x-real-ip': '198.51.100.4' }))).toBe('198.51.100.4')
    expect(clientIpFrom(headers({}))).toBe('unknown')
  })

  it('is sha256(sha256(secret) + ip), never the raw IP or secret', () => {
    const sha = (text: string) => createHash('sha256').update(text).digest('hex')
    const key = hashClientIp('203.0.113.9', SECRET)
    expect(key).toBe(sha(`${sha(SECRET)}203.0.113.9`))
    expect(key).toMatch(/^[0-9a-f]{64}$/)
    expect(key).not.toContain('203.0.113.9')
    expect(hashClientIp('203.0.113.9', 'other')).not.toBe(key)
  })
})

describe('rate-limit network (SEC-5)', () => {
  it('keeps IPv4 addresses as they are (dropping a port)', () => {
    expect(rateLimitNetwork('203.0.113.9')).toBe('203.0.113.9')
    expect(rateLimitNetwork(' 203.0.113.9:4431 ')).toBe('203.0.113.9')
  })

  it('counts IPv6 addresses by their /64 network', () => {
    expect(rateLimitNetwork('2001:db8:aa:bb:1111:2222:3333:4444')).toBe('2001:db8:aa:bb::/64')
    expect(rateLimitNetwork('2001:DB8:AA:BB::1')).toBe('2001:db8:aa:bb::/64')
    expect(rateLimitNetwork('2001:0db8:00aa:00bb:0:0:0:ffff')).toBe('2001:db8:aa:bb::/64')
    expect(rateLimitNetwork('[2001:db8:aa:bb::5]:443')).toBe('2001:db8:aa:bb::/64')
    expect(rateLimitNetwork('fe80::1%eth0')).toBe('fe80:0:0:0::/64')
    expect(rateLimitNetwork('2001:db8::1')).toBe('2001:db8:0:0::/64')
    expect(rateLimitNetwork('::1')).toBe('0:0:0:0::/64')
    expect(rateLimitNetwork('64:ff9b::192.0.2.1')).toBe('64:ff9b:0:0::/64')
    // A different /64 is a different network.
    expect(rateLimitNetwork('2001:db8:aa:bc::1')).not.toBe(rateLimitNetwork('2001:db8:aa:bb::1'))
  })

  it('treats an IPv4-mapped IPv6 address as the IPv4 address', () => {
    expect(rateLimitNetwork('::ffff:203.0.113.9')).toBe('203.0.113.9')
    expect(rateLimitNetwork('::ffff:cb00:7109')).toBe('203.0.113.9')
  })

  it('leaves anything else alone', () => {
    expect(rateLimitNetwork('unknown')).toBe('unknown')
    expect(rateLimitNetwork('1:2:3')).toBe('1:2:3')
    expect(rateLimitNetwork('1::2::3')).toBe('1::2::3')
  })

  it('gives every address in one /64 the same key', () => {
    const a = hashClientIp('2001:db8:aa:bb:1111:2222:3333:4444', SECRET)
    expect(hashClientIp('2001:db8:aa:bb:9999::1', SECRET)).toBe(a)
    expect(hashClientIp('2001:db8:aa:bc::1', SECRET)).not.toBe(a)
    expect(hashClientIp('::ffff:203.0.113.9', SECRET)).toBe(hashClientIp('203.0.113.9', SECRET))
  })
})

describe('email key (SEC-2)', () => {
  it('is "email:" + a salted hash, never the address itself', () => {
    const sha = (text: string) => createHash('sha256').update(text).digest('hex')
    const key = hashEmailKey('pat@example.com', SECRET)
    expect(key).toBe(`${EMAIL_KEY_PREFIX}${sha(`${sha(SECRET)}email:pat@example.com`)}`)
    expect(key).toMatch(/^email:[0-9a-f]{64}$/)
    expect(key.length).toBeLessThanOrEqual(128)
    expect(key).not.toContain('pat')
    expect(hashEmailKey('pat@example.com', 'other')).not.toBe(key)
  })

  it('ignores case and surrounding spaces, and never matches an IP key', () => {
    expect(hashEmailKey('  Pat@Example.COM ', SECRET)).toBe(hashEmailKey('pat@example.com', SECRET))
    expect(hashEmailKey('pat@example.com', SECRET)).not.toBe(hashEmailKey('pat2@example.com', SECRET))
    expect(hashEmailKey('203.0.113.9', SECRET)).not.toBe(hashClientIp('203.0.113.9', SECRET))
  })
})
