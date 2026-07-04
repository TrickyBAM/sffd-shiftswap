import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl
  const code = searchParams.get('code')
  const next = searchParams.get('next')
  const redirectUrl = request.nextUrl.clone()

  if (code) {
    const supabase = await createClient()
    const { error } = await supabase.auth.exchangeCodeForSession(code)

    // Password recovery and similar flows land on their own page.
    if (!error && next && next.startsWith('/') && !next.startsWith('//')) {
      redirectUrl.pathname = next
      redirectUrl.search = ''
      return Response.redirect(redirectUrl)
    }

    if (!error) {
      // Check if profile is complete
      const {
        data: { user },
      } = await supabase.auth.getUser()

      if (user) {
        const { data: profile } = await supabase
          .from('profiles')
          .select('profile_complete')
          .eq('id', user.id)
          .single()

        if (!profile?.profile_complete) {
          redirectUrl.pathname = '/onboarding'
        } else {
          // Check if schedule is set up
          const { data: schedule } = await supabase
            .from('schedules')
            .select('setup_complete')
            .eq('user_id', user.id)
            .single()

          if (!schedule || !schedule.setup_complete) {
            redirectUrl.pathname = '/schedule-setup'
          } else {
            redirectUrl.pathname = '/dashboard'
          }
        }

        redirectUrl.search = ''
        return Response.redirect(redirectUrl)
      }
    }
  }

  // If something went wrong, redirect to login
  redirectUrl.pathname = '/login'
  redirectUrl.search = ''
  return Response.redirect(redirectUrl)
}
