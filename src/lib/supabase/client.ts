// Browser Supabase client (Client Components). One instance per tab so auth
// state and realtime channels are shared. Throws MissingEnvError with a clear
// message if the public Supabase variables are missing.

import { createBrowserClient } from '@supabase/ssr'
import type { SupabaseClient } from '@supabase/supabase-js'
import { getPublicEnv } from '@/lib/env'

let browserClient: SupabaseClient | undefined

export function createClient(): SupabaseClient {
  if (browserClient) return browserClient
  const { supabaseUrl, supabaseKey } = getPublicEnv()
  const client = createBrowserClient(supabaseUrl, supabaseKey)
  // Only memoise in a real browser; during SSR of a client component each
  // request must get its own instance.
  if (typeof window !== 'undefined') browserClient = client
  return client
}
