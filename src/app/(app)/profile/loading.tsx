import AppHeader from '@/components/AppHeader'
import { LoadingBlock } from '@/components/ui'

export default function ProfileLoading() {
  return (
    <>
      <AppHeader title="Profile" />
      <div className="mx-auto max-w-3xl px-4 py-4 md:px-6">
        <LoadingBlock label="Loading your profile…" cards={3} />
      </div>
    </>
  )
}
