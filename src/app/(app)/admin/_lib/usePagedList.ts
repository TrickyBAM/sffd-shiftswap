'use client'

import { useState } from 'react'
import type { Page } from '@/lib/api'
import { toAppError, type AppError } from '@/lib/errors'
import { useAsyncData } from './useAsyncData'

interface Extra<T, C> {
  /** The first page these extra rows follow (a newer first page discards them). */
  base: Page<T, C>
  items: T[]
  nextCursor: C | null
  loading: boolean
  error: AppError | null
}

export interface PagedList<T> {
  /** Every row loaded so far. */
  items: T[]
  /** True once the first page has loaded at least once. */
  loaded: boolean
  /** The first page is loading (initially, for a new key, or after reload()). */
  loading: boolean
  /** Why the first page failed to load. */
  error: AppError | null
  hasMore: boolean
  loadingMore: boolean
  /** Why the last "load more" failed. */
  moreError: AppError | null
  loadMore: () => void
  /** Starts again from the first page. */
  reload: () => void
}

/**
 * "Load more" pagination over a cursor-paged reader. A new `key` (e.g. a
 * different filter) or reload() starts again from the first page.
 */
export function usePagedList<T, C>(loadPage: (cursor: C | null) => Promise<Page<T, C>>, key: string): PagedList<T> {
  const first = useAsyncData(() => loadPage(null), key)
  const [extra, setExtra] = useState<Extra<T, C> | null>(null)
  const base = first.data
  const current = extra && base && extra.base === base ? extra : null
  const nextCursor = current ? current.nextCursor : (base?.nextCursor ?? null)
  const loadingMore = current?.loading ?? false

  async function loadMore() {
    if (!base || nextCursor === null || loadingMore) return
    const before = current?.items ?? []
    setExtra({ base, items: before, nextCursor, loading: true, error: null })
    try {
      const page = await loadPage(nextCursor)
      setExtra((prev) =>
        prev && prev.base === base
          ? { base, items: [...before, ...page.items], nextCursor: page.nextCursor, loading: false, error: null }
          : prev,
      )
    } catch (err) {
      setExtra((prev) => (prev && prev.base === base ? { ...prev, loading: false, error: toAppError(err) } : prev))
    }
  }

  return {
    items: base ? [...base.items, ...(current?.items ?? [])] : [],
    loaded: Boolean(base),
    loading: first.loading,
    error: first.error,
    hasMore: nextCursor !== null,
    loadingMore,
    moreError: current?.error ?? null,
    loadMore: () => void loadMore(),
    reload: first.reload,
  }
}
