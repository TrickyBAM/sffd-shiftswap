'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useToast } from '@/components/ui/Toast'
import { captureInstallPrompt } from '@/hooks/useInstallPrompt'
import { createDeployCheck, isUpdateForRunningPage, workerScriptUrl } from '@/lib/pwa/update-check'
import { resyncPushSubscription } from '@/lib/push/client'
import { createClient } from '@/lib/supabase/client'

/**
 * Registers the service worker (production builds only) and handles updates:
 * when a new worker is waiting, shows a "New version available" toast whose Reload
 * action tells it to SKIP_WAITING and reloads once it takes control.
 *
 * The script URL carries the deployment version (`/sw.js?v=<commit>`), so every deploy
 * installs a fresh worker that re-caches the offline page for that build. When the app
 * comes back to the foreground (at most once a minute) it asks the server which version
 * is deployed and registers the new worker if this page is behind (see
 * src/lib/pwa/update-check.ts). A waiting worker for the build this page already runs
 * takes over quietly, without a reload prompt.
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

    const runningVersion = process.env.NEXT_PUBLIC_APP_VERSION

    const offerUpdate = (worker: ServiceWorker) => {
      if (disposed) return
      if (!isUpdateForRunningPage(worker, runningVersion)) {
        // This page was loaded from the new deploy already: nothing to reload for.
        worker.postMessage({ type: 'SKIP_WAITING' })
        return
      }
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

    // Long-lived installed apps rarely navigate: check for a new deploy when the app
    // comes back to the foreground (throttled), and re-offer an update still waiting.
    const checkForDeploy = createDeployCheck({
      runningVersion,
      getRegistration: () => registration,
      register: (url) => sw.register(url, { scope: '/', updateViaCache: 'none' }),
    })
    const onResume = () => {
      if (document.visibilityState !== 'visible') return
      void checkForDeploy().then((outcome) => {
        // A dismissed update that is still waiting is offered again (once a minute at most).
        if (outcome !== 'skipped' && registration?.waiting && sw.controller) offerUpdate(registration.waiting)
      })
    }

    sw.addEventListener('controllerchange', onControllerChange)
    sw.addEventListener('message', onMessage)
    document.addEventListener('visibilitychange', onResume)
    window.addEventListener('focus', onResume)

    sw.register(workerScriptUrl(runningVersion), { scope: '/', updateViaCache: 'none' })
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
      document.removeEventListener('visibilitychange', onResume)
      window.removeEventListener('focus', onResume)
    }
  }, [toast, router])

  return null
}
