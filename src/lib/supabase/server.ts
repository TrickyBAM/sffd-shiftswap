// Supabase client for Server Components, Route Handlers and Server Actions.
// Create a new one per request (never share across requests). The session is
// kept fresh by the proxy (src/proxy.ts → session.ts).

import { createServerClient } from '@supabase/ssr'
import type { SupabaseClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'
import { getPublicEnv } from '@/lib/env'

export async function createClient(): Promise<SupabaseClient> {
  const cookieStore = await cookies()
  const { supabaseUrl, supabaseKey } = getPublicEnv()

  return createServerClient(supabaseUrl, supabaseKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll()
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options)
          }
        } catch {
          // Called from a Server Component, where cookies are read-only. Safe
          // to ignore: the proxy refreshes the session on every navigation.
        }
      },
    },
  })
}
