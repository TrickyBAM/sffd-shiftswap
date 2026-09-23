'use client'

import { useEffect } from 'react'
import { RotateCw } from 'lucide-react'
import { Button } from '@/components/ui/Button'

/**
 * The service worker serves /offline in place of any page that fails to load, so the
 * address bar usually still shows the page the user wanted: reloading retries it.
 * When the connection comes back we retry automatically.
 */
function retry() {
  if (window.location.pathname === '/offline') {
    // Deliberately a full page load (not router.push): the client router may be stale offline.
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.assign('/calendar')
  } else {
    window.location.reload()
  }
}

export default function RetryButton() {
  useEffect(() => {
    window.addEventListener('online', retry)
    return () => window.removeEventListener('online', retry)
  }, [])

  return (
    <Button size="lg" fullWidth onClick={retry} icon={<RotateCw size={18} aria-hidden="true" />}>
      Try again
    </Button>
  )
}
