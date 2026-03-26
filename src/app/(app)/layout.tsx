import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { ProfileProvider } from '@/contexts/ProfileContext'
import Navigation from '@/components/Navigation'
import type { Profile } from '@/lib/types'

export default async function AppLayout({
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

  // Check if schedule is set up
  const { data: schedule } = await supabase
    .from('schedules')
    .select('setup_complete')
    .eq('user_id', user.id)
    .single()

  if (!schedule || !schedule.setup_complete) {
    redirect('/schedule-setup')
  }

  return (
    <ProfileProvider profile={profile as Profile}>
      <Navigation />
      <main className="min-h-screen pb-20 md:pb-0 md:pl-64">
        {children}
      </main>
    </ProfileProvider>
  )
}
