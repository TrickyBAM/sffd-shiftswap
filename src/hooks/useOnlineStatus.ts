'use client'

import { useSyncExternalStore } from 'react'

function subscribe(onChange: () => void) {
  window.addEventListener('online', onChange)
  window.addEventListener('offline', onChange)
  return () => {
    window.removeEventListener('online', onChange)
    window.removeEventListener('offline', onChange)
  }
}

/**
 * navigator.onLine as React state. Assumes online on the server and during hydration.
 *
 * `true` only means the device has a network interface, not that Supabase is reachable;
 * data views should still treat a failed fetch as "offline" and show their snapshot.
 */
export function useOnlineStatus(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => navigator.onLine,
    () => true,
  )
}
