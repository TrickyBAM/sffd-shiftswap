// Where to go after logging in. Mirrors safeNextPath() in
// src/lib/supabase/session.ts, which the browser can't import (it pulls in
// next/server): only same-site paths, never the auth pages themselves.

export const HOME_PATH = '/calendar'

const AUTH_PAGES = ['/login', '/signup']

function isAuthPage(pathname: string): boolean {
  return AUTH_PAGES.some((page) => pathname === page || pathname.startsWith(`${page}/`))
}

/**
 * Returns `value` when it's a relative path on this site that's safe to
 * redirect to, otherwise null. Rejects absolute and protocol-relative URLs,
 * backslash and control-character tricks, and /login or /signup (loops).
 */
export function safeNextPath(value: string | null | undefined): string | null {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//') || value.includes('\\')) {
    return null
  }
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

/** The first `next` value from a page's searchParams, made safe. */
export function nextFromSearchParam(value: string | string[] | undefined): string | null {
  return safeNextPath(Array.isArray(value) ? value[0] : value)
}
