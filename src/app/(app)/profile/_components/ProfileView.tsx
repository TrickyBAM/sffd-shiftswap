'use client'

import { useState } from 'react'
import { AccountSection } from './AccountSection'
import { AlertsSection } from './AlertsSection'
import { CalendarSection } from './CalendarSection'
import { EditDetailsSheet } from './EditDetailsSheet'
import { IdentityCard } from './IdentityCard'
import { ScopeSheet } from './ScopeSheet'
import { StatsSection } from './StatsSection'

type OpenSheet = 'details' | 'scope' | null

/** The Profile page body: identity, stats, alerts, calendar feed and account. */
export function ProfileView() {
  const [sheet, setSheet] = useState<OpenSheet>(null)
  const close = () => setSheet(null)

  return (
    <div className="space-y-8">
      <IdentityCard onEdit={() => setSheet('details')} />
      <StatsSection />
      <AlertsSection onChangeScope={() => setSheet('scope')} />
      <CalendarSection />
      <AccountSection />
      {sheet === 'details' ? <EditDetailsSheet onClose={close} /> : null}
      {/* Just the alert choice, not the whole details form (UX-07). */}
      {sheet === 'scope' ? <ScopeSheet onClose={close} /> : null}
    </div>
  )
}
