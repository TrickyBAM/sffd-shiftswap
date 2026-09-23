'use client'

import { useCallback, useEffect, useId, useState } from 'react'
import { BellOff, BellRing } from 'lucide-react'
import type { SupabaseClient } from '@supabase/supabase-js'
import { useToast } from '@/components/ui/Toast'
import { Spinner } from '@/components/ui/Spinner'
import { cn } from '@/components/ui/cn'
import { createClient } from '@/lib/supabase/client'
import {
  getCurrentPushSubscription,
  getPushPermission,
  isPushSupported,
  needsInstallForPush,
  resyncPushSubscription,
  subscribeToPush,
  unsubscribeFromPush,
} from '@/lib/push/client'

type PushState = 'checking' | 'unsupported' | 'needs-install' | 'no-key' | 'blocked' | 'on' | 'off'

const STATUS_TEXT: Record<PushState, string> = {
  checking: 'Checking this device…',
  unsupported: "This browser can't show alerts. Try Chrome on Android, or install the app on iPhone.",
  'needs-install':
    'On iPhone, alerts only work in the installed app: tap Share, then Add to Home Screen, open ShiftSwap from the new icon and turn alerts on there.',
  'no-key': "Alerts aren't set up on the server yet. Ask an admin.",
  blocked:
    'Notifications are blocked for ShiftSwap. Allow them in your phone or browser settings, then come back here.',
  on: "On — you'll get alerts on this device.",
  off: 'Off — turn on to get trade and new-shift alerts on this device.',
}

async function detectState(vapidKey: string | null | undefined): Promise<PushState> {
  if (needsInstallForPush()) return 'needs-install'
  if (!isPushSupported()) return 'unsupported'
  if (!vapidKey) return 'no-key'
  const permission = getPushPermission()
  if (permission === 'denied') return 'blocked'
  if (permission !== 'granted') return 'off'
  try {
    return (await getCurrentPushSubscription()) ? 'on' : 'off'
  } catch {
    return 'off'
  }
}

function getClient(client: SupabaseClient | undefined): SupabaseClient | null {
  try {
    return client ?? createClient()
  } catch {
    return null
  }
}

export interface PushToggleProps {
  /** Defaults to NEXT_PUBLIC_VAPID_PUBLIC_KEY. */
  vapidPublicKey?: string | null
  client?: SupabaseClient
  className?: string
}

/**
 * Enable/disable push alerts on this device, with a clear state for every case:
 * unsupported browser, iPhone not installed yet, blocked, on, off.
 */
export default function PushToggle({
  vapidPublicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY,
  client,
  className,
}: PushToggleProps) {
  const toast = useToast()
  const [state, setState] = useState<PushState>('checking')
  const [busy, setBusy] = useState(false)
  const id = useId()
  const titleId = `push-${id}-title`
  const statusId = `push-${id}-status`

  const recheck = useCallback(() => {
    void detectState(vapidPublicKey).then((next) => {
      setState(next)
      if (next === 'on') {
        // Quietly re-save the subscription in case the server pruned or the browser rotated it.
        const sb = getClient(client)
        if (sb) void resyncPushSubscription(sb)
      }
    })
  }, [vapidPublicKey, client])

  useEffect(() => {
    recheck()
    // Permission may be changed in system settings while the app is in the background.
    const onVisibility = () => {
      if (document.visibilityState === 'visible') recheck()
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => document.removeEventListener('visibilitychange', onVisibility)
  }, [recheck])

  async function toggle() {
    if (busy) return
    const sb = getClient(client)
    if (!sb) {
      toast.error("Couldn't reach ShiftSwap", 'Check your connection and try again.')
      return
    }
    setBusy(true)
    try {
      if (state === 'on') {
        const ok = await unsubscribeFromPush(sb)
        if (ok) toast.success('Alerts are off on this device')
        else toast.error("Couldn't turn off alerts", 'Check your connection and try again.')
      } else {
        const result = await subscribeToPush(sb, vapidPublicKey)
        if (result.ok) toast.success('Alerts are on for this device')
        else if (result.reason !== 'dismissed') toast.error("Alerts aren't on", result.message)
      }
    } finally {
      setBusy(false)
      recheck()
    }
  }

  const on = state === 'on'
  const actionable = state === 'on' || state === 'off'
  const Icon = on ? BellRing : BellOff

  return (
    <div className={cn('flex items-start gap-3 rounded-2xl border border-line bg-card p-4', className)}>
      <Icon
        size={22}
        aria-hidden="true"
        className={cn('mt-0.5 shrink-0', on ? 'text-accent-green' : 'text-fg-dim')}
      />
      <div className="min-w-0 flex-1">
        <p id={titleId} className="font-semibold text-fg">
          Alerts on this device
        </p>
        <p id={statusId} className="mt-0.5 text-sm text-fg-muted" aria-live="polite">
          {STATUS_TEXT[state]}
        </p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-labelledby={titleId}
        aria-describedby={statusId}
        aria-busy={busy || state === 'checking' || undefined}
        disabled={!actionable || busy}
        onClick={toggle}
        className={cn(
          'relative inline-flex h-11 w-[68px] shrink-0 items-center rounded-full p-1.5 transition-colors',
          'disabled:cursor-not-allowed disabled:opacity-50',
          on ? 'bg-accent-green' : 'bg-raised ring-1 ring-inset ring-line-strong',
        )}
      >
        <span
          aria-hidden="true"
          className={cn(
            'flex h-8 w-8 items-center justify-center rounded-full bg-white shadow transition-transform',
            on ? 'translate-x-6' : 'translate-x-0',
          )}
        >
          {busy || state === 'checking' ? <Spinner size="sm" className="text-surface" /> : null}
        </span>
      </button>
    </div>
  )
}
