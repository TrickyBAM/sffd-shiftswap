import type { Metadata } from 'next'
import AppHeader from '@/components/AppHeader'
import { AlertsView } from './_components/AlertsView'

export const metadata: Metadata = { title: 'Alerts' }

export default function AlertsPage() {
  return (
    <>
      <AppHeader title="Alerts" subtitle="Trade updates, messages and new shifts" />
      <div className="mx-auto max-w-3xl px-4 py-4 md:px-6">
        <AlertsView />
      </div>
    </>
  )
}
