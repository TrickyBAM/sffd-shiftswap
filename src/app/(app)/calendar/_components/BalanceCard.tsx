'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { getMyStats } from '@/lib/api'
import { toAppError, type AppError } from '@/lib/errors'
import { loadSnapshot, saveSnapshot } from '@/lib/offline-cache'
import { createClient } from '@/lib/supabase/client'
import type { MyStats } from '@/lib/types/database'
import { Button, Card, CardHeader, cn, ErrorState, Skeleton } from '@/components/ui'
import { balanceDetail, balanceHeadline } from './calendar-model'

const SNAPSHOT_KEY = 'calendar-stats'

interface StatsState {
  stats: MyStats | null
  error: AppError | null
  /** The load the state belongs to (a different token means a reload is running). */
  token: string
}

export interface BalanceCardProps {
  userId: string
  /** Bump to reload (e.g. after a live update). */
  reloadToken: number
}

/** "Covered · Given · Balance" from my_stats, with a plain-English headline. */
export function BalanceCard({ userId, reloadToken }: BalanceCardProps) {
  const [retries, setRetries] = useState(0)
  const token = `${reloadToken}:${retries}`
  const [state, setState] = useState<StatsState>({ stats: null, error: null, token: '' })

  useEffect(() => {
    let active = true
    Promise.resolve()
      .then(() => getMyStats(createClient()))
      .then(
        (stats) => {
          if (!active) return
          setState({ stats, error: null, token })
          saveSnapshot(SNAPSHOT_KEY, userId, stats)
        },
        (err: unknown) => {
          if (!active) return
          const snap = loadSnapshot<MyStats>(SNAPSHOT_KEY, userId)
          setState((prev) => ({
            stats: prev.stats ?? snap?.data ?? null,
            error: toAppError(err),
            token,
          }))
        },
      )
    return () => {
      active = false
    }
  }, [userId, token])

  const loading = state.stats === null && state.error === null
  const retrying = state.token !== token

  return (
    <Card as="section" aria-labelledby="balance-title">
      <CardHeader
        title={<span id="balance-title">Your balance</span>}
        description="Shifts you've covered versus shifts others covered for you."
        action={
          <Link href="/trades" className="inline-flex min-h-11 items-center px-1 text-sm font-semibold text-accent-blue hover:underline">
            Trades
          </Link>
        }
      />

      {loading ? (
        <div role="status" aria-live="polite">
          <span className="sr-only">Loading your balance…</span>
          <div className="grid grid-cols-3 gap-2" aria-hidden="true">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-16 rounded-xl" />
            ))}
          </div>
          <Skeleton className="mt-3 h-4 w-2/3" />
        </div>
      ) : state.stats ? (
        <>
          {/* Same names and colours as Trades › Balances and Profile (UX-11): the counts
              are plain, the balance is green when ahead and orange when behind. */}
          <dl className="grid grid-cols-3 gap-2">
            <Stat label="Covered" value={state.stats.covered} />
            <Stat label="Given" value={state.stats.given} />
            <Stat label="Balance" value={state.stats.balance} signed className={balanceClass(state.stats.balance)} />
          </dl>
          <p className="mt-3 font-semibold text-fg">{balanceHeadline(state.stats)}</p>
          <p className="text-sm text-fg-muted">{balanceDetail(state.stats)}</p>
          {state.error ? (
            <p className="mt-2 flex flex-wrap items-center gap-x-2 text-sm text-fg-dim">
              <span>Couldn&apos;t refresh these numbers.</span>
              <Button variant="ghost" size="sm" onClick={() => setRetries((n) => n + 1)} loading={retrying}>
                Try again
              </Button>
            </p>
          ) : null}
        </>
      ) : (
        <ErrorState
          title="Couldn't load your balance"
          message={state.error?.message}
          onRetry={() => setRetries((n) => n + 1)}
          retrying={retrying}
          className="py-6"
        />
      )}
    </Card>
  )
}

/** Balance colour used across the app: green ahead, orange behind, plain when even. */
function balanceClass(balance: number): string | undefined {
  if (balance > 0) return 'text-accent-green'
  if (balance < 0) return 'text-accent-orange'
  return undefined
}

function Stat({ label, value, signed = false, className }: { label: string; value: number; signed?: boolean; className?: string }) {
  const text = signed && value > 0 ? `+${value}` : String(value)
  return (
    <div className="rounded-xl border border-line bg-elevated px-2 py-2.5 text-center">
      <dt className="text-xs font-medium uppercase tracking-wide text-fg-muted">{label}</dt>
      <dd className={cn('font-display text-3xl leading-tight text-fg', className)}>{text}</dd>
    </div>
  )
}
