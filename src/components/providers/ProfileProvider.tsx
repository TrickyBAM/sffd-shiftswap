'use client'

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

/**
 * The signed-in member's own profiles row (ARCHITECTURE §6.1), as the (app) layout
 * loads it with `select('*')`. Structural, so a stricter row type from
 * src/lib/types/database.ts can be passed in unchanged.
 */
export interface MyProfile {
  id: string
  email: string
  full_name: string
  phone: string | null
  rank: string | null
  station: number | null
  battalion: number | null
  division: number | null
  tour: number | null
  employee_id: string | null
  status: 'onboarding' | 'pending' | 'approved' | 'rejected' | 'suspended'
  status_reason: string | null
  role: 'member' | 'admin'
  roster_id: string | null
  telestaff_ack_at: string | null
  must_change_password: boolean
  notify_scope: 'off' | 'station' | 'battalion' | 'division' | 'all'
  calendar_token: string
  approved_at: string | null
  approved_by: string | null
  created_at: string
  updated_at: string
}

export interface ProfileContextValue {
  profile: MyProfile
  isAdmin: boolean
  /**
   * Re-read the profile row (after update_my_profile, acknowledge_telestaff, …) and
   * re-run the server layout so its gates see the change. Resolves when the row is
   * loaded; rejects if it couldn't be (the old profile is kept).
   */
  refresh: () => Promise<void>
  refreshing: boolean
}

const ProfileContext = createContext<ProfileContextValue | null>(null)

export interface ProfileProviderProps {
  /** The profile the server layout loaded for this request. */
  profile: MyProfile
  children: ReactNode
}

export function ProfileProvider({ profile: serverProfile, children }: ProfileProviderProps) {
  const router = useRouter()
  // A client-side refresh wins until the server layout sends a newer row
  // (router.refresh() or a navigation re-renders the layout with fresh data).
  const [fetched, setFetched] = useState<{ from: MyProfile; row: MyProfile } | null>(null)
  const [refreshing, setRefreshing] = useState(false)

  const profile = fetched && fetched.from === serverProfile ? fetched.row : serverProfile
  const userId = serverProfile.id

  const refresh = useCallback(async () => {
    setRefreshing(true)
    try {
      const { data, error } = await createClient()
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .single<MyProfile>()
      if (error || !data) throw new Error("Couldn't reload your profile. Check your connection and try again.")
      setFetched({ from: serverProfile, row: data })
      router.refresh()
    } finally {
      setRefreshing(false)
    }
  }, [router, serverProfile, userId])

  const value = useMemo<ProfileContextValue>(
    () => ({ profile, isAdmin: profile.role === 'admin', refresh, refreshing }),
    [profile, refresh, refreshing],
  )

  return <ProfileContext.Provider value={value}>{children}</ProfileContext.Provider>
}

/** The signed-in member's profile. Only usable under the (app)/(onboard) layouts. */
export function useProfile(): ProfileContextValue {
  const ctx = useContext(ProfileContext)
  if (!ctx) throw new Error('useProfile must be used inside <ProfileProvider> (rendered by the app layout).')
  return ctx
}

/** Like useProfile, but returns null outside a ProfileProvider (shared components). */
export function useOptionalProfile(): ProfileContextValue | null {
  return useContext(ProfileContext)
}
