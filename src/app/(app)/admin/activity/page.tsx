import type { Metadata } from 'next'
import { AdminFrame } from '../_components/AdminFrame'
import { ActivityView } from './_components/ActivityView'

export const metadata: Metadata = { title: 'Admin · Activity' }

export default function AdminActivityPage() {
  return (
    <AdminFrame title="Activity">
      <ActivityView />
    </AdminFrame>
  )
}
