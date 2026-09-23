'use client'

import { useRef, useState } from 'react'
import Link from 'next/link'
import { SearchX, ShieldCheck } from 'lucide-react'
import AppHeader from '@/components/AppHeader'
import { OfflineRibbon } from '@/components/OfflineRibbon'
import { useProfile } from '@/components/providers/ProfileProvider'
import { EmptyState, ErrorState, buttonClasses } from '@/components/ui'
import { useRealtimeRefetch } from '@/hooks/useRealtimeRefetch'
import type { TradeDetail } from '@/lib/api'
import { formatDate } from '@/lib/sffd/dates'
import { Notice } from '@/app/(app)/board/_components/Notice'
import {
  buildTradeSummary,
  cancelState,
  chatPartners,
  legStatus,
  legsOf,
  tradeStarted,
  viewerRole,
  type PeopleLookup,
} from '../_lib/trade-model'
import { useTradeData, type TradeBundle } from '../_lib/useTradeData'
import { CancelBanner, CancelTradeCard } from './CancelSection'
import { ChatPanel } from './ChatPanel'
import { ContactCard } from './ContactCard'
import { CopySummaryButton } from './CopySummaryButton'
import { PartiesSection } from './PartiesSection'
import { PosterRequests } from './PosterRequests'
import { RequesterPanel } from './RequesterPanel'
import { TradeDetailSkeleton } from './TradeDetailSkeleton'
import { TradeOverview } from './TradeOverview'

const BACK = { href: '/trades', label: 'Back to Trades' }

export interface TradeDetailViewProps {
  /** Shift id from the URL (either SwapMatch leg). */
  id: string
  /** What the server loaded; null when it couldn't (the view retries). */
  initial: TradeDetail | null
}

/** /trades/[id]: loads the trade and picks the sections for who's looking. */
export function TradeDetailView({ id, initial }: TradeDetailViewProps) {
  const { profile } = useProfile()
  const { state, retry, retrying, refresh } = useTradeData(id, profile.id, initial)
  const originalId = state.status === 'ready' ? state.bundle.detail.shift.id : null

  useRealtimeRefetch(
    originalId
      ? [
          { table: 'shifts', filter: `id=eq.${originalId}` },
          { table: 'shifts', filter: `return_leg_of=eq.${originalId}` },
          { table: 'shift_requests', filter: `shift_id=eq.${originalId}` },
        ]
      : [],
    () => void refresh(),
    { enabled: originalId != null, name: 'trade' },
  )

  if (state.status === 'ready') {
    return (
      <TradeContent
        bundle={state.bundle}
        snapshotSavedAt={state.snapshotSavedAt}
        onRefresh={refresh}
        onRetry={retry}
        retrying={retrying}
      />
    )
  }

  return (
    <>
      <AppHeader title="Trade" back={BACK} />
      <div className="mx-auto max-w-3xl px-4 pb-8 pt-4 md:px-6">
        {state.status === 'loading' ? (
          <TradeDetailSkeleton />
        ) : state.status === 'gone' ? (
          <EmptyState
            icon={<SearchX size={28} />}
            title="This shift isn't available"
            description="It may have been removed, or your account can't see it right now."
            action={
              <Link href="/trades" className={buttonClasses({ variant: 'secondary' })}>
                Go to my trades
              </Link>
            }
          />
        ) : (
          <ErrorState
            title="Couldn't load this trade"
            message={state.error.message}
            onRetry={retry}
            retrying={retrying}
          />
        )}
      </div>
    </>
  )
}

interface TradeContentProps {
  bundle: TradeBundle
  /** Set when showing the offline snapshot. */
  snapshotSavedAt: string | null
  onRefresh: () => Promise<void>
  onRetry: () => void
  retrying: boolean
}

