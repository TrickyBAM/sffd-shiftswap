import Link from 'next/link'
import { ArrowLeftRight, CalendarCheck, ChevronRight } from 'lucide-react'
import { Badge, buttonClasses, EmptyState } from '@/components/ui'
import { formatDate } from '@/lib/sffd/dates'
import { stationLabel } from '@/lib/sffd/stations'
import { DateTile, TradeLinkCard, TradeSection } from './TradeLinkCard'
import { cancelStatus, perspectiveLabel, shiftLine, type TradeGroup } from './trades-model'

export interface ConfirmedTabProps {
  me: string
  trades: TradeGroup[]
}

export function ConfirmedTab({ me, trades }: ConfirmedTabProps) {
  if (trades.length === 0) {
    return (
      <EmptyState
        icon={<CalendarCheck size={28} />}
        title="No upcoming trades"
        description="When a trade is confirmed — yours or one you picked up — it shows up here until the shift starts."
        action={
          <Link href="/board" className={buttonClasses({ variant: 'secondary' })}>
            Browse open shifts
          </Link>
        }
      />
    )
  }

  return (
    <TradeSection
      title="Upcoming trades"
      count={trades.length}
      description="Remember: every trade still needs approval in TeleStaff."
    >
      {trades.map((trade) => (
        <li key={trade.id}>{trade.isSwap ? <SwapCard trade={trade} me={me} /> : <SingleCard trade={trade} me={me} />}</li>
      ))}
    </TradeSection>
  )
}

function CancelBadge({ trade, me }: { trade: TradeGroup; me: string }) {
  const text = cancelStatus(trade.cancelRequestedBy, me, trade.partnerName)
  if (!text) return null
  return <Badge tone="yellow">{text}</Badge>
}

function SingleCard({ trade, me }: { trade: TradeGroup; me: string }) {
  const leg = trade.legs[0]
  const covering = leg.coverer_id === me
  return (
    <TradeLinkCard
      shiftId={trade.id}
      date={leg.date}
      dateTone={covering ? 'neutral' : 'red'}
      title={perspectiveLabel(leg, me)}
      subtitle={shiftLine(leg)}
    >
      <Badge tone="green">Confirmed</Badge>
      <CancelBadge trade={trade} me={me} />
    </TradeLinkCard>
  )
}

/** Both SwapMatch legs in one card: one row per date, worded from my side. */
function SwapCard({ trade, me }: { trade: TradeGroup; me: string }) {
  return (
    <Link
      href={`/trades/${trade.id}`}
      className="card-hover block rounded-2xl border border-accent-purple/25 bg-card p-4"
    >
      <div className="flex items-center gap-2">
        <ArrowLeftRight size={18} aria-hidden="true" className="shrink-0 text-accent-purple" />
        <p className="min-w-0 flex-1 font-semibold text-fg">SwapMatch with {trade.partnerName}</p>
        <ChevronRight size={20} aria-hidden="true" className="shrink-0 text-fg-dim" />
      </div>
      <ul className="mt-3 space-y-2">
        {trade.legs.map((leg) => (
          <li key={leg.id} className="flex items-center gap-3">
            <DateTile date={leg.date} tone="purple" />
            <div className="min-w-0">
              <p className="text-sm font-semibold text-fg">{perspectiveLabel(leg, me)}</p>
              <p className="text-sm text-fg-muted">
                {formatDate(leg.date, 'weekday')} · {leg.shift_type} · {stationLabel(leg.station)}
              </p>
            </div>
          </li>
        ))}
      </ul>
      {trade.legs.length === 1 ? (
        <p className="mt-2 text-sm text-fg-dim">The other date in this swap has already started.</p>
      ) : null}
      <div className="mt-3 flex flex-wrap gap-1.5">
        <Badge tone="purple">SwapMatch</Badge>
        <Badge tone="green">Confirmed</Badge>
        <CancelBadge trade={trade} me={me} />
      </div>
    </Link>
  )
}
