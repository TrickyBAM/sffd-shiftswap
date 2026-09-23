'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useToast } from '@/components/ui/Toast'
import { captureInstallPrompt } from '@/hooks/useInstallPrompt'
import { resyncPushSubscription } from '@/lib/push/client'
import { createClient } from '@/lib/supabase/client'

/**
 * Registers the service worker (production builds only) and handles updates:
 * when a new worker is waiting, shows a "New version available" toast whose Reload
 * action tells it to SKIP_WAITING and reloads once it takes control.
 *
 * The script URL carries the deployment version (`/sw.js?v=<commit>`), so every deploy
 * installs a fresh worker that re-caches the offline page for that build.
 */
export default function PWARegister() {
  const toast = useToast()
  const router = useRouter()

  // Start listening for Android's install prompt as early as possible.
  useEffect(() => {
    captureInstallPrompt()
  }, [])

  useEffect(() => {
    if (process.env.NODE_ENV !== 'production' || !('serviceWorker' in navigator)) return
    const sw = navigator.serviceWorker

    let disposed = false
    let registration: ServiceWorkerRegistration | undefined
    let updateRequested = false
    let reloading = false

    const reloadOnce = () => {
      if (reloading) return
      reloading = true
      window.location.reload()
    }

    const offerUpdate = (worker: ServiceWorker) => {
      if (disposed) return
      toast.show({
        id: 'sw-update',
        tone: 'info',
        title: 'New version available',
        description: 'Reload to get the latest ShiftSwap.',
        action: {
          label: 'Reload',
          onClick: () => {
            updateRequested = true
            worker.postMessage({ type: 'SKIP_WAITING' })
            // If the worker was already replaced or never takes over, reload anyway.
            setTimeout(reloadOnce, 4000)
          },
        },
      })
    }

    // Only reload when the user asked for the update; the very first install also
    // fires controllerchange (clients.claim) and must not reload the page.
    const onControllerChange = () => {
      if (updateRequested) reloadOnce()
    }

    const resyncPush = () => {
      try {
        void resyncPushSubscription(createClient())
      } catch {
        // Supabase not configured: nothing to sync.
      }
    }

    const onMessage = (event: MessageEvent) => {
      const data: unknown = event.data
      if (!data || typeof data !== 'object') return
      const { type, url } = data as { type?: unknown; url?: unknown }
      // The browser rotated the push subscription: store the new one.
      if (type === 'PUSH_SUBSCRIPTION_CHANGED') {
        resyncPush()
        return
      }
      // Fallback path for notification taps when the worker can't navigate the window.
      if (type !== 'NAVIGATE' || typeof url !== 'string') return
      const target = new URL(url, window.location.origin)
      if (target.origin === window.location.origin) router.push(`${target.pathname}${target.search}${target.hash}`)
    }

    const watch = (reg: ServiceWorkerRegistration) => {
      if (reg.waiting && sw.controller) offerUpdate(reg.waiting)
      reg.addEventListener('updatefound', () => {
        const installing = reg.installing
        if (!installing) return
        installing.addEventListener('statechange', () => {
          // "installed" with an existing controller = an update is waiting.
          if (installing.state === 'installed' && sw.controller) offerUpdate(installing)
        })
      })
    }

    // Long-lived installed apps rarely navigate; check for a new deploy when reopened.
    const onVisibility = () => {
      if (document.visibilityState === 'visible') registration?.update().catch(() => {})
    }

    sw.addEventListener('controllerchange', onControllerChange)
    sw.addEventListener('message', onMessage)
    document.addEventListener('visibilitychange', onVisibility)

    const version = process.env.NEXT_PUBLIC_APP_VERSION
    const scriptUrl = version ? `/sw.js?v=${encodeURIComponent(version)}` : '/sw.js'
    sw.register(scriptUrl, { scope: '/', updateViaCache: 'none' })
      .then((reg) => {
        if (disposed) return
        registration = reg
        watch(reg)
        // Re-save this device's push subscription in case the server pruned it.
        // No-op when alerts are off or nobody is signed in.
        resyncPush()
      })
      .catch(() => {
        // Registration failing (old browser, private mode) never blocks the app.
      })

    return () => {
      disposed = true
      sw.removeEventListener('controllerchange', onControllerChange)
      sw.removeEventListener('message', onMessage)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [toast, router])

  return null
}
