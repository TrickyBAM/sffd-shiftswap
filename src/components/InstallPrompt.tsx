'use client'

import { useState } from 'react'
import { CheckCircle2, Download, Share, Smartphone } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { cn } from '@/components/ui/cn'
import { useInstallPrompt } from '@/hooks/useInstallPrompt'
import { useIsClient } from '@/hooks/useIsClient'
import { isIOS, isStandalone } from '@/lib/push/client'

export interface InstallPromptProps {
  /** Show "ShiftSwap is installed" when already running as the app (default: render nothing). */
  showWhenInstalled?: boolean
  className?: string
}

/**
 * "Install the app" card:
 * - Android/desktop Chromium: an Install button (uses the captured beforeinstallprompt).
 * - iPhone/iPad: Share → Add to Home Screen instructions, noting that iPhone alerts
 *   only work from the installed app.
 * - Other browsers: a short hint to use the browser menu.
 */
export default function InstallPrompt({ showWhenInstalled = false, className }: InstallPromptProps) {
  const isClient = useIsClient()
  const { canPrompt, installed, promptInstall } = useInstallPrompt()
  const [dismissedPrompt, setDismissedPrompt] = useState(false)

  // Platform checks need the browser; render nothing on the server to avoid mismatches.
  if (!isClient) return null

  const frame = cn('rounded-2xl border border-line bg-card p-4', className)

  if (isStandalone() || installed) {
    if (!showWhenInstalled && !installed) return null
    return (
      <div role="status" className={cn(frame, 'flex items-center gap-3')}>
        <CheckCircle2 size={22} aria-hidden="true" className="shrink-0 text-accent-green" />
        <p className="text-sm text-fg">
          {installed && !isStandalone()
            ? 'Installed! Open ShiftSwap from your home screen.'
            : 'ShiftSwap is installed on this device.'}
        </p>
      </div>
    )
  }

  if (isIOS()) {
    return (
      <div className={frame}>
        <div className="flex items-start gap-3">
          <Smartphone size={22} aria-hidden="true" className="mt-0.5 shrink-0 text-accent-blue" />
          <div className="min-w-0">
            <p className="font-semibold text-fg">Add ShiftSwap to your Home Screen</p>
            <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm text-fg-muted">
              <li>
                Tap Share <Share size={15} aria-hidden="true" className="inline align-[-2px] text-fg" /> (the
                square with an arrow). In newer Safari it&apos;s under the ••• button.
              </li>
              <li>Tap Add to Home Screen, then Add.</li>
              <li>Open ShiftSwap from the new icon.</li>
            </ol>
            <p className="mt-3 text-sm text-fg-dim">
              iPhone alerts only work in the installed app, so do this before turning on alerts.
            </p>
          </div>
        </div>
      </div>
    )
  }

  if (canPrompt && !dismissedPrompt) {
    return (
      <div className={cn(frame, 'flex flex-wrap items-center gap-3')}>
        <Download size={22} aria-hidden="true" className="shrink-0 text-accent-blue" />
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-fg">Install the app</p>
          <p className="text-sm text-fg-muted">Opens full screen from your home screen, with alerts.</p>
        </div>
        <Button
          size="sm"
          onClick={async () => {
            const outcome = await promptInstall()
            if (outcome !== 'accepted') setDismissedPrompt(true)
          }}
        >
          Install
        </Button>
      </div>
    )
  }

  return (
    <div className={cn(frame, 'flex items-start gap-3')}>
      <Download size={22} aria-hidden="true" className="mt-0.5 shrink-0 text-fg-dim" />
      <p className="text-sm text-fg-muted">
        To install ShiftSwap, open your browser menu and choose <span className="text-fg">Install app</span> or{' '}
        <span className="text-fg">Add to Home screen</span>.
      </p>
    </div>
  )
}
