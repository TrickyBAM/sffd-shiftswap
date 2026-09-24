'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Pencil, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { buttonClasses } from '@/components/ui/button-styles'
import { formatTimePT } from '@/lib/sffd/dates'
import type { Profile } from '@/lib/types/database'
import { OnboardHeader } from '../../_components/OnboardHeader'
import { SignOutButton } from '../../_components/SignOutButton'
import { DetailsSummary } from './DetailsSummary'
import { StatusMessage } from './StatusMessage'
import { usePendingPoll } from './usePendingPoll'

const TITLES: Record<string, string> = {
  pending: 'Waiting for approval',
  rejected: 'Not approved',
  suspended: 'Account paused',
}

export interface PendingViewProps {
  initialProfile: Profile
}

export function PendingView({ initialProfile }: PendingViewProps) {
  const { profile, checking, leaving, lastChecked, error, checkNow } = usePendingPoll(initialProfile)
  const [stillWaiting, setStillWaiting] = useState(false)
  const pending = profile.status === 'pending'

  async function onCheck() {
    setStillWaiting(false)
    const unchanged = await checkNow()
    setStillWaiting(unchanged)
  }

  return (
    <>
      <OnboardHeader title={TITLES[profile.status] ?? 'Account status'} />
      <div className="mx-auto w-full max-w-xl space-y-4 px-4 py-6">
        <StatusMessage profile={profile} />

        {pending ? <DetailsSummary profile={profile} /> : null}

        <div className="space-y-3">
          {pending ? (
            <Link
              href="/onboarding"
              className={buttonClasses({ variant: 'secondary', size: 'lg', fullWidth: true })}
            >
              <Pencil size={18} aria-hidden="true" />
              Edit my details
            </Link>
          ) : null}
          <Button
            variant={pending ? 'ghost' : 'secondary'}
            size="lg"
            fullWidth
            loading={checking || leaving}
            icon={<RefreshCw size={18} aria-hidden="true" />}
            onClick={onCheck}
          >
            {leaving ? 'Opening ShiftSwap…' : 'Check again'}
          </Button>
          <SignOutButton size="lg" fullWidth />
        </div>

        <p aria-live="polite" className="min-h-5 text-center text-sm text-fg-dim">
          {error ? (
            <span className="text-sffd-red-text">{error}</span>
          ) : stillWaiting ? (
            'No change yet. This page checks again by itself every 20 seconds.'
          ) : lastChecked ? (
            `Last checked ${formatTimePT(lastChecked)}`
          ) : pending ? (
            'This page checks for your approval by itself.'
          ) : null}
        </p>
      </div>
    </>
  )
}
