'use client'

import Link from 'next/link'
import { ArrowRight, Ban, ExternalLink, Repeat, Undo2 } from 'lucide-react'
import { Badge, Button, Card, buttonClasses } from '@/components/ui'
import { formatDate } from '@/lib/sffd/dates'
import { battalionLabel, stationLabel } from '@/lib/sffd/stations'
import type { Shift } from '@/lib/types/database'
import { hasStarted, swapText, tradeStatus } from '../_lib/present'

export interface TradeRowProps {
  shift: Shift
  returnLeg: Shift | null
  now: Date
  onCancelPost: (shift: Shift) => void
  onVoid: (shift: Shift) => void
}

/** One post or trade: when, where, who, status and the admin actions. */
export function TradeRow({ shift, returnLeg, now, onCancelPost, onVoid }: TradeRowProps) {
  const status = tradeStatus(shift, now)
  const swap = swapText(shift, returnLeg)
  const started = hasStarted(shift, now)

  return (
    <Card as="li" className="space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-semibold text-fg">
            {formatDate(shift.date, 'weekday')}, {shift.date.slice(0, 4)} · {shift.shift_type}
            <span className="font-normal text-fg-muted"> ({shift.hours} h)</span>
          </p>
          <p className="text-sm text-fg-muted">
            {stationLabel(shift.station)} · {battalionLabel(shift.battalion)} · {shift.rank}
          </p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <Badge tone={status.tone}>{status.label}</Badge>
          {shift.cancel_requested_by && shift.status === 'covered' ? <Badge tone="yellow">Cancel requested</Badge> : null}
          {swap ? (
            <Badge tone="purple">
              <Repeat size={12} aria-hidden="true" />
              SwapMatch
            </Badge>
          ) : null}
        </div>
      </div>

      <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
        <span className="font-medium text-fg">{shift.poster_name}</span>
        <ArrowRight size={14} aria-hidden="true" className="text-fg-dim" />
        <span className="sr-only">covered by</span>
        <span className={shift.coverer_name ? 'font-medium text-fg' : 'text-fg-muted'}>
          {shift.coverer_name ?? (shift.status === 'open' ? 'Not taken yet' : 'Nobody')}
        </span>
      </p>

      {swap ? <p className="text-sm text-accent-purple">{swap}</p> : null}
      {shift.notes ? <p className="text-sm text-fg-muted">“{shift.notes}”</p> : null}
      {shift.cancel_requested_by && shift.status === 'covered' && shift.cancel_reason ? (
        <p className="text-sm text-accent-yellow">Cancel reason: {shift.cancel_reason}</p>
      ) : null}
      {shift.status === 'cancelled' && shift.cancel_note ? (
        <p className="text-sm text-fg-muted">Note: {shift.cancel_note}</p>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <Link href={`/trades/${shift.id}`} className={buttonClasses({ variant: 'secondary', size: 'sm' })}>
          <ExternalLink size={16} aria-hidden="true" />
          Details
        </Link>
        {shift.status === 'open' ? (
          <Button
            variant="danger"
            size="sm"
            icon={<Ban size={16} aria-hidden="true" />}
            onClick={() => onCancelPost(shift)}
          >
            Take down post
          </Button>
        ) : null}
        {shift.status === 'covered' ? (
          <Button variant="danger" size="sm" icon={<Undo2 size={16} aria-hidden="true" />} onClick={() => onVoid(shift)}>
            Void trade{started ? ' (already started)' : ''}
          </Button>
        ) : null}
      </div>
    </Card>
  )
}
