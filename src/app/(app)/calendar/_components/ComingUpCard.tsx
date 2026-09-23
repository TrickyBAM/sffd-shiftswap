'use client'

import Link from 'next/link'
import { CalendarCheck, ChevronRight } from 'lucide-react'
import type { Ymd } from '@/lib/sffd/dates'
import { buttonClasses, Card, CardHeader, cn, EmptyState, ErrorState, Skeleton } from '@/components/ui'
import type { ComingUpItem } from './calendar-model'
import { TONE_DOT } from './tones'

export interface ComingUpCardProps {
  items: ComingUpItem[] | null
  loading: boolean
  errorMessage: string | null
  onRetry: () => void
  retrying: boolean
  onOpenDay: (ymd: Ymd) => void
}

/** My next five commitments: shifts I work, days someone covers me, open posts. */
export function ComingUpCard({ items, loading, errorMessage, onRetry, retrying, onOpenDay }: ComingUpCardProps) {
  return (
    <Card as="section" aria-labelledby="coming-up-title">
      <CardHeader title={<span id="coming-up-title">Coming up</span>} />

      {loading ? (
        <div role="status" aria-live="polite" className="space-y-2">
          <span className="sr-only">Loading your upcoming shifts…</span>
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-14 rounded-xl" />
          ))}
        </div>
      ) : errorMessage && !items ? (
        <ErrorState title="Couldn't load your shifts" message={errorMessage} onRetry={onRetry} retrying={retrying} className="py-6" />
      ) : !items || items.length === 0 ? (
        <EmptyState
          icon={<CalendarCheck size={28} />}
          title="Nothing coming up"
          description="Your next shifts, trades and posts will show here."
          action={
            <Link href="/board" className={buttonClasses({ variant: 'secondary', size: 'sm' })}>
              Browse open shifts
            </Link>
          }
          className="py-8"
        />
      ) : (
        <ul className="-mx-1 divide-y divide-line">
          {items.map((item) => (
            <li key={item.ymd}>
              <button
                type="button"
                onClick={() => onOpenDay(item.ymd)}
                className="flex min-h-14 w-full items-center gap-3 rounded-xl px-1 py-2.5 text-left transition-colors hover:bg-white/[0.04]"
              >
                <span aria-hidden="true" className={cn('h-3 w-3 shrink-0 rounded-full', TONE_DOT[item.tone])} />
                <span className="w-24 shrink-0 text-sm font-semibold text-fg">{item.when}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[15px] text-fg">{item.title}</span>
                  <span className="block truncate text-sm text-fg-muted">{item.detail}</span>
                </span>
                <ChevronRight size={18} aria-hidden="true" className="shrink-0 text-fg-dim" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}
