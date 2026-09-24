import { Suspense } from 'react'
import type { Metadata } from 'next'
import { LoadingBlock } from '@/components/ui'
import { AdminFrame } from '../_components/AdminFrame'
import { MembersView } from './_components/MembersView'

export const metadata: Metadata = { title: 'Admin · Members' }

export default function AdminMembersPage() {
  return (
    <AdminFrame title="Members">
      {/* MembersView reads ?member= with useSearchParams, which needs a Suspense boundary. */}
      <Suspense fallback={<LoadingBlock label="Loading members…" cards={3} />}>
        <MembersView />
      </Suspense>
    </AdminFrame>
  )
}
