import AppHeader from '@/components/AppHeader'
import { LoadingBlock } from '@/components/ui'

export default function AlertsLoading() {
  return (
    <>
      <AppHeader title="Alerts" />
      <div className="mx-auto max-w-3xl px-4 py-4 md:px-6">
        <LoadingBlock label="Loading your alerts…" cards={4} />
      </div>
    </>
  )
}
