'use client'

import { useState } from 'react'
import Link from 'next/link'
import { ArrowLeftRight, CalendarCheck, ChevronRight } from 'lucide-react'
import { Badge, Button, buttonClasses, EmptyState, useToast } from '@/components/ui'
import { cn } from '@/components/ui/cn'
import { withdrawTradeCancel } from '@/lib/api'
import { errorMessage } from '@/lib/errors'
import { formatDate } from '@/lib/sffd/dates'
import { stationLabel } from '@/lib/sffd/stations'
import { createClient } from '@/lib/supabase/client'
import { DateTile, TradeLinkCard, TradeSection } from './TradeLinkCard'
import { cancelInfo, perspectiveLabel, shiftLine, type CancelInfo, type TradeGroup } from './trades-model'

export interface ConfirmedTabProps {
  me: string
  trades: TradeGroup[]
  /** Called after a change made here (a cancel request withdrawn): reload. */
  onChanged: () => void
  /** Actions are disabled while showing the offline snapshot. */
  offline: boolean
}

export function ConfirmedTab({ me, trades, onChanged, offline }: ConfirmedTabProps) {
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
        <li key={trade.id}>
          <TradeCard trade={trade} me={me} onChanged={onChanged} offline={offline} />
        </li>
      ))}
    </TradeSection>
  )
}

function TradeCard({
  trade,
  me,
  onChanged,
  offline,
}: {
  trade: TradeGroup
  me: string
  onChanged: () => void
  offline: boolean
}) {
  const info = cancelInfo(trade, me)
  const withdrawable = Boolean(info?.canWithdraw)
  const card = trade.isSwap ? (
    <SwapCard trade={trade} me={me} info={info} framed={!withdrawable} />
  ) : (
    <SingleCard trade={trade} me={me} info={info} framed={!withdrawable} />
  )
  if (!withdrawable) return card
  // A cancel request I made that can't be answered any more: let me take it back (TF-5).
  return (
    <div className={cn('rounded-2xl border bg-card', trade.isSwap ? 'border-accent-purple/25' : 'border-line')}>
      {card}
      <div className="flex justify-end border-t border-line px-3 py-2">
        <WithdrawCancelButton tradeId={trade.id} onChanged={onChanged} offline={offline} />
      </div>
    </div>
  )
}

function WithdrawCancelButton({
  tradeId,
  onChanged,
  offline,
}: {
  tradeId: string
  onChanged: () => void
  offline: boolean
}) {
  const toast = useToast()
  const [busy, setBusy] = useState(false)

  async function withdraw() {
    if (busy) return
    setBusy(true)
    try {
      await withdrawTradeCancel(createClient(), tradeId)
    } catch (error) {
      toast.error("Couldn't withdraw your cancel request", errorMessage(error))
      setBusy(false)
      return
    }
    toast.success('Cancel request withdrawn', 'The trade stays confirmed.')
    setBusy(false)
    onChanged()
  }

  return (
    <Button variant="ghost" size="sm" onClick={withdraw} loading={busy} disabled={offline}>
      Withdraw cancel request
    </Button>
  )
}

/** Cancel-request badge (inline with the other badges) and its sentence (full width). */
function CancelNote({ info }: { info: CancelInfo | null }) {
  if (!info) return null
  return (
    <>
      <Badge tone={info.tone}>{info.badge}</Badge>
      <span className="w-full text-sm text-fg-muted">{info.text}</span>
    </>
  )
}

function SingleCard({
  trade,
  me,
  info,
  framed,
}: {
  trade: TradeGroup
  me: string
  info: CancelInfo | null
  framed: boolean
}) {
  const leg = trade.legs[0]
  const covering = leg.coverer_id === me
  return (
    <TradeLinkCard
      shiftId={trade.id}
      date={leg.date}
      dateTone={covering ? 'neutral' : 'red'}
      title={perspectiveLabel(leg, me)}
      subtitle={shiftLine(leg)}
      framed={framed}
    >
      <Badge tone="green">Confirmed</Badge>
      <CancelNote info={info} />
    </TradeLinkCard>
  )
}

/** Both SwapMatch legs in one card: one row per date, worded from my side. */
function SwapCard({
  trade,
  me,
  info,
  framed,
}: {
  trade: TradeGroup
  me: string
  info: CancelInfo | null
  framed: boolean
}) {
  return (
    <Link
      href={`/trades/${trade.id}`}
      className={cn('block rounded-2xl p-4', framed && 'card-hover border border-accent-purple/25 bg-card')}
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
      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        <Badge tone="purple">SwapMatch</Badge>
        <Badge tone="green">Confirmed</Badge>
        <CancelNote info={info} />
      </div>
    </Link>
  )
}
