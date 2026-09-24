import type { Metadata } from 'next'
import AppHeader from '@/components/AppHeader'
import { ProfileView } from './_components/ProfileView'

export const metadata: Metadata = { title: 'Profile' }

export default function ProfilePage() {
  return (
    <>
      <AppHeader title="Profile" subtitle="Your stats, details and settings" />
      <div className="mx-auto max-w-3xl px-4 py-4 md:px-6">
        <ProfileView />
      </div>
    </>
  )
}
