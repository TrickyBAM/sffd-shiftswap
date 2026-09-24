// A cookie-less Supabase client with the public (publishable/anon) key, for
// route handlers that call the anonymous RPCs (§6.3 "Public"):
// app_keepalive (/api/keepalive) and calendar_feed (/api/calendar/[token]).
// It never reads or writes a session, and every request it makes is aborted
// after `timeoutMs`. Throws MissingEnvError when Supabase isn't configured.

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { getPublicEnv } from '@/lib/env'

/** fetch that gives up after `timeoutMs` (and still honours the caller's signal). */
export function fetchWithTimeout(timeoutMs: number): typeof fetch {
  return (input, init) => {
    const timeout = AbortSignal.timeout(timeoutMs)
    const signal = init?.signal ? AbortSignal.any([init.signal, timeout]) : timeout
    return fetch(input, { ...init, signal })
  }
}

export function createPublicClient({ timeoutMs }: { timeoutMs: number }): SupabaseClient {
  const { supabaseUrl, supabaseKey } = getPublicEnv()
  return createClient(supabaseUrl, supabaseKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: fetchWithTimeout(timeoutMs) },
  })
}

/**
 * Resolves with `promise`, or rejects with a TimeoutError after `ms`
 * (a backstop in case a request ignores its abort signal).
 */
export function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      const error = new Error(`Timed out after ${ms} ms`)
      error.name = 'TimeoutError'
      reject(error)
    }, ms)
  })
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
}

/** True for the error withTimeout (or an AbortSignal.timeout) rejects with. */
export function isTimeoutError(error: unknown): boolean {
  const name = (error as { name?: unknown } | null)?.name
  return name === 'TimeoutError'
}
