'use client'

import { useEffect } from 'react'

export default function PWARegister() {
  useEffect(() => {
    if (
      process.env.NODE_ENV !== 'production' ||
      typeof window === 'undefined' ||
      !('serviceWorker' in navigator)
    ) {
      return
    }

    navigator.serviceWorker
      .register('/sw.js', { scope: '/', updateViaCache: 'none' })
      .catch(() => {
        // Registration failing (old browser, private mode) never blocks the app.
      })
  }, [])

  return null
}
