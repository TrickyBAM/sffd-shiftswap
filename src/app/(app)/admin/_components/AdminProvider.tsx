'use client'

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'
import { getAdminOverview } from '@/lib/api'
import { toAppError } from '@/lib/errors'
import { createClient } from '@/lib/supabase/client'
import type { AdminOverview } from '@/lib/types/database'

export interface AdminContextValue {
  /** Dashboard counts, or null when they couldn't be loaded. */
  overview: AdminOverview | null
  /** Friendly message when the counts couldn't be loaded. */
  overviewError: string | null
  overviewLoading: boolean
  /** Re-reads the counts (call after any change). Never throws. */
  refreshOverview: () => Promise<void>
}

const AdminContext = createContext<AdminContextValue | null>(null)

interface Fetched {
  /** The server values this refresh replaced (a newer server render wins). */
  from: AdminOverview | null
  overview: AdminOverview | null
  error: string | null
}

export interface AdminProviderProps {
  initialOverview: AdminOverview | null
  initialError: string | null
  children: ReactNode
}

/** Holds the admin overview counts the layout loaded, refreshable from any admin screen. */
export function AdminProvider({ initialOverview, initialError, children }: AdminProviderProps) {
  const [fetched, setFetched] = useState<Fetched | null>(null)
  const [loading, setLoading] = useState(false)

  const refreshOverview = useCallback(async () => {
    setLoading(true)
    try {
      const overview = await getAdminOverview(createClient())
      setFetched({ from: initialOverview, overview, error: null })
    } catch (err) {
      setFetched((prev) => ({
        from: initialOverview,
        overview: prev && prev.from === initialOverview ? prev.overview : initialOverview,
        error: toAppError(err).message,
      }))
    } finally {
      setLoading(false)
    }
  }, [initialOverview])

  const current = fetched && fetched.from === initialOverview ? fetched : null
  const value = useMemo<AdminContextValue>(
    () => ({
      overview: current ? current.overview : initialOverview,
      overviewError: current ? current.error : initialError,
      overviewLoading: loading,
      refreshOverview,
    }),
    [current, initialOverview, initialError, loading, refreshOverview],
  )

  return <AdminContext.Provider value={value}>{children}</AdminContext.Provider>
}

/** Admin overview counts and a refresh function. Only inside the /admin layout. */
export function useAdmin(): AdminContextValue {
  const ctx = useContext(AdminContext)
  if (!ctx) throw new Error('useAdmin must be used inside the /admin layout.')
  return ctx
}
