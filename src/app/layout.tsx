import type { Metadata, Viewport } from 'next'
import { Bebas_Neue, DM_Sans } from 'next/font/google'
import PWARegister from '@/components/PWARegister'
import { ToastProvider } from '@/components/ui/Toast'
import './globals.css'

// next/font downloads these at build time and serves them from our own origin
// (no request to Google from the browser; CSP font-src 'self' is enough).
const bebasNeue = Bebas_Neue({
  subsets: ['latin'],
  weight: '400',
  display: 'swap',
  variable: '--font-bebas-neue',
})

const dmSans = DM_Sans({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-dm-sans',
})

export const metadata: Metadata = {
  title: {
    default: 'ShiftSwap',
    template: '%s · ShiftSwap',
  },
  applicationName: 'ShiftSwap',
  description:
    'Trade shifts with other SFFD members. An unofficial tool made by members — TeleStaff remains the official record.',
  // Private tool: keep it out of search engines (also sent as X-Robots-Tag and robots.txt).
  robots: {
    index: false,
    follow: false,
    nocache: true,
    googleBot: { index: false, follow: false },
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'ShiftSwap',
  },
  // Don't let iOS turn dates and station numbers into phone links; we add tel: links ourselves.
  formatDetection: {
    telephone: false,
    email: false,
    address: false,
  },
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // Lets content extend under the notch/home indicator; layouts pad with env(safe-area-inset-*).
  viewportFit: 'cover',
  themeColor: '#0a0a0f',
  colorScheme: 'dark',
  // No maximumScale/userScalable: people must be able to pinch-zoom (WCAG 1.4.4).
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${dmSans.variable} ${bebasNeue.variable}`}>
      <body className="min-h-dvh bg-surface font-sans text-fg antialiased">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-[calc(var(--safe-top)+0.75rem)] focus:z-[100] focus:rounded-xl focus:bg-elevated focus:px-4 focus:py-3 focus:text-sm focus:font-semibold focus:text-fg"
        >
          Skip to content
        </a>
        <ToastProvider>
          {children}
          <PWARegister />
        </ToastProvider>
      </body>
    </html>
  )
}
