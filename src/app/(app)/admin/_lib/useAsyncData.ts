'use client'

import { useCallback, useEffect, useEffectEvent, useState } from 'react'
import { toAppError, type AppError } from '@/lib/errors'

interface Settled<T> {
  key: string
  nonce: number
  data: T | undefined
  error: AppError | null
}

export interface AsyncData<T> {
  /** The latest loaded value (kept while a newer load runs, so lists don't flash). */
  data: T | undefined
  /** The friendly error from the latest load, when it failed. */
  error: AppError | null
  /** True while the first load, a load for a new key, or a reload() is running. */
  loading: boolean
  /** Runs the loader again (e.g. after a change or from a "Try again" button). */
  reload: () => void
}

/**
 * Loads data on the client and reloads it whenever `key` changes. The newest
 * request always wins; responses for an old key are ignored.
 *
 *   const members = useAsyncData(() => listMembers(createClient(), options), JSON.stringify(options))
 */
export function useAsyncData<T>(load: () => Promise<T>, key: string): AsyncData<T> {
  const [nonce, setNonce] = useState(0)
  const [result, setResult] = useState<Settled<T> | null>(null)
  const run = useEffectEvent(() => load())

  useEffect(() => {
    let active = true
    run().then(
      (data) => {
        if (active) setResult({ key, nonce, data, error: null })
      },
      (error: unknown) => {
        if (active) setResult((prev) => ({ key, nonce, data: prev?.data, error: toAppError(error) }))
      },
    )
    return () => {
      active = false
    }
  }, [key, nonce])

  const reload = useCallback(() => setNonce((n) => n + 1), [])
  const loading = !result || result.key !== key || result.nonce !== nonce

  return {
    data: result?.data,
    error: loading ? null : (result?.error ?? null),
    loading,
    reload,
  }
}

/** A value that follows `value` after it has stopped changing for `delayMs`. */
export function useDebouncedValue<T>(value: T, delayMs = 300): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs)
    return () => clearTimeout(timer)
  }, [value, delayMs])
  return debounced
}
