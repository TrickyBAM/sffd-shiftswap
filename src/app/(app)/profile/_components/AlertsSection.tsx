'use client'

import { BellPlus } from 'lucide-react'
import { Button } from '@/components/ui'
import InstallPrompt from '@/components/InstallPrompt'
import PushToggle from '@/components/PushToggle'
import { useProfile } from '@/components/providers/ProfileProvider'
import { notifyScopeDescription, notifyScopeLabel } from './profile-model'
import { ProfileSection } from './ProfileSection'

/** Push alerts on this device, the new-shift alert scope and installing the app. */
export function AlertsSection({ onChangeScope }: { onChangeScope: () => void }) {
  const { profile } = useProfile()
  return (
    <ProfileSection id="profile-alerts" title="Alerts">
      <PushToggle />

      <div className="flex items-start gap-3 rounded-2xl border border-line bg-card p-4">
        <BellPlus size={22} aria-hidden="true" className="mt-0.5 shrink-0 text-accent-blue" />
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-fg">New-shift alerts: {notifyScopeLabel(profile.notify_scope)}</p>
          <p className="mt-0.5 text-sm text-fg-muted">{notifyScopeDescription(profile.notify_scope, profile.station)}</p>
        </div>
        <Button variant="secondary" size="sm" onClick={onChangeScope} aria-label="Change new-shift alerts">
          Change
        </Button>
      </div>

      <InstallPrompt showWhenInstalled />
    </ProfileSection>
  )
}
