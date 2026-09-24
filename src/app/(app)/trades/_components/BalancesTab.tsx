import Link from 'next/link'
import { ArrowDownLeft, ArrowUpRight, Equal, Scale } from 'lucide-react'
import { Avatar, Badge, Card, EmptyState } from '@/components/ui'
import { cn } from '@/components/ui/cn'
import { plural } from '@/lib/format'
import { formatDate } from '@/lib/sffd/dates'
import { SHIFT_TYPE_VALUES } from '@/lib/sffd/shift-types'
import type { LedgerRow, MyStats, Shift } from '@/lib/types/database'
import { TradeSection } from './TradeLinkCard'
import {
  BALANCE_TONE,
  balanceLines,
  balanceSummary,
  balanceToneClass,
  latestTradeWith,
  signed,
  sortLedger,
  type BalanceDirection,
} from './trades-model'

export interface BalancesTabProps {
  ledger: LedgerRow[]
  stats: MyStats
  /** Loaded trades, used to link each partner to our latest trade. */
  shifts: Shift[]
}

export function BalancesTab({ ledger, stats, shifts }: BalancesTabProps) {
  const rows = sortLedger(ledger)
  return (
    <div className="space-y-6">
      <Totals stats={stats} />
      {rows.length === 0 ? (
        <EmptyState
          icon={<Scale size={28} />}
          title="No balances yet"
          description="After your first trade you'll see who owes whom here, per shift type."
        />
      ) : (
        <TradeSection title="By member" count={rows.length}>
          {rows.map((row) => (
            <li key={row.partner_id}>
              <PartnerCard row={row} latest={latestTradeWith(row.partner_id, shifts)} />
            </li>
          ))}
        </TradeSection>
      )}
    </div>
  )
}

function Totals({ stats }: { stats: MyStats }) {
  const balance = stats.covered - stats.given
  return (
    <Card as="section" aria-labelledby="balances-totals">
      <h2 id="balances-totals" className="font-display text-xl tracking-wide text-fg">
        Your totals
      </h2>
      <dl className="mt-3 grid grid-cols-3 gap-2 text-center">
        <Stat label="Covered" value={String(stats.covered)} />
        <Stat label="Given" value={String(stats.given)} />
        <Stat label="Balance" value={signed(balance)} className={balanceToneClass(balance)} />
      </dl>
      <p className="mt-1 text-center text-xs text-fg-dim">Balance = Covered − Given</p>
      <p className="mt-3 text-sm text-fg-muted">{balanceSummary(stats)}</p>
      <ul className="mt-3 space-y-1 border-t border-line pt-3 text-sm">
        {SHIFT_TYPE_VALUES.map((type) => {
          const t = stats.by_type?.[type] ?? { covered: 0, given: 0, balance: 0 }
          return (
            <li key={type} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-0.5">
              <span className="text-fg">{type}</span>
              <span className="text-fg-muted">
                Covered {t.covered} · Given {t.given} · Balance{' '}
                <span className="font-semibold text-fg">{signed(t.covered - t.given)}</span>
              </span>
            </li>
          )
        })}
      </ul>
    </Card>
  )
}

function Stat({ label, value, className }: { label: string; value: string; className?: string }) {
  return (
    <div className="rounded-xl bg-elevated px-2 py-3">
      <dt className="text-xs font-medium uppercase tracking-wide text-fg-dim">{label}</dt>
      <dd className={cn('font-display text-3xl leading-none text-fg', className)}>{value}</dd>
    </div>
  )
}

const DIRECTION_ICON: Record<BalanceDirection, typeof Equal> = {
  owed: ArrowDownLeft,
  owe: ArrowUpRight,
  even: Equal,
}

const DIRECTION_CLASS: Record<BalanceDirection, string> = {
  owed: BALANCE_TONE.ahead.text,
  owe: BALANCE_TONE.behind.text,
  even: 'text-fg-dim',
}

function PartnerCard({ row, latest }: { row: LedgerRow; latest: Shift | null }) {
  const lines = balanceLines(row)
  const iCovered = row.i_covered_24 + row.i_covered_pm
  const theyCovered = row.they_covered_24 + row.they_covered_pm
  return (
    <Card>
      <div className="flex items-start gap-3">
        <Avatar name={row.partner_name} colorKey={row.partner_id} />
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-fg">{row.partner_name}</p>
          {row.partner_rank ? <p className="text-sm text-fg-dim">{row.partner_rank}</p> : null}
          <ul className="mt-2 space-y-1">
            {lines.map((line) => {
              const Icon = DIRECTION_ICON[line.direction]
              return (
                <li key={line.text} className="flex items-center gap-2 text-sm font-semibold text-fg">
                  <Icon size={16} aria-hidden="true" className={cn('shrink-0', DIRECTION_CLASS[line.direction])} />
                  {line.text}
                </li>
              )
            })}
          </ul>
          <p className="mt-2 text-sm text-fg-muted">
            You covered {iCovered} · they covered {theyCovered}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {/* my_ledger counts a SwapMatch (two dates) as one trade (TF-8). */}
            {row.upcoming > 0 ? <Badge>{plural(row.upcoming, 'upcoming trade')}</Badge> : null}
            {latest ? (
              <Link
                href={`/trades/${latest.id}`}
                className="inline-flex min-h-11 items-center text-sm font-semibold text-accent-blue underline-offset-2 hover:underline"
              >
                Latest trade: {formatDate(latest.date, 'short')}
              </Link>
            ) : row.last_date ? (
              <span className="text-sm text-fg-dim">Last trade {formatDate(row.last_date, 'medium')}</span>
            ) : null}
          </div>
        </div>
      </div>
    </Card>
  )
}
