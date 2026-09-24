'use client'

import Link from 'next/link'
import { RotateCw } from 'lucide-react'
import { Skeleton, cn } from '@/components/ui'
import type { AdminOverview } from '@/lib/types/database'
import { useAdmin } from './AdminProvider'

interface Tile {
  href: string
  value: number
  label: string
  sub?: string
  /** Full sentence for screen readers. */
  aria: string
  highlight?: boolean
}

function tilesFor(o: AdminOverview): Tile[] {
  const n = (v: number) => v.toLocaleString('en-US')
  return [
    {
      href: '/admin',
      value: o.pending_members,
      label: 'Waiting',
      aria: `${n(o.pending_members)} waiting for approval`,
      highlight: o.pending_members > 0,
    },
    {
      href: '/admin/members',
      value: o.approved_members,
      label: 'Members',
      sub: o.suspended_members > 0 ? `${n(o.suspended_members)} suspended` : undefined,
      aria: `${n(o.approved_members)} approved members${o.suspended_members > 0 ? `, ${n(o.suspended_members)} suspended` : ''}`,
    },
    {
      href: '/admin/trades?status=open',
      value: o.open_shifts,
      label: 'Open posts',
      aria: `${n(o.open_shifts)} open posts`,
    },
    {
      href: '/admin/trades',
      value: o.trades_this_month,
      label: 'Trades this month',
      aria: `${n(o.trades_this_month)} trades confirmed this month`,
    },
    {
      href: '/admin/roster',
      value: o.roster_size,
      label: 'On roster',
      sub: `${n(o.roster_unclaimed)} unclaimed`,
      aria: `${n(o.roster_size)} on the roster, ${n(o.roster_unclaimed)} not yet claimed`,
    },
  ]
}

/** Small row of admin counts under the section tabs; each count links to its screen. */
export function OverviewStrip({ className }: { className?: string }) {
  const { overview, overviewError, overviewLoading, refreshOverview } = useAdmin()

  if (!overview) {
    if (overviewError) {
      return (
        <div
          role="alert"
          className={cn(
            'flex items-center justify-between gap-3 rounded-2xl border border-line bg-card px-4 py-2 text-sm text-fg-muted',
            className,
          )}
        >
          <span>Couldn&apos;t load the counts. {overviewError}</span>
          <button
            type="button"
            onClick={() => void refreshOverview()}
            disabled={overviewLoading}
            className="inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-xl px-3 font-semibold text-fg hover:bg-white/[0.06] disabled:opacity-50"
          >
            <RotateCw size={16} aria-hidden="true" className={overviewLoading ? 'animate-spin' : undefined} />
            Try again
          </button>
        </div>
      )
    }
    return (
      <div className={cn('flex gap-2', className)} aria-hidden="true">
        {Array.from({ length: 5 }, (_, i) => (
          <Skeleton key={i} className="h-16 min-w-[7rem] flex-1 rounded-xl" />
        ))}
      </div>
    )
  }

  return (
    <nav aria-label="Admin overview" className={cn('scrollbar-none -mx-4 overflow-x-auto px-4 md:mx-0 md:px-0', className)}>
      <ul className="flex gap-2">
        {tilesFor(overview).map((tile) => (
          <li key={tile.label} className="min-w-[7rem] flex-1">
            <Link
              href={tile.href}
              aria-label={tile.aria}
              className={cn(
                'flex h-full min-h-16 flex-col justify-center rounded-xl border px-3 py-2 transition-colors hover:border-line-strong',
                tile.highlight ? 'border-sffd-red/40 bg-sffd-red/10' : 'border-line bg-card',
              )}
            >
              <span aria-hidden="true" className="font-display text-2xl leading-none text-fg">
                {tile.value.toLocaleString('en-US')}
              </span>
              <span aria-hidden="true" className="mt-1 whitespace-nowrap text-xs font-medium text-fg-muted">
                {tile.label}
              </span>
              {tile.sub ? (
                <span aria-hidden="true" className="whitespace-nowrap text-[11px] text-fg-dim">
                  {tile.sub}
                </span>
              ) : null}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  )
}
