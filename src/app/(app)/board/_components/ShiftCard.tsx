import { Clock, MapPin, Repeat2, ShieldCheck } from 'lucide-react'
import { Avatar, Badge, Card } from '@/components/ui'
import { acceptLimitLabel, relativeTime } from '@/lib/format'
import { formatDate } from '@/lib/sffd/dates'
import { stationLabel } from '@/lib/sffd/stations'
import type { Shift, ShiftRequest } from '@/lib/types/database'
import { shiftTimesLabel, stationBattalionLabel } from '../_lib/format'

const MAX_RETURN_DATES_SHOWN = 3

export interface ShiftCardProps {
  shift: Shift
  /** My latest pending/declined request on this shift, if any. */
  myRequest: ShiftRequest | null
  /** The shift is my own post. */
  isMine: boolean
  /** "Now" for the posted-ago label (epoch ms). */
  nowMs: number
  onOpen: (shift: Shift) => void
}

/** One open shift on the Board. The whole card opens the request sheet. */
export function ShiftCard({ shift, myRequest, isMine, nowMs, onOpen }: ShiftCardProps) {
  const limit = acceptLimitLabel(shift.accept_limit, shift.station)
  const returns = shift.return_dates ?? []
  const shownReturns = returns.slice(0, MAX_RETURN_DATES_SHOWN)
  const moreReturns = returns.length - shownReturns.length
  const posted = relativeTime(shift.created_at, nowMs, { style: 'inline' })

  return (
    <Card
      as="li"
      padding="none"
      interactive
      className="relative has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-focus"
    >
      <div className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="font-display text-2xl leading-none tracking-wide text-fg">
              {/* Stretched button: the whole card is the tap target, the name stays short. */}
              <button
                type="button"
                onClick={() => onOpen(shift)}
                className="text-left outline-none after:absolute after:inset-0 after:rounded-2xl after:content-['']"
              >
                {shift.shift_type}
                <span className="sr-only">
                  {' '}
                  shift, {formatDate(shift.date, 'long')}, {stationLabel(shift.station)}, posted by {shift.poster_name}
                </span>
              </button>
            </h3>
            <p className="mt-1 flex items-center gap-1.5 text-sm text-fg-muted">
              <Clock size={14} aria-hidden="true" className="shrink-0" />
              {shiftTimesLabel(shift.shift_type)}
            </p>
          </div>
          <CardStatus isMine={isMine} request={myRequest} />
        </div>

        <p className="mt-3 flex items-center gap-1.5 text-sm font-medium text-fg">
          <MapPin size={15} aria-hidden="true" className="shrink-0 text-fg-dim" />
          {stationBattalionLabel(shift)}
        </p>
        <p className="mt-2 flex min-w-0 items-center gap-2 text-sm text-fg-muted">
          <Avatar name={shift.poster_name} colorKey={shift.poster_id} size="sm" />
          <span className="min-w-0 truncate">
            <span className="font-medium text-fg">{shift.poster_name}</span> · {shift.rank}
          </span>
        </p>

        {returns.length > 0 || limit ? (
          <div className="mt-3 flex flex-wrap items-center gap-1.5">
            {returns.length > 0 ? (
              <Badge tone="purple">
                <Repeat2 size={13} aria-hidden="true" />
                SwapMatch
              </Badge>
            ) : null}
            {returns.length > 0 ? (
              <span className="text-xs text-fg-muted">
                Return {returns.length === 1 ? 'date' : 'dates'}:{' '}
                {shownReturns.map((d) => formatDate(d, 'short')).join(', ')}
                {moreReturns > 0 ? ` +${moreReturns} more` : ''}
              </span>
            ) : null}
            {limit ? (
              <Badge tone="neutral">
                <ShieldCheck size={13} aria-hidden="true" />
                {limit}
              </Badge>
            ) : null}
          </div>
        ) : null}

        {shift.notes ? (
          <p className="mt-3 line-clamp-2 break-words text-sm text-fg-muted">
            <span className="sr-only">Notes: </span>“{shift.notes}”
          </p>
        ) : null}

        {posted ? <p className="mt-3 text-xs text-fg-dim">Posted {posted}</p> : null}
      </div>
    </Card>
  )
}

function CardStatus({ isMine, request }: { isMine: boolean; request: ShiftRequest | null }) {
  if (isMine) return <Badge tone="orange">Your post</Badge>
  if (request?.status === 'pending') return <Badge tone="blue">Requested</Badge>
  if (request?.status === 'declined') return <Badge tone="gray">Declined</Badge>
  return null
}
