'use client'

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { getMyProfile } from '@/lib/api'
import { AppError, toAppError } from '@/lib/errors'
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
  /** Set when an admin removed the member (migration 0011); absent on older databases. */
  removed_at?: string | null
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

/** Least time between two background re-checks of the profile. */
export const PROFILE_RECHECK_MS = 60_000

/**
 * True when a fresh copy of my profile means the server gates would now send me
 * elsewhere (NEXT-08): no longer approved, removed, role changed (admin screens
 * appear or go), a forced password change, or the row is gone. Layout gates
 * don't re-run on client navigation, so the app reloads to run them.
 */
export function profileNeedsGate(current: Pick<MyProfile, 'role'>, fresh: MyProfile | null): boolean {
  if (!fresh) return true
  return (
    fresh.status !== 'approved' ||
    fresh.role !== current.role ||
    fresh.must_change_password === true ||
    Boolean(fresh.removed_at)
  )
}

export interface ProfileProviderProps {
  /** The profile the server layout loaded for this request. */
  profile: MyProfile
  children: ReactNode
}

export function ProfileProvider({ profile: serverProfile, children }: ProfileProviderProps) {
  const router = useRouter()
  const pathname = usePathname()
  // A client-side refresh wins until the server layout sends a newer row
  // (router.refresh() or a navigation re-renders the layout with fresh data).
  const [fetched, setFetched] = useState<{ from: MyProfile; row: MyProfile } | null>(null)
  const [refreshing, setRefreshing] = useState(false)

  const profile = fetched && fetched.from === serverProfile ? fetched.row : serverProfile
  const userId = serverProfile.id

  const loadRow = useCallback(async (): Promise<MyProfile | null> => {
    return (await getMyProfile(createClient(), userId)) as MyProfile | null
  }, [userId])

  const refresh = useCallback(async () => {
    setRefreshing(true)
    try {
      const row = await loadRow()
      if (!row) throw new AppError('NOT_FOUND', "Couldn't reload your profile. Check your connection and try again.")
      setFetched({ from: serverProfile, row })
      router.refresh()
    } catch (error) {
      throw toAppError(error)
    } finally {
      setRefreshing(false)
    }
  }, [router, serverProfile, loadRow])

  // Background re-check (NEXT-08): when the app comes back to the foreground or
  // the member moves to another screen, at most once a minute, re-read my row.
  // If an admin suspended or removed me, changed my role or forced a password
  // change, reload so the server layout's gates run. Connection problems are
  // ignored (the next check tries again).
  const current = useRef(profile)
  useEffect(() => {
    current.current = profile
  }, [profile])
  const lastCheck = useRef(0)
  const checking = useRef(false)

  const recheck = useCallback(async () => {
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return
    const now = Date.now()
    if (checking.current || now - lastCheck.current < PROFILE_RECHECK_MS) return
    checking.current = true
    lastCheck.current = now
    try {
      const row = await loadRow()
      if (profileNeedsGate(current.current, row)) {
        window.location.reload()
        return
      }
      if (row && row.updated_at !== current.current.updated_at) setFetched({ from: serverProfile, row })
    } catch (error) {
      // Signed out elsewhere (or the session expired): let the server send me to /login.
      if (toAppError(error).code === 'NOT_SIGNED_IN') window.location.reload()
    } finally {
      checking.current = false
    }
  }, [loadRow, serverProfile])

  useEffect(() => {
    // The server layout just checked this profile.
    lastCheck.current = Date.now()
  }, [serverProfile])

  useEffect(() => {
    const onResume = () => void recheck()
    document.addEventListener('visibilitychange', onResume)
    window.addEventListener('focus', onResume)
    window.addEventListener('online', onResume)
    return () => {
      document.removeEventListener('visibilitychange', onResume)
      window.removeEventListener('focus', onResume)
      window.removeEventListener('online', onResume)
    }
  }, [recheck])

  // Client-side navigation doesn't re-run the layout gates, so re-check on screen changes too.
  useEffect(() => {
    void recheck()
  }, [pathname, recheck])

  const value = useMemo<ProfileContextValue>(
    () => ({ profile, isAdmin: profile.role === 'admin', refresh, refreshing }),
    [profile, refresh, refreshing],
  )

  return <ProfileContext.Provider value={value}>{children}</ProfileContext.Provider>
}

/** The signed-in member's profile. Only usable under the (app) layout. */
export function useProfile(): ProfileContextValue {
  const ctx = useContext(ProfileContext)
  if (!ctx) throw new Error('useProfile must be used inside <ProfileProvider> (rendered by the app layout).')
  return ctx
}
