'use client'

import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import PushToggle from '@/components/PushToggle'
import { getCurrentPushSubscription, getPushPermission, isPushSupported, needsInstallForPush } from '@/lib/push/client'

const DISMISS_KEY = 'shiftswap:alerts:push-banner-dismissed'

/**
 * Should the "alerts when the app is closed" banner show? Only when this device
 * could get push alerts but they aren't on (or the iPhone app needs installing).
 */
async function shouldOffer(): Promise<boolean> {
  try {
    if (localStorage.getItem(DISMISS_KEY) === '1') return false
  } catch {
    // Storage blocked: just offer it.
  }
  if (needsInstallForPush()) return true
  if (!isPushSupported() || !process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY) return false
  if (getPushPermission() !== 'granted') return true
  try {
    return !(await getCurrentPushSubscription())
  } catch {
    return false
  }
}

/** Compact prompt on /alerts to turn on push alerts for this device. */
export function PushBanner() {
  const [show, setShow] = useState(false)

  useEffect(() => {
    let cancelled = false
    void shouldOffer().then((offer) => {
      if (!cancelled) setShow(offer)
    })
    return () => {
      cancelled = true
    }
  }, [])

  if (!show) return null

  function dismiss() {
    try {
      localStorage.setItem(DISMISS_KEY, '1')
    } catch {
      // best effort: hidden for this visit only
    }
    setShow(false)
  }

  return (
    <section aria-labelledby="push-banner-title" className="rounded-2xl border border-accent-blue/25 bg-accent-blue/[0.06] p-2">
      <div className="flex items-center gap-2 pl-2">
        <h2 id="push-banner-title" className="min-w-0 flex-1 text-sm font-semibold text-fg">
          Get alerts even when the app is closed
        </h2>
        <button
          type="button"
          onClick={dismiss}
          aria-label="Hide this tip"
          className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-fg-dim hover:bg-white/[0.06] hover:text-fg"
        >
          <X size={18} aria-hidden="true" />
        </button>
      </div>
      <PushToggle />
    </section>
  )
}
