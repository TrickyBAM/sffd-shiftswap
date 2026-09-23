'use client'

import { useState } from 'react'
import { AccountSection } from './AccountSection'
import { AlertsSection } from './AlertsSection'
import { CalendarSection } from './CalendarSection'
import { EditDetailsSheet } from './EditDetailsSheet'
import { IdentityCard } from './IdentityCard'
import { StatsSection } from './StatsSection'

/** The Profile page body: identity, stats, alerts, calendar feed and account. */
export function ProfileView() {
  const [editing, setEditing] = useState(false)
  const openEditor = () => setEditing(true)

  return (
    <div className="space-y-8">
      <IdentityCard onEdit={openEditor} />
      <StatsSection />
      <AlertsSection onChangeScope={openEditor} />
      <CalendarSection />
      <AccountSection />
      {editing ? <EditDetailsSheet onClose={() => setEditing(false)} /> : null}
    </div>
  )
}
