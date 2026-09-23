'use client'

import { useCallback, useEffect, useState } from 'react'
import { listMyShiftsInRange } from '@/lib/api'
import { toAppError, type AppError } from '@/lib/errors'
import type { Ymd } from '@/lib/sffd/dates'
import { createClient } from '@/lib/supabase/client'
import type { Shift } from '@/lib/types/database'

export interface MyShiftsState {
  /** My open and covered shifts in the range; null until the first load. */
  shifts: Shift[] | null
  /** The last load failed (shifts keep their previous value, if any). */
  error: AppError | null
  /** A reload (retry, or after a rule failure) is running. */
  reloading: boolean
  reload: () => void
}

/**
 * My open/covered shifts (as poster or coverer) dated from…to — what the post
 * form needs to know which days are already posted, traded or picked up.
 */
export function useMyShifts(userId: string, from: Ymd, to: Ymd): MyShiftsState {
  const [shifts, setShifts] = useState<Shift[] | null>(null)
  const [error, setError] = useState<AppError | null>(null)
  const [token, setToken] = useState(0)
  const [reloading, setReloading] = useState(false)

  useEffect(() => {
    let active = true
    Promise.resolve()
      .then(() => listMyShiftsInRange(createClient(), { from, to, userId }))
      .then(
        (rows) => {
          if (!active) return
          setShifts(rows)
          setError(null)
        },
        (err: unknown) => {
          if (active) setError(toAppError(err))
        },
      )
      .finally(() => {
        if (active) setReloading(false)
      })
    return () => {
      active = false
    }
  }, [userId, from, to, token])

  const reload = useCallback(() => {
    setReloading(true)
    setToken((t) => t + 1)
  }, [])

  return { shifts, error, reloading, reload }
}
