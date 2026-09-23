// Cheap bot filters for the sign-up server action (server only: uses
// node:crypto and the server secret). None of these ever log the secret.
//
// - Form token: the page embeds a signed "shown at" time. Submissions less
//   than MIN_FILL_MS after it are bots (or autofill racing ahead — they can
//   simply tap again). The server's own clock is used on both ends, so a phone
//   with the wrong time can't lock anyone out.
// - Client IP key for the rate limit: sha256(sha256(secret) + ip). The raw IP is
//   never stored.

import { createHash, createHmac, timingSafeEqual } from 'node:crypto'

export const MIN_FILL_MS = 3_000
/** Tokens older than this are refused (the member is asked to refresh). */
export const MAX_TOKEN_AGE_MS = 2 * 24 * 60 * 60 * 1000

const TOKEN_CONTEXT = 'shiftswap:signup-form:v1:'

function sha256Hex(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex')
}

function sign(issuedAt: number, secret: string): string {
  return createHmac('sha256', secret).update(`${TOKEN_CONTEXT}${issuedAt}`, 'utf8').digest('base64url')
}

/** A token recording when the sign-up form was served: "<ms>.<signature>". */
export function issueFormToken(secret: string, now: number = Date.now()): string {
  const issuedAt = Math.floor(now)
  return `${issuedAt}.${sign(issuedAt, secret)}`
}

export type FormTokenCheck = 'ok' | 'too-fast' | 'expired' | 'invalid'

/** Verifies a token from issueFormToken and how long ago it was issued. */
export function checkFormToken(token: unknown, secret: string, now: number = Date.now()): FormTokenCheck {
  if (typeof token !== 'string' || token.length > 200) return 'invalid'
  const match = /^(\d{10,16})\.([A-Za-z0-9_-]{20,100})$/.exec(token)
  if (!match) return 'invalid'
  const issuedAt = Number(match[1])
  if (!Number.isSafeInteger(issuedAt)) return 'invalid'

  const expected = Buffer.from(sign(issuedAt, secret), 'utf8')
  const given = Buffer.from(match[2], 'utf8')
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return 'invalid'

  const elapsed = now - issuedAt
  if (elapsed < MIN_FILL_MS) return 'too-fast'
  if (elapsed > MAX_TOKEN_AGE_MS) return 'expired'
  return 'ok'
}

/**
 * The client's IP from the proxy headers: the first x-forwarded-for entry
 * (Vercel sets it to the real client), else x-real-ip, else 'unknown'.
 */
export function clientIpFrom(getHeader: (name: string) => string | null | undefined): string {
  const forwarded = getHeader('x-forwarded-for')?.split(',')[0]?.trim()
  if (forwarded) return forwarded.slice(0, 100)
  const real = getHeader('x-real-ip')?.trim()
  if (real) return real.slice(0, 100)
  return 'unknown'
}

/** Rate-limit key for an IP: sha256(salt + ip) where salt = sha256(secret). Hex, 64 chars. */
export function hashClientIp(ip: string, secret: string): string {
  const salt = sha256Hex(secret)
  return sha256Hex(`${salt}${ip}`)
}
