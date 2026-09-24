// Environment configuration (ARCHITECTURE §7.4).
//
// On Vercel the Supabase Marketplace integration sets these automatically.
// Both the new key names (publishable / secret) and the legacy ones (anon /
// service_role) are accepted.
//
// NEXT_PUBLIC_* values are inlined into the browser bundle only when read as
// literal `process.env.NEXT_PUBLIC_…` expressions, so each one is referenced
// by name below (never via process.env[name]).
//
// Missing values throw MissingEnvError at request time (not at import time),
// so pages that don't need Supabase (/offline, /privacy, /api/keepalive) keep
// working and can report the problem instead of crashing.

export class MissingEnvError extends Error {
  readonly missing: readonly string[]

  constructor(message: string, missing: readonly string[]) {
    super(message)
    this.name = 'MissingEnvError'
    this.missing = missing
  }
}

/** True for a MissingEnvError (also across bundles/module instances, by name). */
export function isMissingEnvError(error: unknown): error is MissingEnvError {
  return error instanceof MissingEnvError || (error as { name?: unknown } | null)?.name === 'MissingEnvError'
}

export interface PublicEnv {
  supabaseUrl: string
  /** Publishable key (sb_publishable_…) or legacy anon JWT. */
  supabaseKey: string
  /** VAPID public key for web push, or null if push isn't configured. */
  vapidPublicKey: string | null
}

export interface VapidConfig {
  publicKey: string
  privateKey: string
  /** mailto: or https: contact for push services. */
  subject: string
}

export interface ServerEnv {
  supabaseUrl: string
  /** Secret key (sb_secret_…) or legacy service_role JWT. Server only. */
  supabaseSecretKey: string
  /** Full VAPID config, or null when any of the three values is missing. */
  vapid: VapidConfig | null
  /** Shared secret for POST /api/push/flush from the database webhook, or null. */
  pushWebhookSecret: string | null
}

function clean(value: string | undefined): string | null {
  const v = value?.trim()
  return v ? v : null
}

function readSupabaseUrl(): string | null {
  return clean(process.env.NEXT_PUBLIC_SUPABASE_URL)
}

function readPublishableKey(): string | null {
  return clean(process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY) ?? clean(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)
}

function validUrl(url: string, name: string): string {
  try {
    const parsed = new URL(url)
    if (parsed.protocol === 'https:' || parsed.protocol === 'http:') return url.replace(/\/+$/, '')
  } catch {
    // fall through
  }
  throw new MissingEnvError(`${name} is not a valid URL (got "${url}").`, [name])
}

const SETUP_HINT =
  'On Vercel, connect Supabase from the project’s Storage tab (Marketplace integration) and redeploy; locally, put the values in .env.local.'

/** True when the public Supabase URL and key are present. Never throws. */
export function isSupabaseConfigured(): boolean {
  try {
    const url = readSupabaseUrl()
    return Boolean(url && readPublishableKey() && new URL(url))
  } catch {
    return false
  }
}

/** Public (browser-safe) configuration. Throws MissingEnvError if Supabase isn't configured. */
export function getPublicEnv(): PublicEnv {
  const url = readSupabaseUrl()
  const key = readPublishableKey()
  const missing: string[] = []
  if (!url) missing.push('NEXT_PUBLIC_SUPABASE_URL')
  if (!key) missing.push('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY (or NEXT_PUBLIC_SUPABASE_ANON_KEY)')
  if (missing.length) {
    throw new MissingEnvError(`Supabase is not configured: missing ${missing.join(' and ')}. ${SETUP_HINT}`, missing)
  }
  return {
    supabaseUrl: validUrl(url!, 'NEXT_PUBLIC_SUPABASE_URL'),
    supabaseKey: key!,
    vapidPublicKey: clean(process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY),
  }
}

/**
 * Server-only configuration (secret key, VAPID private key, webhook secret).
 * Throws MissingEnvError when the Supabase URL or secret key is missing, and
 * refuses to run in a browser.
 */
export function getServerEnv(): ServerEnv {
  if (typeof window !== 'undefined') {
    throw new Error('getServerEnv() must only be called on the server.')
  }
  // SUPABASE_URL is also set by the Vercel integration; accept it server-side.
  const url = readSupabaseUrl() ?? clean(process.env.SUPABASE_URL)
  const secret = clean(process.env.SUPABASE_SECRET_KEY) ?? clean(process.env.SUPABASE_SERVICE_ROLE_KEY)
  const missing: string[] = []
  if (!url) missing.push('NEXT_PUBLIC_SUPABASE_URL')
  if (!secret) missing.push('SUPABASE_SECRET_KEY (or SUPABASE_SERVICE_ROLE_KEY)')
  if (missing.length) {
    throw new MissingEnvError(`Server is not configured: missing ${missing.join(' and ')}. ${SETUP_HINT}`, missing)
  }

  const publicKey = clean(process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY)
  const privateKey = clean(process.env.VAPID_PRIVATE_KEY)
  const subject = clean(process.env.VAPID_SUBJECT)
  return {
    supabaseUrl: validUrl(url!, 'NEXT_PUBLIC_SUPABASE_URL'),
    supabaseSecretKey: secret!,
    vapid: publicKey && privateKey && subject ? { publicKey, privateKey, subject } : null,
    pushWebhookSecret: clean(process.env.PUSH_WEBHOOK_SECRET),
  }
}

/**
 * VAPID config for sending web push. Throws MissingEnvError naming the missing
 * variables — use when push is required (e.g. /api/push/flush).
 */
export function getVapidConfig(): VapidConfig {
  if (typeof window !== 'undefined') {
    throw new Error('getVapidConfig() must only be called on the server.')
  }
  const publicKey = clean(process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY)
  const privateKey = clean(process.env.VAPID_PRIVATE_KEY)
  const subject = clean(process.env.VAPID_SUBJECT)
  const missing = [
    publicKey ? null : 'NEXT_PUBLIC_VAPID_PUBLIC_KEY',
    privateKey ? null : 'VAPID_PRIVATE_KEY',
    subject ? null : 'VAPID_SUBJECT',
  ].filter((v): v is string => v !== null)
  if (missing.length) {
    throw new MissingEnvError(`Web push is not configured: missing ${missing.join(', ')}.`, missing)
  }
  return { publicKey: publicKey!, privateKey: privateKey!, subject: subject! }
}

/** True when all three VAPID values are present. Never throws. */
export function isPushConfigured(): boolean {
  return Boolean(
    clean(process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY) && clean(process.env.VAPID_PRIVATE_KEY) && clean(process.env.VAPID_SUBJECT),
  )
}
