'use client'

import { useCallback, useEffect, useId, useState } from 'react'
import { BellRing, Share, X } from 'lucide-react'
import type { SupabaseClient } from '@supabase/supabase-js'
import { Button } from '@/components/ui/Button'
import { useToast } from '@/components/ui/Toast'
import { cn } from '@/components/ui/cn'
import {
  ALERTS_NUDGE_DISMISSED_KEY,
  getCurrentPushSubscription,
  getPushPermission,
  isIOS,
  isPushSupported,
  isStandalone,
  subscribeToPush,
} from '@/lib/push/client'
import { createClient } from '@/lib/supabase/client'

/**
 * What the nudge shows:
 *   hidden   alerts are on, blocked, impossible here, or the member said "Not now"
 *   install  iPhone/iPad in Safari: alerts only work in the installed app, so explain that first
 *   enable   alerts could work on this device but aren't on: offer "Turn on alerts"
 */
export type AlertsNudgeMode = 'hidden' | 'install' | 'enable'

function wasDismissed(): boolean {
  try {
    return window.localStorage.getItem(ALERTS_NUDGE_DISMISSED_KEY) === '1'
  } catch {
    // Storage blocked: show it (dismissing then hides it for this visit).
    return false
  }
}

function rememberDismissed(): void {
  try {
    window.localStorage.setItem(ALERTS_NUDGE_DISMISSED_KEY, '1')
  } catch {
    // Storage blocked: hidden for this visit only.
  }
}

/** Decides the nudge for this device. Never throws. */
export async function detectAlertsNudge(vapidPublicKey: string | null | undefined): Promise<AlertsNudgeMode> {
  if (typeof window === 'undefined' || wasDismissed()) return 'hidden'
  // iPhone only offers web push to the Home Screen app (iOS 16.4+).
  if (isIOS() && !isStandalone()) return 'install'
  if (!isPushSupported() || !vapidPublicKey) return 'hidden'
  const permission = getPushPermission()
  if (permission === 'denied') return 'hidden'
  if (permission !== 'granted') return 'enable'
  try {
    return (await getCurrentPushSubscription()) ? 'hidden' : 'enable'
  } catch {
    return 'hidden'
  }
}

export interface AlertsNudgeProps {
  /** Defaults to NEXT_PUBLIC_VAPID_PUBLIC_KEY. */
  vapidPublicKey?: string | null
  client?: SupabaseClient
  className?: string
}

/**
 * A dismissible "Turn on alerts" card for the home screen (UX-03). Shown only when
 * this device could get push alerts but they aren't on. On iPhone it offers the
 * switch only inside the installed app; in Safari it explains to add ShiftSwap to
 * the Home Screen first. "Not now" is remembered on this device (sign-out forgets it).
 */
export default function AlertsNudge({
  vapidPublicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY,
  client,
  className,
}: AlertsNudgeProps) {
  const toast = useToast()
  const [mode, setMode] = useState<AlertsNudgeMode>('hidden')
  const [busy, setBusy] = useState(false)
  const titleId = `alerts-nudge-${useId()}`

  const recheck = useCallback(() => {
    void detectAlertsNudge(vapidPublicKey).then(setMode)
  }, [vapidPublicKey])

  useEffect(() => {
    recheck()
    // Alerts may be turned on in Profile, or permission changed in Settings, meanwhile.
    const onVisibility = () => {
      if (document.visibilityState === 'visible') recheck()
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => document.removeEventListener('visibilitychange', onVisibility)
  }, [recheck])

  if (mode === 'hidden') return null

  function dismiss() {
    rememberDismissed()
    setMode('hidden')
  }

  async function turnOn() {
    if (busy) return
    let sb: SupabaseClient
    try {
      sb = client ?? createClient()
    } catch {
      toast.error("Couldn't reach ShiftSwap", 'Check your connection and try again.')
      return
    }
    setBusy(true)
    try {
      const result = await subscribeToPush(sb, vapidPublicKey)
      if (result.ok) {
        toast.success('Alerts are on for this device')
        setMode('hidden')
        return
      }
      if (result.reason === 'dismissed') return
      toast.error("Alerts aren't on", result.message)
      // Blocked or impossible here: stop asking. Profile ▸ Alerts explains what to do.
      if (result.reason === 'denied' || result.reason === 'unsupported') setMode('hidden')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section
      aria-labelledby={titleId}
      className={cn('rounded-2xl border border-accent-blue/25 bg-accent-blue/[0.06] p-4', className)}
    >
      <div className="flex items-start gap-3">
        <BellRing size={22} aria-hidden="true" className="mt-0.5 shrink-0 text-accent-blue" />
        <div className="min-w-0 flex-1">
          <h2 id={titleId} className="font-semibold text-fg">
            {mode === 'install' ? 'Get ShiftSwap alerts on your iPhone' : 'Turn on alerts'}
          </h2>
          {mode === 'install' ? (
            <p className="mt-1 text-sm text-fg-muted">
              iPhone only sends alerts to the installed app. Tap Share{' '}
              <Share size={15} aria-hidden="true" className="inline align-[-2px] text-fg" />, then{' '}
              <span className="text-fg">Add to Home Screen</span>. Open ShiftSwap from the new icon and turn alerts on
              there.
            </p>
          ) : (
            <p className="mt-1 text-sm text-fg-muted">
              Get a buzz on this device when someone asks for your shift, confirms a trade or sends you a message.
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={dismiss}
          aria-label="Hide this tip"
          className="-mr-2 -mt-2 inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-fg-dim hover:bg-white/[0.06] hover:text-fg"
        >
          <X size={18} aria-hidden="true" />
        </button>
      </div>
      {mode === 'enable' ? (
        <div className="mt-3 flex flex-wrap gap-2 pl-[34px]">
          <Button size="sm" onClick={turnOn} loading={busy} icon={<BellRing size={16} aria-hidden="true" />}>
            Turn on alerts
          </Button>
          <Button size="sm" variant="ghost" onClick={dismiss}>
            Not now
          </Button>
        </div>
      ) : null}
    </section>
  )
}

export { AlertsNudge }
