'use client'

import { useMemo } from 'react'
import { RotateCw } from 'lucide-react'
import { useProfile } from '@/components/providers/ProfileProvider'
import { Button, ErrorState, LoadingBlock } from '@/components/ui'
import { computeDays, type ScheduleDay } from '@/lib/schedule/effective'
import type { Ymd } from '@/lib/sffd/dates'
import { useClock } from '../../calendar/_components/useClock'
import { PostForm } from './PostForm'
import { lastPostableDate, type PostContext } from './post-model'
import { useMyShifts } from './useMyShifts'

export interface PostViewProps {
  /** ?date=YYYY-MM-DD from the URL (validated by the form). */
  initialDate: string | null
}

/**
 * Loads what the form needs to know about my next 180 days (days already
 * posted, traded or picked up) and then shows the form.
 */
export function PostView({ initialDate }: PostViewProps) {
  const { profile } = useProfile()
  const { today, now } = useClock()
  const last = lastPostableDate(today)
  const mine = useMyShifts(profile.id, today, last)

  const days = useMemo(() => {
    if (!mine.shifts) return null
    const list = computeDays({
      userId: profile.id,
      tour: profile.tour,
      myShifts: mine.shifts,
      today,
      fromYmd: today,
      toYmd: last,
    })
    return new Map<Ymd, ScheduleDay>(list.map((d) => [d.ymd, d]))
  }, [mine.shifts, profile.id, profile.tour, today, last])

  const ctx = useMemo<PostContext | null>(
    () => (days ? { tour: profile.tour, today, now, days } : null),
    [days, profile.tour, today, now],
  )

  if (!ctx) {
    if (mine.error) {
      return (
        <ErrorState
          title="Couldn't load your schedule"
          message={mine.error.message}
          onRetry={mine.reload}
          retrying={mine.reloading}
        />
      )
    }
    return <LoadingBlock label="Loading your shifts…" cards={3} />
  }

  return (
    <div className="space-y-4">
      {mine.error ? (
        <div role="status" className="flex items-center gap-2 rounded-xl border border-accent-yellow/40 bg-accent-yellow/[0.06] px-3 py-1.5 text-sm text-fg">
          <span className="min-w-0 flex-1">Couldn&apos;t refresh your schedule. {mine.error.message}</span>
          <Button
            variant="ghost"
            size="sm"
            onClick={mine.reload}
            loading={mine.reloading}
            icon={<RotateCw size={14} aria-hidden="true" />}
          >
            Retry
          </Button>
        </div>
      ) : null}
      <PostForm
        ctx={ctx}
        me={{ rank: profile.rank, station: profile.station }}
        initialDate={initialDate}
        onScheduleStale={mine.reload}
      />
    </div>
  )
}
