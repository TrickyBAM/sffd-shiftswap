import { NextResponse, type NextRequest } from 'next/server'
import { updateSession } from '@/lib/supabase/session'

// Old URLs that installed PWAs and bookmarks may still open (ARCHITECTURE §7.1).
const LEGACY_REDIRECTS: Readonly<Record<string, string>> = {
  '/dashboard': '/calendar',
  '/shift-board': '/board',
  '/post-shift': '/post',
  '/notifications': '/alerts',
  '/schedule-setup': '/profile',
}

export async function proxy(request: NextRequest) {
  const pathname = request.nextUrl.pathname.replace(/\/+$/, '') || '/'
  const legacyTarget = LEGACY_REDIRECTS[pathname]
  if (legacyTarget) {
    return NextResponse.redirect(new URL(`${legacyTarget}${request.nextUrl.search}`, request.url), 307)
  }
  return await updateSession(request)
}

export const config = {
  matcher: [
    // Everything except Next internals, the service worker, the manifest,
    // icons and other static files.
    '/((?!_next/static|_next/image|favicon.ico|sw.js|manifest.webmanifest|icons/|apple-icon.png|.*\\.(?:svg|png|jpg|jpeg|gif|webp|avif|ico|txt|xml|js|css|map|woff|woff2|webmanifest)$).*)',
  ],
}
