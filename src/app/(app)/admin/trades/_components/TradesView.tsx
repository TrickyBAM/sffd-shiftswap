'use client'

import { useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { ArrowLeftRight, FileDown } from 'lucide-react'
import { Button, EmptyState, ErrorState, LoadingBlock, cn, useToast } from '@/components/ui'
import { useRealtimeRefetch } from '@/hooks/useRealtimeRefetch'
import { adminCancelPost, adminVoidTrade, listAdminShifts } from '@/lib/api'
import { toAppError } from '@/lib/errors'
import { plural } from '@/lib/format'
import { formatDate, todayPT } from '@/lib/sffd/dates'
import { createClient } from '@/lib/supabase/client'
import type { Shift } from '@/lib/types/database'
import { Pager } from '../../_components/ListControls'
import { ReasonConfirmDialog } from '../../_components/ReasonConfirmDialog'
import { useAdmin } from '../../_components/AdminProvider'
import { downloadTextFile } from '../../_lib/csv'
import { useAsyncData, useDebouncedValue } from '../../_lib/useAsyncData'
import {
  DEFAULT_TRADE_FILTERS,
  EXPORT_LIMIT,
  TRADE_PAGE_SIZE,
  fetchAllTrades,
  isTradeScope,
  tradeListOptions,
  type TradeFilters,
  type TradeScope,
} from '../_lib/query'
import { hasStarted, tradesCsv } from '../_lib/present'
import { TradeFiltersBar } from './TradeFiltersBar'
import { TradeRow } from './TradeRow'

/** Placeholder "now" before the first load (nothing is rendered with it). */
const EPOCH = new Date(0)

type Pending = { kind: 'cancel' | 'void'; shift: Shift } | null

/**
 * /admin/trades — every post and trade, filterable, with take-down, void and
 * CSV export. `?status=open` (from the overview counts) picks the starting
 * filter; a link with a different status starts the filters over.
 */
export function TradesView() {
  const status = useSearchParams().get('status')
  const scope = isTradeScope(status) ? status : DEFAULT_TRADE_FILTERS.scope
  return <TradesList key={scope} initialScope={scope} />
}

function TradesList({ initialScope }: { initialScope: TradeScope }) {
  const toast = useToast()
  const { refreshOverview } = useAdmin()

  const [filters, setFilters] = useState<TradeFilters>({ ...DEFAULT_TRADE_FILTERS, scope: initialScope })
  const member = useDebouncedValue(filters.member.trim(), 300)
  const query: TradeFilters = { ...filters, member }
  const filterKey = JSON.stringify(query)
  const [page, setPage] = useState({ key: filterKey, offset: 0 })
  const offset = page.key === filterKey ? page.offset : 0
  const [pending, setPending] = useState<Pending>(null)
  const [exporting, setExporting] = useState(false)

  const trades = useAsyncData(async () => {
    const loadedAt = new Date()
    const result = await listAdminShifts(
      createClient(),
      tradeListOptions(query, { offset, limit: TRADE_PAGE_SIZE, now: loadedAt }),
    )
    return { ...result, loadedAt }
  }, `${filterKey}|${offset}`)
  // Members confirm and cancel trades all the time; keep the list current.
  useRealtimeRefetch({ table: 'shifts' }, trades.reload, { name: 'admin-trades' })

  const now = trades.data?.loadedAt ?? EPOCH
  const items = trades.data?.items ?? []
  const total = trades.data?.total ?? 0

  function afterChange() {
    trades.reload()
    void refreshOverview()
  }

  async function exportCsv() {
    if (exporting) return
    setExporting(true)
    try {
      const all = await fetchAllTrades(createClient(), query)
      if (!all.items.length) {
        toast.info('Nothing to export', 'No trades match these filters.')
        return
      }
      downloadTextFile(`shiftswap-trades-${todayPT()}.csv`, tradesCsv(all.items, all.returnLegs))
      toast.success(
        'Export ready',
        all.total > all.items.length
          ? `Saved the first ${all.items.length.toLocaleString('en-US')} of ${all.total.toLocaleString('en-US')} rows.`
          : `Saved ${plural(all.items.length, 'row')}.`,
      )
    } catch (err) {
      toast.error("Couldn't export", toAppError(err).message)
    } finally {
      setExporting(false)
    }
  }

  const describe = (shift: Shift) => `${formatDate(shift.date, 'medium')} ${shift.shift_type}`

  return (
    <div className="space-y-4">
      <TradeFiltersBar value={filters} onChange={setFilters} />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="min-h-5 text-sm text-fg-muted" aria-live="polite">
          {trades.data ? plural(total, 'result') : null}
        </p>
        <Button
          variant="secondary"
          size="sm"
          icon={<FileDown size={16} aria-hidden="true" />}
          loading={exporting}
          disabled={!trades.data || total === 0}
          onClick={() => void exportCsv()}
        >
          Export CSV
        </Button>
      </div>
      {total > EXPORT_LIMIT ? (
        <p className="text-xs text-fg-dim">Exports include the first {EXPORT_LIMIT.toLocaleString('en-US')} rows.</p>
      ) : null}

      {trades.error ? (
        <ErrorState title="Couldn't load trades" message={trades.error.message} onRetry={trades.reload} />
      ) : !trades.data ? (
        <LoadingBlock label="Loading trades…" cards={3} />
      ) : items.length === 0 ? (
        <EmptyState
          icon={<ArrowLeftRight size={28} />}
          title="Nothing here"
          description={
            filterKey === JSON.stringify(DEFAULT_TRADE_FILTERS)
              ? 'No confirmed trades coming up. Try "Open posts" or "Everything".'
              : 'No posts or trades match these filters.'
          }
        />
      ) : (
        <>
          <ul className={cn('space-y-3', trades.loading && 'opacity-60')} aria-busy={trades.loading || undefined}>
            {items.map((shift) => (
              <TradeRow
                key={shift.id}
                shift={shift}
                returnLeg={shift.return_leg_id ? (trades.data?.returnLegs.get(shift.return_leg_id) ?? null) : null}
                now={now}
                onCancelPost={(s) => setPending({ kind: 'cancel', shift: s })}
                onVoid={(s) => setPending({ kind: 'void', shift: s })}
              />
            ))}
          </ul>
          <Pager
            label="Trades"
            offset={offset}
            pageSize={TRADE_PAGE_SIZE}
            total={total}
            loading={trades.loading}
            onOffsetChange={(next) => setPage({ key: filterKey, offset: next })}
          />
        </>
      )}

      {pending?.kind === 'cancel' ? (
        <ReasonConfirmDialog
          title={`Take down ${pending.shift.poster_name}'s post?`}
          description={`The ${describe(pending.shift)} post comes off the board. Anyone who requested it is told, and so is ${pending.shift.poster_name}.`}
          confirmLabel="Take down post"
          reason="required"
          reasonHint="Shown to the poster."
          action={(reason) => adminCancelPost(createClient(), pending.shift.id, reason)}
          successTitle="Post taken down"
          failureTitle="Couldn't take down the post"
          onClose={() => setPending(null)}
          onDone={afterChange}
        />
      ) : null}

      {pending?.kind === 'void' ? (
        <ReasonConfirmDialog
          title={`Void the trade between ${pending.shift.poster_name} and ${pending.shift.coverer_name ?? 'the coverer'}?`}
          description={
            <>
              {pending.shift.poster_name} works the {describe(pending.shift)} shift again
              {pending.shift.return_leg_id ? ', and the SwapMatch return shift is cancelled too' : ''}. Both of them are
              notified.{' '}
              {!hasStarted(pending.shift, now)
                ? 'The shift goes back on the board as an open post.'
                : 'It already started, so it is marked cancelled instead of going back on the board.'}
            </>
          }
          confirmLabel="Void trade"
          reason="required"
          reasonHint="Both members see this."
          action={(reason) => adminVoidTrade(createClient(), pending.shift.id, reason)}
          successTitle="Trade voided"
          successDescription={`${pending.shift.poster_name} and ${pending.shift.coverer_name ?? 'the coverer'} were notified.`}
          failureTitle="Couldn't void the trade"
          onClose={() => setPending(null)}
          onDone={afterChange}
        />
      ) : null}
    </div>
  )
}
