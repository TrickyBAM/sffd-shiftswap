import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { ProfileProvider } from '@/contexts/ProfileContext'
import type { Profile } from '@/lib/types'

export default async function ScheduleSetupLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .single()

  if (!profile || profile.profile_complete === false) {
    redirect('/onboarding')
  }

  return (
    <ProfileProvider profile={profile as Profile}>
      <main className="min-h-screen">
        {children}
      </main>
    </ProfileProvider>
  )
}
