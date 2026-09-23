'use client'

import { Card, ErrorState, Skeleton } from '@/components/ui'
import { cn } from '@/components/ui/cn'
import { OfflineRibbon } from '@/components/OfflineRibbon'
import { useProfile } from '@/components/providers/ProfileProvider'
import { SHIFT_TYPE_VALUES } from '@/lib/sffd/shift-types'
import type { MyStats } from '@/lib/types/database'
import {
  balanceOf,
  balanceSentence,
  clampScore,
  formatSigned,
  reciprocity,
  TRUST_EXPLAINER,
  trustHeadline,
  trustMessage,
  type MonthCovers,
  type TrustTone,
} from './profile-model'
import { ProfileSection } from './ProfileSection'
import { useProfileStats } from './useProfileStats'

/** "Your stats": trade totals, balance, reciprocity bar, per-type balance and trust score. */
export function StatsSection() {
  const { profile } = useProfile()
  const { state, retry, retrying } = useProfileStats(profile.id)

  return (
    <ProfileSection id="profile-stats" title="Your stats">
      {state.status === 'loading' ? <StatsSkeleton /> : null}
      {state.status === 'error' ? (
        <ErrorState title="Couldn't load your stats" message={state.message} onRetry={retry} retrying={retrying} />
      ) : null}
      {state.status === 'ready' ? (
        <>
          {state.offline ? <OfflineRibbon updatedAt={state.savedAt} onRetry={retry} retrying={retrying} /> : null}
          <TradesCard stats={state.data.stats} />
          <TrustCard stats={state.data.stats} month={state.data.month} />
        </>
      ) : null}
    </ProfileSection>
  )
}

function StatsSkeleton() {
  return (
    <div role="status" aria-live="polite" className="space-y-3">
      <span className="sr-only">Loading your stats…</span>
      <div aria-hidden="true" className="rounded-2xl border border-line bg-card p-4">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-20 rounded-xl" />
          ))}
        </div>
        <Skeleton className="mt-4 h-24 rounded-xl" />
      </div>
      <div aria-hidden="true" className="flex items-center gap-4 rounded-2xl border border-line bg-card p-4">
        <Skeleton className="h-20 w-20 rounded-full" />
        <div className="flex-1 space-y-2">
          <Skeleton className="h-4 w-1/2" />
          <Skeleton className="h-3 w-3/4" />
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Trades card
// ---------------------------------------------------------------------------

function TradesCard({ stats }: { stats: MyStats }) {
  const balance = balanceOf(stats)
  return (
    <Card as="article" aria-labelledby="profile-trades-title">
      <h3 id="profile-trades-title" className="font-display text-xl tracking-wide text-fg">
        Your trades
      </h3>
      <dl className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <StatTile label="Posted" value={stats.posted} hint="Shifts you put up" />
        <StatTile label="Covered" value={stats.covered} hint="You worked for someone" />
        <StatTile label="Given" value={stats.given} hint="Someone worked for you" />
        <StatTile label="Outstanding" value={stats.outstanding} hint="Your open posts" />
      </dl>

      <div className="mt-3 rounded-xl bg-elevated p-3">
        <div className="flex items-end justify-between gap-3">
          <div className="min-w-0">
            <p className="font-semibold text-fg">Balance</p>
            <p className="text-xs text-fg-dim">Covered − Given</p>
          </div>
          <p
            className={cn(
              'font-display text-4xl leading-none',
              balance > 0 ? 'text-accent-green' : balance < 0 ? 'text-accent-orange' : 'text-fg',
            )}
          >
            {formatSigned(balance)}
          </p>
        </div>
        <p className="mt-2 text-sm text-fg-muted">{balanceSentence(stats)}</p>
        <ReciprocityBar covered={stats.covered} given={stats.given} />
      </div>

      <h4 className="mt-4 text-sm font-semibold text-fg">By shift type</h4>
      <ul className="mt-1 divide-y divide-line text-sm">
        {SHIFT_TYPE_VALUES.map((type) => {
          const t = stats.by_type?.[type] ?? { covered: 0, given: 0, balance: 0 }
          const net = t.covered - t.given
          return (
            <li key={type} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-0.5 py-2">
              <span className="font-medium text-fg">{type}</span>
              <span className="text-fg-muted">
                Covered {t.covered} · Given {t.given} · Balance{' '}
                <span className="font-semibold text-fg">{formatSigned(net)}</span>
              </span>
            </li>
          )
        })}
      </ul>
    </Card>
  )
}

