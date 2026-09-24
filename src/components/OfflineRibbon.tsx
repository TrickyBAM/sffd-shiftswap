'use client'

import { CloudOff, RotateCw } from 'lucide-react'
import { formatDate, formatTimePT, todayPT } from '@/lib/sffd/dates'
import { cn } from '@/components/ui/cn'

export interface OfflineRibbonProps {
  /** When the snapshot was saved (ISO string from offline-cache, Date or epoch ms). */
  updatedAt: string | number | Date | null | undefined
  /** Shows a "Retry" button (e.g. refetch the live data). */
  onRetry?: () => void
  retrying?: boolean
  className?: string
}

function describe(updatedAt: OfflineRibbonProps['updatedAt']): string | null {
  if (updatedAt == null) return null
  const instant = updatedAt instanceof Date ? updatedAt : new Date(updatedAt)
  if (Number.isNaN(instant.getTime())) return null
  const time = formatTimePT(instant)
  const day = todayPT(instant)
  // Older than today: say which day, so a stale snapshot isn't mistaken for fresh data.
  return day === todayPT() ? time : `${formatDate(day, 'short')}, ${time}`
}

/**
 * Yellow ribbon shown above a data view that is displaying the cached snapshot
 * because the live fetch failed: "Offline snapshot · updated 3:45 PM".
 */
export function OfflineRibbon({ updatedAt, onRetry, retrying = false, className }: OfflineRibbonProps) {
  const when = describe(updatedAt)
  return (
    <div
      role="status"
      className={cn(
        'flex min-h-11 items-center gap-2 rounded-xl bg-accent-yellow px-3 py-1.5 text-sm font-semibold text-on-accent',
        className,
      )}
    >
      <CloudOff size={16} aria-hidden="true" className="shrink-0" />
      <span className="min-w-0 flex-1">
        Offline snapshot{when ? <> · updated {when}</> : null}
      </span>
      {onRetry ? (
        <button
          type="button"
          onClick={onRetry}
          disabled={retrying}
          aria-busy={retrying || undefined}
          className="-mr-1 inline-flex min-h-11 shrink-0 items-center gap-1 rounded-lg px-2 font-semibold underline-offset-2 hover:underline disabled:opacity-60"
        >
          <RotateCw size={14} aria-hidden="true" className={retrying ? 'animate-spin' : undefined} />
          Retry
        </button>
      ) : null}
    </div>
  )
}

export default OfflineRibbon
