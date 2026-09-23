import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  MAX_TOKEN_AGE_MS,
  MIN_FILL_MS,
  checkFormToken,
  clientIpFrom,
  hashClientIp,
  issueFormToken,
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
