// Cheap bot filters for the sign-up server action (server only: uses
// node:crypto and the server secret). None of these ever log the secret.
//
// - Form token: the page embeds a signed "shown at" time. Submissions less
//   than MIN_FILL_MS after it are bots (or autofill racing ahead — they can
//   simply tap again). The server's own clock is used on both ends, so a phone
//   with the wrong time can't lock anyone out.
// - Rate-limit keys (SEC-2, SEC-5): one for the client's network and one for
//   the email address, both salted hashes, so neither the IP nor the email is
//   ever stored. An IPv6 client is counted by its /64 network: one phone or
//   home line gets a whole /64 and can hop between addresses in it at will.

import { createHash, createHmac, timingSafeEqual } from 'node:crypto'
import { isIPv4, isIPv6 } from 'node:net'

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

/** The 8 16-bit groups of an IPv6 address, or null when it isn't one. */
function ipv6Groups(address: string): number[] | null {
  if (!isIPv6(address)) return null
  let text = address
  // An IPv4 tail (::ffff:192.0.2.1, 64:ff9b::192.0.2.1) is the last two groups.
  const v4 = /(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(text)
  if (v4) {
    const [a, b, c, d] = v4.slice(1).map(Number)
    text = `${text.slice(0, v4.index)}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`
  }
  const halves = text.split('::')
  if (halves.length > 2) return null
  const head = halves[0] ? halves[0].split(':') : []
  const tail = halves.length === 2 && halves[1] ? halves[1].split(':') : []
  const missing = 8 - head.length - tail.length
  if (missing < 0 || (halves.length === 1 && missing !== 0)) return null
  const groups = [...head, ...Array<string>(missing).fill('0'), ...tail].map((group) => parseInt(group, 16))
  return groups.every((group) => Number.isInteger(group) && group >= 0 && group <= 0xffff) ? groups : null
}

/**
 * The part of a client address the sign-up limit counts (SEC-5):
 * - IPv4: the address itself ("203.0.113.9"; a ":port" suffix is dropped);
 * - IPv6: its /64 network ("2001:db8:0:1::/64"), since everything in a /64
 *   belongs to one subscriber; an IPv4-mapped address (::ffff:203.0.113.9)
 *   counts as that IPv4 address;
 * - anything else as given (e.g. 'unknown').
 */
export function rateLimitNetwork(ip: string): string {
  let text = ip.trim().toLowerCase()
  // "[2001:db8::1]:443" or "[2001:db8::1]"
  const bracketed = /^\[([^\]]+)\](?::\d+)?$/.exec(text)
  if (bracketed) text = bracketed[1]
  // "203.0.113.9:443"
  const withPort = /^(\d{1,3}(?:\.\d{1,3}){3}):\d+$/.exec(text)
  if (withPort) text = withPort[1]
  if (isIPv4(text)) return text

  // A zone id ("fe80::1%eth0") names a local interface, not part of the address.
  const zone = text.indexOf('%')
  const groups = ipv6Groups(zone > 0 ? text.slice(0, zone) : text)
  if (!groups) return text
  if (groups.slice(0, 5).every((group) => group === 0) && groups[5] === 0xffff) {
    return [groups[6] >> 8, groups[6] & 0xff, groups[7] >> 8, groups[7] & 0xff].join('.')
  }
  return `${groups
    .slice(0, 4)
    .map((group) => group.toString(16))
    .join(':')}::/64`
}

/**
 * Rate-limit key for a client's network: sha256(salt + network) where salt =
 * sha256(secret) and network = rateLimitNetwork(ip). Hex, 64 characters.
 */
export function hashClientIp(ip: string, secret: string): string {
  const salt = sha256Hex(secret)
  return sha256Hex(`${salt}${rateLimitNetwork(ip)}`)
}

/** Prefix that keeps email keys apart from network keys in private.signup_attempts. */
export const EMAIL_KEY_PREFIX = 'email:'

/**
 * Rate-limit key for the email address being signed up (SEC-2, SEC-5):
 * "email:" + sha256(salt + "email:" + address), salt = sha256(secret). The
 * address is trimmed and lower-cased first (as the sign-up form does), so
 * "Pat@Example.com " and "pat@example.com" share one count. 70 characters.
 */
export function hashEmailKey(email: string, secret: string): string {
  const salt = sha256Hex(secret)
  return `${EMAIL_KEY_PREFIX}${sha256Hex(`${salt}${EMAIL_KEY_PREFIX}${email.trim().toLowerCase()}`)}`
}
