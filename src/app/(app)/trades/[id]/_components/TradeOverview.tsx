import { Clock, MapPin, Repeat2, ShieldCheck } from 'lucide-react'
import { Badge, Card } from '@/components/ui'
import type { TradeDetail } from '@/lib/api'
import { acceptLimitLabel, relativeTime } from '@/lib/format'
import { formatDate } from '@/lib/sffd/dates'
import { stationPathLabel } from '@/lib/sffd/stations'
import { listDates, shiftTimesLabel, ymdOfInstant } from '@/app/(app)/board/_lib/format'
import { isSwapMatch, type Legs, type TradeStatusInfo } from '../_lib/trade-model'

export interface TradeOverviewProps {
  detail: TradeDetail
  legs: Legs
  status: TradeStatusInfo
  /** "Now" for posted-ago (epoch ms). */
  nowMs: number
}

/** The shift itself: status, date, type and hours, location, and the post's details. */
export function TradeOverview({ detail, legs, status, nowMs }: TradeOverviewProps) {
  const { viewed, viewingReturnLeg } = legs
  const original = detail.shift
  const swap = isSwapMatch(detail)
  const openOffer = original.status === 'open' && !viewingReturnLeg
  const limit = openOffer ? acceptLimitLabel(original.accept_limit, original.station) : null
  const posted = relativeTime(viewed.created_at, nowMs, { style: 'inline' })
  const cancelledOn = ymdOfInstant(viewed.cancelled_at)

  return (
    <Card as="section" aria-labelledby="trade-overview-title">
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge tone={status.tone}>{status.label}</Badge>
        {swap ? (
          <Badge tone="purple">
            <Repeat2 size={13} aria-hidden="true" />
            {viewingReturnLeg ? 'SwapMatch return shift' : 'SwapMatch'}
          </Badge>
        ) : null}
        {limit ? (
          <Badge tone="neutral">
            <ShieldCheck size={13} aria-hidden="true" />
            {limit}
          </Badge>
        ) : null}
      </div>

      <h2 id="trade-overview-title" className="mt-3 font-display text-3xl leading-none tracking-wide text-fg">
        {formatDate(viewed.date, 'long')}
      </h2>

      <ul className="mt-3 space-y-2 text-sm text-fg-muted">
        <li className="flex items-center gap-2">
          <Clock size={15} aria-hidden="true" className="shrink-0 text-fg-dim" />
          <span>
            <span className="font-medium text-fg">{viewed.shift_type}</span> · {shiftTimesLabel(viewed.shift_type)}
          </span>
        </li>
        <li className="flex items-center gap-2">
          <MapPin size={15} aria-hidden="true" className="shrink-0 text-fg-dim" />
          <span className="text-fg">{stationPathLabel(viewed.station)}</span>
        </li>
      </ul>

      {openOffer && original.return_dates.length > 0 ? (
        <p className="mt-3 text-sm text-fg-muted">
          <span className="font-medium text-fg">SwapMatch:</span> {original.poster_name} will work one of these days
          in return: {listDates(original.return_dates, 'weekday')}.
        </p>
      ) : null}

      {viewed.notes ? (
        <p className="mt-3 whitespace-pre-line break-words rounded-xl bg-elevated/60 px-3 py-2 text-sm text-fg">
          <span className="sr-only">Notes: </span>“{viewed.notes}”
        </p>
      ) : null}

      {viewed.status === 'cancelled' ? (
        <p className="mt-3 text-sm text-fg-muted">
          Cancelled{cancelledOn ? ` on ${formatDate(cancelledOn, 'medium')}` : ''}.
          {viewed.cancel_note ? <span className="break-words"> Note: “{viewed.cancel_note}”</span> : null}
        </p>
      ) : status.key === 'started' && viewed.status === 'open' ? (
        <p className="mt-3 text-sm text-fg-muted">This shift started before anyone was confirmed for it.</p>
      ) : null}

      {posted && !viewingReturnLeg ? <p className="mt-3 text-xs text-fg-dim" suppressHydrationWarning>Posted {posted}</p> : null}
    </Card>
  )
}
