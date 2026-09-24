'use client'

import { useMemo } from 'react'
import { useSearchParams } from 'next/navigation'
import { ErrorState, LoadingBlock, Tab, TabList, TabPanel, Tabs } from '@/components/ui'
import { OfflineRibbon } from '@/components/OfflineRibbon'
import { useProfile } from '@/components/providers/ProfileProvider'
import { BalancesTab } from './BalancesTab'
import { ConfirmedTab } from './ConfirmedTab'
import { HistoryTab } from './HistoryTab'
import { PendingTab } from './PendingTab'
import {
  activeRequests,
  buildHistory,
  groupIncoming,
  groupTrades,
  openCancelRequests,
  parseTradeTab,
  pendingActionCount,
  requestCounts,
  TRADE_TAB_LABELS,
  TRADE_TABS,
  type TradeTab,
  type TradesData,
} from './trades-model'
import { useTradesData } from './useTradesData'

/** Trades hub: Pending · Confirmed · History · Balances, tab kept in ?tab=. */
export function TradesHub() {
  const { profile } = useProfile()
  const me = profile.id
  const searchParams = useSearchParams()
  const tab = parseTradeTab(searchParams.get('tab'))
  const { state, retrying, retry, refresh, mutate } = useTradesData(me)

  function selectTab(next: string) {
    const params = new URLSearchParams(searchParams.toString())
    params.set('tab', parseTradeTab(next))
    // Native history updates stay in sync with useSearchParams without a server round trip.
    window.history.replaceState(null, '', `?${params.toString()}`)
  }

  function onWithdrawn(requestId: string) {
    mutate((data) => ({ ...data, myRequests: data.myRequests.filter((r) => r.id !== requestId) }))
    refresh()
  }

  if (state.status === 'loading') return <LoadingBlock label="Loading your trades…" cards={3} />
  if (state.status === 'error') {
    return (
      <ErrorState title="Couldn't load your trades" message={state.message} onRetry={retry} retrying={retrying} />
    )
  }

  return (
    <div className="space-y-4">
      {state.offline ? <OfflineRibbon updatedAt={state.savedAt} onRetry={retry} retrying={retrying} /> : null}
      <TradesTabs
        me={me}
        data={state.data}
        tab={tab}
        onTabChange={selectTab}
        onWithdrawn={onWithdrawn}
        onChanged={refresh}
        offline={state.offline}
      />
    </div>
  )
}

function TradesTabs({
  me,
  data,
  tab,
  onTabChange,
  onWithdrawn,
  onChanged,
  offline,
}: {
  me: string
  data: TradesData
  tab: TradeTab
  onTabChange: (tab: string) => void
  onWithdrawn: (requestId: string) => void
  /** Something changed on the server (e.g. a cancel request withdrawn): reload quietly. */
  onChanged: () => void
  offline: boolean
}) {
  // "Now" is the moment the data was loaded, so the view is stable between loads.
  const view = useMemo(() => {
    const nowMs = Date.parse(data.loadedAt)
    const groups = groupIncoming(data.incoming, nowMs)
    const trades = groupTrades(data.confirmed, me, nowMs)
    // Only cancel requests that can still be answered wait on me (TF-5).
    const cancelRequests = openCancelRequests(data.cancelRequests, data.confirmed, nowMs)
    return {
      groups,
      trades,
      cancelRequests,
      myRequests: activeRequests(data.myRequests, nowMs),
      counts: requestCounts(data.incoming),
      history: buildHistory(data.historyShifts, data.closedRequests, data.myRequests, me, nowMs, data.undone ?? []),
      pendingCount: pendingActionCount(groups, cancelRequests),
    }
  }, [data, me])

  // Only Pending gets a count: it's the one tab with things that need an
  // answer (a red bubble means "look here"), and it keeps the four tabs
  // within a 375 px phone.
  const counts: Record<TradeTab, number> = {
    pending: view.pendingCount,
    confirmed: 0,
    history: 0,
    balances: 0,
  }

  return (
    <Tabs value={tab} onValueChange={onTabChange}>
      <TabList label="Trades">
        {TRADE_TABS.map((t) => (
          <Tab key={t} value={t} count={counts[t]}>
            {TRADE_TAB_LABELS[t]}
          </Tab>
        ))}
      </TabList>

      <TabPanel value="pending">
        <PendingTab
          me={me}
          groups={view.groups}
          cancelRequests={view.cancelRequests}
          myRequests={view.myRequests}
          openPosts={data.openPosts}
          counts={view.counts}
          onWithdrawn={onWithdrawn}
          offline={offline}
        />
      </TabPanel>
      <TabPanel value="confirmed">
        <ConfirmedTab me={me} trades={view.trades} onChanged={onChanged} offline={offline} />
      </TabPanel>
      <TabPanel value="history">
        <HistoryTab items={view.history} />
      </TabPanel>
      <TabPanel value="balances">
        <BalancesTab ledger={data.ledger} stats={data.stats} shifts={[...data.confirmed, ...data.historyShifts]} />
      </TabPanel>
    </Tabs>
  )
}
