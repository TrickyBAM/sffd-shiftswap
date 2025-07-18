import type { NextConfig } from 'next'

/**
 * Global Next.js configuration for the SFFD ShiftSwap application.
 *
 * We opt into the experimental `authInterrupts` API introduced in
 * Next.js 15.1, which allows us to customize the behaviour of
 * forbidden/unauthorized responses in the App Router. See the
 * Next.js release notes for more details【426253857038578†L210-L247】.
 */
const nextConfig: NextConfig = {
  experimental: {
    authInterrupts: true,
  },
  eslint: {
    // Limit ESLint checks to our source folders to improve performance.
    dirs: ['app', 'components', 'lib', 'types'],
  },
}

export default nextConfig