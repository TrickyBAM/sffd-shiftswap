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

  return (
    <ProfileProvider profile={profile as Profile}>
      <Navigation />
      <main className="min-h-screen pb-16 md:pb-0 md:pl-64">
        {children}
      </main>
    </ProfileProvider>
  )
}
