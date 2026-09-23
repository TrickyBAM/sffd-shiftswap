import type { NextRequest } from 'next/server'
import { updateSession } from '@/lib/supabase/session'

// Refreshes the Supabase session and bounces signed-out visitors (ARCHITECTURE §9).
// Legacy URL redirects live only in next.config.ts `redirects()`, which Next runs
// before the proxy.
export async function proxy(request: NextRequest) {
  return await updateSession(request)
}

export const config = {
  matcher: [
    // Everything except Next internals, the service worker, the manifest,
    // icons and other static files.
    '/((?!_next/static|_next/image|favicon.ico|sw.js|manifest.webmanifest|icons/|apple-icon.png|.*\\.(?:svg|png|jpg|jpeg|gif|webp|avif|ico|txt|xml|js|css|map|woff|woff2|webmanifest)$).*)',
  ],
}
