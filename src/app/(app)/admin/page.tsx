import type { Metadata } from 'next'
import { AdminFrame } from './_components/AdminFrame'
import { ApprovalsView } from './_components/ApprovalsView'

export const metadata: Metadata = { title: 'Admin · Approvals' }

export default function AdminApprovalsPage() {
  return (
    <AdminFrame title="Approvals">
      <ApprovalsView />
    </AdminFrame>
  )
}