function TradeContent({ bundle, snapshotSavedAt, onRefresh, onRetry, retrying }: TradeContentProps) {
  const { profile, isAdmin } = useProfile()
  const me = profile.id
  const { detail, contacts, loadedAt } = bundle
  const original = detail.shift
  const legs = legsOf(detail)
  const role = viewerRole(detail, me)
  const status = legStatus(legs.viewed, loadedAt)
  const started = tradeStarted(detail, loadedAt)
  const covered = original.status === 'covered'
  const participant = covered && (role === 'poster' || role === 'coverer')
  const cancel = participant ? cancelState(original, me) : 'none'
  const offline = snapshotSavedAt != null

  const lookup: PeopleLookup = {
    me,
    myProfile: { full_name: profile.full_name, rank: profile.rank, station: profile.station },
    contacts,
    requests: detail.requests,
  }
  const summary = covered && (participant || isAdmin) ? buildTradeSummary(detail, lookup) : null
  const partners = chatPartners(detail, me)

  // "Message" on a request card opens that thread and scrolls to the chat.
  const [chatWith, setChatWith] = useState<string | null>(null)
  const chatRef = useRef<HTMLDivElement>(null)
  function openChat(memberId: string) {
    setChatWith(memberId)
    chatRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  const title = covered ? 'Trade' : original.status === 'open' && status.key === 'open' ? 'Open shift' : 'Shift'
  const subtitle = `${formatDate(legs.viewed.date, 'weekday')} · ${legs.viewed.shift_type}`

  return (
    <>
      <AppHeader title={title} subtitle={subtitle} back={BACK} />
      <div className="mx-auto max-w-3xl space-y-4 px-4 pb-8 pt-4 md:px-6">
        {offline ? (
          <div className="space-y-1.5">
            <OfflineRibbon updatedAt={snapshotSavedAt} onRetry={onRetry} retrying={retrying} />
            <p className="text-sm text-fg-muted">
              You&apos;re seeing the last copy saved on this phone. Buttons work again once you&apos;re back online.
            </p>
          </div>
        ) : null}

        {isAdmin ? (
          <Notice tone="info" title="Admin view">
            To void a trade or take down a post, use{' '}
            <Link
              href="/admin/trades"
              className="inline-flex min-h-11 items-center font-semibold text-accent-blue underline-offset-2 hover:underline"
            >
              Admin › Trades
              <ShieldCheck size={14} aria-hidden="true" className="ml-1" />
            </Link>
            .
          </Notice>
        ) : null}

        <TradeOverview detail={detail} legs={legs} status={status} nowMs={loadedAt} />

        {participant && !started && cancel !== 'none' ? (
          <CancelBanner shift={original} returnLeg={detail.returnLeg} me={me} state={cancel} disabled={offline} onChanged={onRefresh} />
        ) : null}

        <PartiesSection legs={legs} lookup={lookup} />

        {original.status === 'open' && role === 'poster' ? (
          <PosterRequests
            shift={original}
            requests={detail.requests}
            started={started}
            disabled={offline}
            onChanged={onRefresh}
            onMessage={openChat}
          />
        ) : null}

        {role !== 'poster' && (original.status === 'open' || role === 'requester') ? (
          <RequesterPanel
            shift={original}
            requests={detail.requests}
            started={started}
            disabled={offline}
            onChanged={onRefresh}
          />
        ) : null}

        {participant ? (
          <ContactCard
            contacts={contacts}
            otherId={role === 'poster' ? original.coverer_id : original.poster_id}
            otherName={role === 'poster' ? (original.coverer_name ?? 'Your trade partner') : original.poster_name}
            loading={bundle.contactsLoading}
            error={bundle.contactsError}
            onRetry={() => void onRefresh()}
          />
        ) : null}

        {summary ? <CopySummaryButton summary={summary} /> : null}

        {partners.length > 0 ? (
          <ChatPanel
            ref={chatRef}
            shiftId={original.id}
            me={me}
            partners={partners}
            selected={chatWith}
            onSelect={setChatWith}
            isPoster={role === 'poster'}
            disabled={offline}
          />
        ) : null}

        {participant ? (
          <CancelTradeCard
            shift={original}
            returnLeg={detail.returnLeg}
            me={me}
            state={cancel}
            started={started}
            disabled={offline}
            onChanged={onRefresh}
          />
        ) : null}
      </div>
    </>
  )
}
