'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { getMyProfile } from '@/lib/api'
import { toAppError } from '@/lib/errors'
import { createClient } from '@/lib/supabase/client'
import type { Profile } from '@/lib/types/database'
import { nextStepFor } from '../../_lib/gates'

export const POLL_INTERVAL_MS = 20_000

export interface PendingPoll {
  /** The latest profile row (starts with the server's). */
  profile: Profile
  /** A manual check is running. */
  checking: boolean
  /** The member is being sent on (approved, or must change password). */
  leaving: boolean
  /** When the last successful check finished (null before the first). */
  lastChecked: Date | null
  /** Friendly message when the last manual check failed. */
  error: string | null
  /** Check right now (the "Check again" button). Resolves true when nothing changed. */
  checkNow: () => Promise<boolean>
}

/**
 * Re-reads my profile every 20 seconds while the page is visible, and right
 * away when the app comes back to the foreground. As soon as my status allows
 * another step (approved → /welcome, or a forced password change), goes there.
 * Background checks fail quietly; a manual check reports its error.
 */
export function usePendingPoll(initialProfile: Profile): PendingPoll {
  const router = useRouter()
  const [profile, setProfile] = useState(initialProfile)
  const [checking, setChecking] = useState(false)
  const [leaving, setLeaving] = useState(false)
  const [lastChecked, setLastChecked] = useState<Date | null>(null)
  const [error, setError] = useState<string | null>(null)
  const inFlight = useRef(false)
  const left = useRef(false)
  const userId = initialProfile.id

  const check = useCallback(
    async (manual: boolean): Promise<boolean> => {
      if (inFlight.current || left.current) return false
      inFlight.current = true
      if (manual) setChecking(true)
      try {
        const latest = await getMyProfile(createClient(), userId)
        if (!latest) {
          // The profile vanished: let the layout explain.
          router.refresh()
          return false
        }
        const next = nextStepFor(latest)
        if (next !== '/pending') {
          left.current = true
          setLeaving(true)
          router.replace(next)
          return false
        }
        const changed =
          latest.status !== profile.status ||
          latest.status_reason !== profile.status_reason ||
          latest.updated_at !== profile.updated_at
        setProfile(latest)
        setError(null)
        setLastChecked(new Date())
        return !changed
      } catch (err) {
        const appError = toAppError(err)
        if (appError.code === 'NOT_SIGNED_IN') {
          left.current = true
          window.location.replace('/login')
          return false
        }
        if (manual) setError(appError.message)
        return false
      } finally {
        inFlight.current = false
        if (manual) setChecking(false)
      }
    },
    [router, userId, profile.status, profile.status_reason, profile.updated_at],
  )

  // Keep the latest `check` for the timers without restarting them on every render.
  const checkRef = useRef(check)
  useEffect(() => {
    checkRef.current = check
  }, [check])

  useEffect(() => {
    const visible = () => document.visibilityState === 'visible'
    const timer = window.setInterval(() => {
      if (visible()) void checkRef.current(false)
    }, POLL_INTERVAL_MS)
    const onFocus = () => {
      if (visible()) void checkRef.current(false)
    }
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onFocus)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onFocus)
    }
  }, [])

  const checkNow = useCallback(() => check(true), [check])

  return { profile, checking, leaving, lastChecked, error, checkNow }
}
