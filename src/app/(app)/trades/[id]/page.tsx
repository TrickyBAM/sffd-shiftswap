import type { Metadata } from 'next'
import { notFound, unstable_rethrow } from 'next/navigation'
import { getTrade, isUuid, type TradeDetail } from '@/lib/api'
import { toAppError } from '@/lib/errors'
import { createClient } from '@/lib/supabase/server'
import { TradeDetailView } from './_components/TradeDetailView'

export const metadata: Metadata = { title: 'Trade' }

type LoadResult = { kind: 'ok'; detail: TradeDetail } | { kind: 'missing' } | { kind: 'error' }

async function loadTrade(id: string): Promise<LoadResult> {
  try {
    const detail = await getTrade(await createClient(), id)
    return detail ? { kind: 'ok', detail } : { kind: 'missing' }
  } catch (error) {
    // Let Next.js's own control-flow errors (dynamic rendering, redirects) through.
    unstable_rethrow(error)
    // The client view retries (and can show the offline snapshot); a failed
    // load is never treated as "not found".
    const appError = toAppError(error)
    console.error(`[trade ${id}] could not load: ${appError.code} ${appError.details ?? ''}`)
    return { kind: 'error' }
  }
}

/** /trades/[id] — one shift or trade (either SwapMatch leg): parties, requests, actions, chat. */
export default async function TradePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!isUuid(id)) notFound()

  const result = await loadTrade(id)
  // notFound() works by throwing, so it stays outside the try/catch.
  if (result.kind === 'missing') notFound()

  return <TradeDetailView key={id} id={id} initial={result.kind === 'ok' ? result.detail : null} />
}
