import type { Config } from 'tailwindcss'
import { fontFamily } from 'tailwindcss/defaultTheme'

/**
 * Tailwind CSS configuration.
 *
 * This project targets Tailwind 4.1, which introduces new utilities
 * like text-shadow, mask-image and improved browser compatibility【893375231563547†L23-L47】.  We don't
 * enable any of those by default here, but the configuration is ready
 * should they be needed.  See the Tailwind release notes for a
 * description of the new utilities【893375231563547†L23-L47】.
 */
const config: Config = {
  content: [
    './app/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
    './lib/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['var(--font-sans)', ...fontFamily.sans],
      },
    },
  },
  plugins: [],
}

export default config