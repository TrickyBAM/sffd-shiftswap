'use client'

import { useRef, useState } from 'react'
import Link from 'next/link'
import { ArrowRight, SearchX, ShieldCheck } from 'lucide-react'
import { OfflineRibbon } from '@/components/OfflineRibbon'
import { useProfile } from '@/components/providers/ProfileProvider'
import { EmptyState, ErrorState, buttonClasses } from '@/components/ui'
import { useRealtimeRefetch } from '@/hooks/useRealtimeRefetch'
import type { TradeDetail } from '@/lib/api'
import { formatDate } from '@/lib/sffd/dates'
import type { Shift } from '@/lib/types/database'
import { Notice } from '@/app/(app)/board/_components/Notice'
import { TRADES_BACK, tradeBackFallback } from '../_lib/back-nav'
import {
  buildTradeSummary,
  cancelState,
  chatPartners,
  currentReturnLeg,
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
import { TradeHeader } from './TradeHeader'
import { TradeOverview } from './TradeOverview'

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
      <TradeHeader title="Trade" fallback={TRADES_BACK} />
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
  const returnLeg = currentReturnLeg(detail)
  const role = viewerRole(detail, me)
  const status = legStatus(legs.viewed, loadedAt)
  const started = tradeStarted(detail, loadedAt)
  const covered = original.status === 'covered'
  const participant = covered && (role === 'poster' || role === 'coverer')
  const cancel = participant ? cancelState(original, me) : 'none'
  const offline = snapshotSavedAt != null
  const back = tradeBackFallback({ role, open: original.status === 'open', isAdmin })

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
    const chat = chatRef.current
    if (!chat) return
    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
    chat.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' })
    // Keyboard and screen reader users land on the chat too.
    chat.focus({ preventScroll: true })
  }

  const subtitle = `${formatDate(legs.viewed.date, 'weekday')} · ${legs.viewed.shift_type}`
  const offlineRibbon = offline ? (
    <div className="space-y-1.5">
      <OfflineRibbon updatedAt={snapshotSavedAt} onRetry={onRetry} retrying={retrying} />
      <p className="text-sm text-fg-muted">
        You&apos;re seeing the last copy saved on this phone. Buttons work again once you&apos;re back online.
      </p>
    </div>
  ) : null

  // An old return leg from a SwapMatch that was undone: show that leg on its
  // own. The post's current state (requests, a newer trade) lives on its page.
  if (legs.undoneLeg) {
    return (
      <>
        <TradeHeader title="Shift" subtitle={subtitle} fallback={back} />
        <div className="mx-auto max-w-3xl space-y-4 px-4 pb-8 pt-4 md:px-6">
          {offlineRibbon}
          <TradeOverview detail={detail} legs={legs} status={status} nowMs={loadedAt} />
          <UndoneLegNotice leg={legs.viewed} original={original} me={me} />
          <PartiesSection legs={legs} lookup={lookup} />
        </div>
      </>
    )
  }

  const title = covered ? 'Trade' : original.status === 'open' && status.key === 'open' ? 'Open shift' : 'Shift'

  return (
    <>
      <TradeHeader title={title} subtitle={subtitle} fallback={back} />
      <div className="mx-auto max-w-3xl space-y-4 px-4 pb-8 pt-4 md:px-6">
        {offlineRibbon}

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

        {participant && cancel !== 'none' ? (
          <CancelBanner shift={original} returnLeg={returnLeg} me={me} state={cancel} disabled={offline} onChanged={onRefresh} started={started} />
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
            returnLeg={returnLeg}
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

/** Explains an old return leg from a SwapMatch that was undone, with a link to the original shift. */
function UndoneLegNotice({ leg, original, me }: { leg: Shift; original: Shift; me: string }) {
  // getTrade falls back to the leg itself when the original isn't visible.
  const hasOriginal = original.id !== leg.id
  const whose = original.poster_id === me ? 'your' : `${original.poster_name}'s`
  return (
    <Notice
      tone="info"
      title="This SwapMatch was undone"
      actions={
        hasOriginal ? (
          <Link href={`/trades/${original.id}`} className={buttonClasses({ variant: 'secondary', size: 'sm' })}>
            View the {formatDate(original.date, 'short')} shift
            <ArrowRight size={16} aria-hidden="true" />
          </Link>
        ) : null
      }
    >
      {hasOriginal
        ? `This was the return shift for ${whose} ${formatDate(original.date, 'weekday')} shift. That trade was undone, so this return shift was cancelled. The ${formatDate(original.date, 'short')} shift's own page shows where it stands now.`
        : 'This was the return shift of a SwapMatch that was undone, so it was cancelled.'}
    </Notice>
  )
}
