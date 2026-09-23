'use client'

import { useCallback, useEffect, useEffectEvent, useRef } from 'react'
import { createRefreshThrottle, type RefreshScope, type RefreshThrottle } from './live-refresh'

function pageHidden(): boolean {
  return typeof document !== 'undefined' && document.visibilityState === 'hidden'
}

/**
 * Returns a stable `request(scope)` that runs `run(scope)` through the live
 * reload throttle (live-refresh.ts): merged, spaced out and paused while the
 * page is hidden.
 */
export function useLiveRefresh(run: (scope: RefreshScope) => void): (scope: RefreshScope) => void {
  const onRun = useEffectEvent((scope: RefreshScope) => run(scope))
  const throttle = useRef<RefreshThrottle | null>(null)

  useEffect(() => {
    const t = createRefreshThrottle({ run: (scope) => onRun(scope), isHidden: pageHidden })
    throttle.current = t
    const onVisibility = () => {
      if (!pageHidden()) t.resume()
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      t.dispose()
      throttle.current = null
    }
  }, [])

  return useCallback((scope: RefreshScope) => {
    throttle.current?.request(scope)
  }, [])
}
