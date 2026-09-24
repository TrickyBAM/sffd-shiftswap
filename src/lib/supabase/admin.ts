// Service-role Supabase client — bypasses Row Level Security. SERVER ONLY:
// used for signup (creating confirmed users), admin password resets and push
// delivery. Never import this from a Client Component. It keeps no session
// and never refreshes tokens.

import { createClient as createSupabaseClient, type SupabaseClient } from '@supabase/supabase-js'
import { getServerEnv } from '@/lib/env'

export function createAdminClient(): SupabaseClient {
  if (typeof window !== 'undefined') {
    throw new Error('createAdminClient() must only be called on the server.')
  }
  const { supabaseUrl, supabaseSecretKey } = getServerEnv()
  return createSupabaseClient(supabaseUrl, supabaseSecretKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  })
}
