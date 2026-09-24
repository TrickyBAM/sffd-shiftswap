import type { Metadata } from 'next'
import { AdminFrame } from '../_components/AdminFrame'
import { RosterView } from './_components/RosterView'

export const metadata: Metadata = { title: 'Admin · Roster' }

export default function AdminRosterPage() {
  return (
    <AdminFrame title="Roster">
      <RosterView />
    </AdminFrame>
  )
}
