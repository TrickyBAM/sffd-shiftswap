import type { ReactNode } from 'react'
import Link from 'next/link'
import { ChevronRight } from 'lucide-react'
import { cn } from '@/components/ui/cn'
import { formatDate, type Ymd } from '@/lib/sffd/dates'

/** Calendar-page style date block ("SEP / 30 / WED"). Decorative: the row text carries the date. */
export function DateTile({ date, tone = 'neutral' }: { date: Ymd; tone?: 'neutral' | 'red' | 'purple' | 'dim' }) {
  const [month] = formatDate(date, 'short').split(' ')
  const [weekday] = formatDate(date, 'weekday').split(',')
  return (
    <div
      aria-hidden="true"
      className={cn(
        'flex w-12 shrink-0 flex-col items-center rounded-xl border py-1.5 leading-none',
        tone === 'red' && 'border-sffd-red/40 bg-sffd-red/10',
        tone === 'purple' && 'border-accent-purple/40 bg-accent-purple/10',
        tone === 'dim' && 'border-line bg-elevated/60 opacity-80',
        tone === 'neutral' && 'border-line-strong bg-elevated',
      )}
    >
      <span className="text-[10px] font-semibold uppercase tracking-wider text-fg-muted">{month}</span>
      <span className="font-display text-2xl text-fg">{Number(date.slice(8, 10))}</span>
      <span className="text-[10px] font-medium uppercase text-fg-dim">{weekday}</span>
    </div>
  )
}

export interface TradeLinkCardProps {
  /** Shift id for /trades/<id>. */
  shiftId: string
  date: Ymd
  dateTone?: 'neutral' | 'red' | 'purple' | 'dim'
  title: ReactNode
  subtitle?: ReactNode
  /** Badges / extra lines under the subtitle. */
  children?: ReactNode
  /** Visible call to action on the right (e.g. "Choose"). Defaults to a chevron. */
  cta?: ReactNode
  /** Draw the card frame (default true). Off when the row sits inside another card. */
  framed?: boolean
  className?: string
}

/** A tappable trade row: the whole card links to the shift/trade detail page. */
export function TradeLinkCard({
  shiftId,
  date,
  dateTone,
  title,
  subtitle,
  children,
  cta,
  framed = true,
  className,
}: TradeLinkCardProps) {
  return (
    <Link
      href={`/trades/${shiftId}`}
      className={cn(
        'flex items-center gap-3 rounded-2xl p-4 text-left',
        framed && 'card-hover border border-line bg-card',
        className,
      )}
    >
      <DateTile date={date} tone={dateTone} />
      <div className="min-w-0 flex-1">
        <p className="font-semibold leading-snug text-fg">{title}</p>
        {subtitle ? <p className="mt-0.5 text-sm text-fg-muted">{subtitle}</p> : null}
        {children ? <div className="mt-2 flex flex-wrap items-center gap-1.5">{children}</div> : null}
      </div>
      {cta ?? <ChevronRight size={20} aria-hidden="true" className="shrink-0 text-fg-dim" />}
    </Link>
  )
}

/** A heading + list section inside a tab. */
export function TradeSection({
  title,
  description,
  count,
  children,
}: {
  title: string
  description?: ReactNode
  count?: number
  children: ReactNode
}) {
  return (
    <section className="space-y-2">
      <div className="flex items-baseline justify-between gap-3 px-1">
        <h2 className="font-display text-xl tracking-wide text-fg">
          {title}
          {typeof count === 'number' ? <span className="ml-2 text-base text-fg-dim">{count}</span> : null}
        </h2>
      </div>
      {description ? <p className="px-1 text-sm text-fg-muted">{description}</p> : null}
      <ul className="space-y-2">{children}</ul>
    </section>
  )
}
