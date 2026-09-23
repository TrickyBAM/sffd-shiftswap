'use client'

import { useSyncExternalStore } from 'react'

const noopSubscribe = () => () => {}

/**
 * False during server rendering and hydration, true afterwards. Use it to gate things
 * that only exist in the browser (portals, window APIs) without hydration mismatches.
 */
export function useIsClient(): boolean {
  return useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false,
  )
}
