'use client'

import { useState } from 'react'
import { Info } from 'lucide-react'
import { useAdmin } from '../../_components/AdminProvider'
import { RosterImport } from './RosterImport'
import { RosterList } from './RosterList'

/** /admin/roster — how auto-approval works, the upload, and the current roster. */
export function RosterView() {
  const { refreshOverview } = useAdmin()
  const [version, setVersion] = useState(0)

  return (
    <div className="space-y-8">
      <p className="flex gap-3 rounded-2xl border border-accent-blue/25 bg-accent-blue/[0.06] p-4 text-sm text-fg-muted">
        <Info size={18} aria-hidden="true" className="mt-0.5 shrink-0 text-accent-blue" />
        <span>
          Members who sign up and match an unclaimed roster entry (name plus at least two details such as employee ID,
          rank, station, tour) are approved automatically. Everyone else waits for an admin on the Approvals tab.
        </span>
      </p>

      <RosterImport
        onImported={() => {
          setVersion((v) => v + 1)
          void refreshOverview()
        }}
      />

      <RosterList version={version} onChanged={() => void refreshOverview()} />
    </div>
  )
}