function StatTile({ label, value, hint }: { label: string; value: number; hint: string }) {
  return (
    <div className="rounded-xl bg-elevated px-3 py-3">
      <dt className="text-xs font-semibold uppercase tracking-wide text-fg-dim">{label}</dt>
      <dd className="mt-1 font-display text-3xl leading-none text-fg">{value}</dd>
      <dd className="mt-1 text-xs text-fg-muted">{hint}</dd>
    </div>
  )
}

/**
 * Covered vs given as one split bar. The numbers are written next to it, so
 * the colours are never the only way to read it.
 */
function ReciprocityBar({ covered, given }: { covered: number; given: number }) {
  const split = reciprocity(covered, given)
  return (
    <figure className="mt-3">
      <div
        role="img"
        aria-label={split ? `Covered ${covered}, given ${given}` : 'No trades yet'}
        className="flex h-3 gap-0.5 overflow-hidden rounded-full bg-raised"
      >
        {split && split.coveredPct > 0 ? (
          <span className="h-full rounded-l-full bg-accent-green" style={{ width: `${split.coveredPct}%` }} />
        ) : null}
        {split && split.givenPct > 0 ? (
          <span className="h-full flex-1 rounded-r-full bg-accent-orange" />
        ) : null}
      </div>
      <figcaption aria-hidden="true" className="mt-1.5 flex justify-between gap-3 text-xs text-fg-muted">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-accent-green" />
          Covered {covered}
        </span>
        <span className="inline-flex items-center gap-1.5">
          Given {given}
          <span className="h-2 w-2 rounded-full bg-accent-orange" />
        </span>
      </figcaption>
    </figure>
  )
}

// ---------------------------------------------------------------------------
// Trust score
// ---------------------------------------------------------------------------

const TONE_STROKE: Record<TrustTone, string> = {
  great: 'stroke-accent-green',
  good: 'stroke-accent-blue',
  building: 'stroke-accent-yellow',
}

function TrustCard({ stats, month }: { stats: MyStats; month: MonthCovers | null }) {
  const score = clampScore(stats.trust_score)
  const { tone } = trustHeadline(score)
  const message = trustMessage(score, {
    month,
    covered: stats.covered,
    given: stats.given,
    outstanding: stats.outstanding,
  })
  return (
    <Card as="article" aria-labelledby="profile-trust-title">
      <div className="flex items-center gap-4">
        <TrustGauge score={score} tone={tone} />
        <div className="min-w-0 flex-1">
          <h3 id="profile-trust-title" className="font-display text-xl tracking-wide text-fg">
            Trust score
          </h3>
          <p className="sr-only">Your trust score is {score} out of 100.</p>
          <p className="mt-0.5 font-semibold text-fg">{message}</p>
        </div>
      </div>
      <p className="mt-3 text-sm text-fg-dim">{TRUST_EXPLAINER}</p>
    </Card>
  )
}

/** Ring gauge with the score in the middle (decorative: the card text carries it). */
function TrustGauge({ score, tone }: { score: number; tone: TrustTone }) {
  const radius = 34
  const circumference = 2 * Math.PI * radius
  const filled = (score / 100) * circumference
  return (
    <div aria-hidden="true" className="relative h-20 w-20 shrink-0">
      <svg viewBox="0 0 80 80" className="h-full w-full -rotate-90">
        <circle cx="40" cy="40" r={radius} fill="none" strokeWidth="8" className="stroke-raised" />
        <circle
          cx="40"
          cy="40"
          r={radius}
          fill="none"
          strokeWidth="8"
          strokeLinecap="round"
          strokeDasharray={`${filled} ${circumference}`}
          className={TONE_STROKE[tone]}
        />
      </svg>
      <span className="absolute inset-0 flex flex-col items-center justify-center leading-none">
        <span className="font-display text-3xl text-fg">{score}</span>
        <span className="text-[10px] font-semibold uppercase tracking-wide text-fg-dim">of 100</span>
      </span>
    </div>
  )
}
