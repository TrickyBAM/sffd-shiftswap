'use client' // Error boundaries must be Client Components

import { useEffect } from 'react'
import './globals.css'

/**
 * Last-resort fallback when the root layout itself fails. It replaces the whole document,
 * so it renders its own <html>/<body>, imports the global styles, and uses inline styles
 * for the essentials in case the stylesheet can't load. No providers are available here.
 */
export default function GlobalError({
  error,
  retry,
}: {
  error: Error & { digest?: string }
  retry: () => void
}) {
  useEffect(() => {
    console.error(error)
  }, [error])

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: '100dvh',
          background: '#0a0a0f',
          color: '#F0F0F5',
          fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
        }}
      >
        <title>Something went wrong · ShiftSwap</title>
        <main
          id="main"
          style={{
            minHeight: '100dvh',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 'calc(env(safe-area-inset-top) + 16px) 16px calc(env(safe-area-inset-bottom) + 16px)',
            boxSizing: 'border-box',
          }}
        >
          <div role="alert" style={{ maxWidth: 360, width: '100%', textAlign: 'center' }}>
            <h1 style={{ fontSize: 28, fontWeight: 700, margin: '0 0 8px' }}>Something went wrong</h1>
            <p style={{ color: '#A3A3B8', fontSize: 15, lineHeight: 1.5, margin: '0 0 28px' }}>
              ShiftSwap couldn&apos;t load. Check your connection and try again.
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <button
                type="button"
                onClick={() => retry()}
                style={{
                  minHeight: 52,
                  border: 0,
                  borderRadius: 12,
                  background: '#D32F2F',
                  color: '#fff',
                  fontSize: 16,
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                Try again
              </button>
              {/* A plain <a> (full page load) — the router may be what failed. */}
              <a
                href="/calendar"
                style={{
                  minHeight: 52,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  borderRadius: 12,
                  border: '1px solid rgba(255,255,255,0.12)',
                  background: '#1a1a26',
                  color: '#F0F0F5',
                  fontSize: 16,
                  fontWeight: 600,
                  textDecoration: 'none',
                }}
              >
                Go home
              </a>
            </div>
            {error.digest ? (
              <p style={{ color: '#8A8AA3', fontSize: 12, marginTop: 24 }}>Reference: {error.digest}</p>
            ) : null}
          </div>
        </main>
      </body>
    </html>
  )
}
