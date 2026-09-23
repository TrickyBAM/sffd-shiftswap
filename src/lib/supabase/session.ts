// Session refresh + signed-out bounce for the proxy (src/proxy.ts).
//
// Responsibilities (ARCHITECTURE §7.1): keep the Supabase auth cookies fresh
// and send signed-out visitors to /login. Everything else (onboarding status,
// admin role, TeleStaff acknowledgment) is gated server-side in layouts.
//
// Rules:
// - Public paths skip auth entirely: /privacy, /offline, /api/keepalive,
//   /api/push/flush, /api/calendar/*, static assets.
// - /login and /signup are public, but a signed-in visitor is sent on to
//   /calendar (or a safe ?next= path).
// - Any other path needs a session: pages redirect to /login?next=<path>,
//   API routes get a 401 JSON response.
// - Refreshed cookies are copied onto every response we return, including
//   redirects, so a token refresh is never lost.
// - A Supabase outage never throws here. If auth can't be checked and the
//   request carries auth cookies, the request continues and the layout's gate
//   shows an error state (never "signed out").

import { createServerClient } from '@supabase/ssr'
import { isAuthRetryableFetchError, type SupabaseClient } from '@supabase/supabase-js'
import { NextResponse, type NextRequest } from 'next/server'
import { getPublicEnv, isSupabaseConfigured } from '@/lib/env'

export const LOGIN_PATH = '/login'
export const HOME_PATH = '/calendar'

const AUTH_PAGES = ['/login', '/signup']
const PUBLIC_PAGES = ['/privacy', '/offline']
const PUBLIC_API = ['/api/keepalive', '/api/push/flush']
const PUBLIC_PREFIXES = ['/api/calendar/', '/_next/', '/icons/']
const STATIC_FILE_RE = /\.(?:ico|png|jpe?g|gif|webp|avif|svg|txt|xml|json|webmanifest|js|mjs|css|map|woff2?|ttf)$/i
const AUTH_COOKIE_RE = /^sb-.+-auth-token(?:\.\d+)?$/

function matches(pathname: string, path: string): boolean {
  return pathname === path || pathname.startsWith(`${path}/`)
}

/** /login and /signup (and anything below them). */
export function isAuthPage(pathname: string): boolean {
  return AUTH_PAGES.some((p) => matches(pathname, p))
}

/** Paths reachable without signing in (includes the auth pages). */
export function isPublicPath(pathname: string): boolean {
  return (
    isAuthPage(pathname) ||
    PUBLIC_PAGES.some((p) => matches(pathname, p)) ||
    PUBLIC_API.some((p) => matches(pathname, p)) ||
    PUBLIC_PREFIXES.some((p) => pathname.startsWith(p)) ||
    pathname === '/sw.js' ||
    pathname === '/manifest.webmanifest' ||
    STATIC_FILE_RE.test(pathname)
  )
}

/**
 * Returns `value` if it is a same-site relative path that is safe to redirect
 * to after sign-in, otherwise null. Rejects absolute/protocol-relative URLs,
 * backslash tricks and the auth pages themselves (to avoid loops).
 */
export function safeNextPath(value: string | null | undefined): string | null {
  if (!value || !value.startsWith('/') || value.startsWith('//') || value.includes('\\')) return null
  // Control characters (tabs/newlines are stripped by URL parsers) could
  // smuggle a different URL past the checks above.
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i)
    if (code < 0x20 || code === 0x7f) return null
  }
  let url: URL
  try {
    url = new URL(value, 'http://n')
  } catch {
    return null
  }
  if (url.origin !== 'http://n' || isAuthPage(url.pathname)) return null
  return `${url.pathname}${url.search}${url.hash}`
}

type AuthState = 'signed-in' | 'signed-out' | 'unknown'

function hasAuthCookie(request: NextRequest): boolean {
  return request.cookies.getAll().some((c) => AUTH_COOKIE_RE.test(c.name))
}

function isTransientAuthError(error: unknown): boolean {
  if (isAuthRetryableFetchError(error)) return true
  const status = (error as { status?: unknown } | null)?.status
  return typeof status === 'number' && (status === 0 || status >= 500)
}

async function checkAuth(supabase: SupabaseClient, request: NextRequest): Promise<AuthState> {
  // Nothing to verify — skip the round trip.
  if (!hasAuthCookie(request)) return 'signed-out'
  try {
    // getClaims() verifies the JWT (locally via JWKS for asymmetric keys, via
    // the Auth server otherwise) and refreshes an expiring session first.
    const { data, error } = await supabase.auth.getClaims()
    if (data?.claims?.sub) return 'signed-in'
    if (error && isTransientAuthError(error)) return 'unknown'
    return 'signed-out'
  } catch {
    return 'unknown'
  }
}

/** Copies Set-Cookie values and no-cache headers from `from` onto `to`. */
function carryOver(from: NextResponse, to: NextResponse): NextResponse {
  for (const cookie of from.cookies.getAll()) to.cookies.set(cookie)
  for (const header of ['cache-control', 'expires', 'pragma']) {
    const value = from.headers.get(header)
    if (value !== null) to.headers.set(header, value)
  }
  return to
}

function redirectTo(request: NextRequest, target: string, from: NextResponse): NextResponse {
  const url = request.nextUrl.clone()
  const parsed = new URL(target, 'http://n')
  url.pathname = parsed.pathname
  url.search = parsed.search
  url.hash = ''
  return carryOver(from, NextResponse.redirect(url))
}

export async function updateSession(request: NextRequest): Promise<NextResponse> {
  const { pathname, search } = request.nextUrl
  const authPage = isAuthPage(pathname)

  // Public pages/APIs/assets: no auth work at all (keeps /offline, /privacy and
  // /api/keepalive working even when Supabase is down or not configured).
  if (isPublicPath(pathname) && !authPage) return NextResponse.next({ request })

  // Not configured: let the request through so the page can show a clear
  // configuration error instead of a redirect loop.
  if (!isSupabaseConfigured()) return NextResponse.next({ request })

  let response = NextResponse.next({ request })
  let state: AuthState
  try {
    const { supabaseUrl, supabaseKey } = getPublicEnv()
    const supabase = createServerClient(supabaseUrl, supabaseKey, {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet, headers) {
          // Update the request so Server Components in this request see the
          // refreshed session, then rebuild the response to carry the cookies.
          for (const { name, value } of cookiesToSet) request.cookies.set(name, value)
          response = NextResponse.next({ request })
          for (const { name, value, options } of cookiesToSet) response.cookies.set(name, value, options)
          for (const [key, value] of Object.entries(headers ?? {})) response.headers.set(key, value)
        },
      },
    })
    state = await checkAuth(supabase, request)
  } catch {
    state = hasAuthCookie(request) ? 'unknown' : 'signed-out'
  }

  if (authPage) {
    if (state !== 'signed-in') return response
    const next = safeNextPath(request.nextUrl.searchParams.get('next'))
    return redirectTo(request, next ?? HOME_PATH, response)
  }

  if (state === 'signed-out') {
    if (pathname.startsWith('/api/')) {
      return carryOver(response, NextResponse.json({ error: 'Please sign in.' }, { status: 401 }))
    }
    // Drop Next's internal RSC cache-busting param from the return path.
    const params = new URLSearchParams(search)
    params.delete('_rsc')
    const query = params.toString()
    const back = `${pathname}${query ? `?${query}` : ''}`
    const next = back === '/' ? '' : `?next=${encodeURIComponent(back)}`
    return redirectTo(request, `${LOGIN_PATH}${next}`, response)
  }

  return response
}
