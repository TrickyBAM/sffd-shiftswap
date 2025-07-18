import type { ReactNode } from 'react'
import './globals.css'

/**
 * Root layout for the entire application.
 *
 * This component wraps all pages and ensures global styles and
 * metadata are applied consistently.  We set a neutral background
 * colour and base text colour.  Additional providers (such as
 * authentication or theme providers) can be added here in the
 * future.
 */
export const metadata = {
  title: 'SFFD ShiftSwap',
  description: 'Shift trading app for the San Francisco Fire Department',
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-gray-50 text-gray-900">
        {children}
      </body>
    </html>
  )
}