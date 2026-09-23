'use client'

import { useEffect, useState } from 'react'
import { MessageSquare, Repeat2, Star, Trash2, Users } from 'lucide-react'
import { Avatar, Badge, Button, Card, CardHeader, ConfirmDialog, EmptyState, Skeleton, useToast } from '@/components/ui'
import { cancelPost, confirmRequest, declineRequest, getMemberCards } from '@/lib/api'
import { toAppError } from '@/lib/errors'
import { plural, relativeTime } from '@/lib/format'
import { formatDate } from '@/lib/sffd/dates'
import { stationLabel } from '@/lib/sffd/stations'
import { createClient } from '@/lib/supabase/client'
import type { MemberCard, Shift, ShiftRequest } from '@/lib/types/database'
import { isStaleDataError, toastActionError } from '@/app/(app)/board/_lib/errors'
import { currentTime } from '@/app/(app)/board/_lib/format'
import { REQUEST_STATUS_LABELS, splitRequests } from '../_lib/trade-model'

export interface PosterRequestsProps {
  /** My open post. */
  shift: Shift
  /** Every request on it (the poster sees all of them). */
  requests: readonly ShiftRequest[]
  started: boolean
  /** Actions off (offline snapshot). */
  disabled: boolean
  onChanged: () => Promise<void>
  /** Open the chat with this requester. */
  onMessage: (memberId: string) => void
}

/**
 * The poster's view of an open post: pending requests with each member's card
 * (trust score, covered/given), Confirm / Decline, earlier requests, and
 * "Cancel my post".
 */
export function PosterRequests({ shift, requests, started, disabled, onChanged, onMessage }: PosterRequestsProps) {
  const toast = useToast()
  const { pending, closed } = splitRequests(requests)
  const [confirming, setConfirming] = useState<ShiftRequest | null>(null)
  const [declining, setDeclining] = useState<ShiftRequest | null>(null)
  const [cancelling, setCancelling] = useState(false)
  const [nowMs] = useState(() => currentTime())
  const cards = useMemberCards(pending.map((r) => r.requester_id))

  // The overview already says it started without anyone confirmed.
  if (started) return null

  async function runAction(action: () => Promise<void>, fallbackTitle: string, extras?: Parameters<typeof toastActionError>[3]) {
    try {
      await action()
    } catch (err) {
      toastActionError(toast, err, fallbackTitle, extras)
      if (isStaleDataError(err)) await onChanged()
      // Keep the dialog open only when trying again could help.
      if (toAppError(err).code === 'NETWORK') throw err
    }
  }

  async function confirm(request: ShiftRequest) {
    await runAction(
      async () => {
        await confirmRequest(createClient(), request.id)
        toast.success(
          `Trade confirmed with ${request.requester_name}`,
          'You both get an alert. Remember: it still has to be entered in TeleStaff and approved.',
        )
        await onChanged()
      },
      "Couldn't confirm",
      {
        ALREADY_COVERING: `${request.requester_name} already has a shift that day. Decline this request, or message them to sort it out.`,
      },
    )
  }

  async function decline(request: ShiftRequest) {
    await runAction(async () => {
      await declineRequest(createClient(), request.id)
      toast.success('Request declined', `${request.requester_name} has been told.`)
      await onChanged()
    }, "Couldn't decline")
  }

  async function cancelMyPost() {
    await runAction(async () => {
      await cancelPost(createClient(), shift.id)
      toast.success('Post cancelled', pending.length ? 'Everyone who asked for it has been told.' : 'It’s off the board.')
      await onChanged()
    }, "Couldn't cancel your post")
  }

  return (
    <>
      <Card as="section" aria-labelledby="poster-requests-title">
        <CardHeader
          title={
            <span id="poster-requests-title">
              Requests{pending.length ? <span className="ml-2 text-base text-fg-dim">{pending.length}</span> : null}
            </span>
          }
          description={
            pending.length > 1
              ? 'Pick one. The others are declined automatically and get a polite notice.'
              : pending.length === 1
                ? 'Confirm to make the trade, or decline to keep the post open.'
                : undefined
          }
        />

        {pending.length === 0 ? (
          <EmptyState
            icon={<Users size={28} />}
            title="No requests yet"
            description="Members who can take this shift got an alert. When someone asks for it, they show up here and you get an alert too."
            className="py-6"
          />
        ) : (
          <ul className="space-y-3">
            {pending.map((r) => (
              <RequestItem
                key={r.id}
                request={r}
                card={cards.byId[r.requester_id] ?? null}
                cardLoading={cards.loading}
                nowMs={nowMs}
                disabled={disabled}
                onConfirm={() => setConfirming(r)}
                onDecline={() => setDeclining(r)}
                onMessage={() => onMessage(r.requester_id)}
              />
            ))}
          </ul>
        )}

        {closed.length > 0 ? (
          <details className="mt-4 rounded-xl border border-line px-3">
            <summary className="flex min-h-11 cursor-pointer items-center text-sm font-medium text-fg-muted">
              Earlier requests ({closed.length})
            </summary>
            <ul className="space-y-2 pb-3">
              {closed.map((r) => (
                <li key={r.id} className="flex min-h-11 items-center justify-between gap-2 text-sm">
                  <span className="min-w-0 truncate text-fg">
                    {r.requester_name}
                    <span className="text-fg-dim" suppressHydrationWarning>
                      {' '}
                      · {relativeTime(r.created_at, nowMs, { style: 'inline' })}
                    </span>
                  </span>
                  <span className="flex shrink-0 items-center gap-1">
                    <Badge tone="gray">{REQUEST_STATUS_LABELS[r.status]}</Badge>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Message ${r.requester_name}`}
                      onClick={() => onMessage(r.requester_id)}
                    >
                      <MessageSquare size={18} aria-hidden="true" />
                    </Button>
                  </span>
                </li>
              ))}
            </ul>
          </details>
        ) : null}
      </Card>

      <Card as="section" aria-labelledby="cancel-post-title" className="border-sffd-red/20">
        <CardHeader
          title={<span id="cancel-post-title">Don&apos;t need to trade anymore?</span>}
          description="Cancel your post to take it off the board. You keep working the shift."
        />
        <Button
          variant="danger"
          fullWidth
          disabled={disabled}
          icon={<Trash2 size={16} aria-hidden="true" />}
          onClick={() => setCancelling(true)}
        >
          Cancel my post
        </Button>
      </Card>

      <ConfirmDialog
        open={confirming != null}
        onClose={() => setConfirming(null)}
        onConfirm={() => (confirming ? confirm(confirming) : undefined)}
        title={confirming ? `Confirm ${confirming.requester_name}?` : 'Confirm'}
        description={
          pending.length > 1
            ? 'The other requests will be declined automatically.'
            : 'This makes the trade. You both get an alert.'
        }
        confirmLabel="Confirm trade"
      >
        {confirming ? (
          <div className="mt-3 space-y-2 text-sm text-fg-muted">
            <p>
              {confirming.requester_name} works your {formatDate(shift.date, 'weekday')} {shift.shift_type} shift.
            </p>
            {confirming.return_date ? (
              <p>
                In return, you work {confirming.requester_name}&apos;s {formatDate(confirming.return_date, 'weekday')}{' '}
                {shift.shift_type} shift.
              </p>
            ) : null}
            <p>ShiftSwap isn&apos;t the official record: enter the trade in TeleStaff so it can be approved.</p>
          </div>
        ) : null}
      </ConfirmDialog>

      <ConfirmDialog
        open={declining != null}
        onClose={() => setDeclining(null)}
        onConfirm={() => (declining ? decline(declining) : undefined)}
        title={declining ? `Decline ${declining.requester_name}?` : 'Decline'}
        description="They get an alert. Your post stays open for others."
        confirmLabel="Decline request"
        cancelLabel="Keep it"
        tone="danger"
      />

      <ConfirmDialog
        open={cancelling}
        onClose={() => setCancelling(false)}
        onConfirm={cancelMyPost}
        title="Cancel this post?"
        description={
          pending.length
            ? `It comes off the board, and ${plural(pending.length, 'member')} who asked for it will be told.`
            : 'It comes off the board. You keep working the shift.'
        }
        confirmLabel="Cancel post"
        cancelLabel="Keep it posted"
        tone="danger"
      />
    </>
  )
}

interface RequestItemProps {
  request: ShiftRequest
  /** The requester's trust score and counts; null while loading or when unavailable. */
  card: MemberCard | null
  cardLoading: boolean
  nowMs: number
  disabled: boolean
  onConfirm: () => void
  onDecline: () => void
  onMessage: () => void
}

function RequestItem({ request, card, cardLoading, nowMs, disabled, onConfirm, onDecline, onMessage }: RequestItemProps) {
  const name = request.requester_name
  return (
    <li className="rounded-xl border border-line-strong bg-elevated/50 p-3">
      <div className="flex items-start gap-3">
        <Avatar name={name} colorKey={request.requester_id} />
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-fg">{name}</p>
          <p className="text-sm text-fg-muted">
            {request.requester_rank} · {stationLabel(request.requester_station)}
            <span className="text-fg-dim" suppressHydrationWarning>
              {' '}
              · asked {relativeTime(request.created_at, nowMs, { style: 'inline' })}
            </span>
          </p>
          <MemberStats card={card} loading={cardLoading} />
        </div>
      </div>

      {request.return_date ? (
        <p className="mt-3 flex items-start gap-2 text-sm text-fg">
          <Repeat2 size={16} aria-hidden="true" className="mt-0.5 shrink-0 text-accent-purple" />
          <span>
            In return, you&apos;d work {name}&apos;s <strong>{formatDate(request.return_date, 'weekday')}</strong> shift.
          </span>
        </p>
      ) : null}

      {request.message ? (
        <p className="mt-2 whitespace-pre-line break-words rounded-lg bg-surface/60 px-3 py-2 text-sm text-fg">
          <span className="sr-only">Message: </span>“{request.message}”
        </p>
      ) : null}

      <div className="mt-3 grid grid-cols-2 gap-2">
        <Button disabled={disabled} onClick={onConfirm}>
          Confirm
        </Button>
        <Button variant="secondary" disabled={disabled} onClick={onDecline}>
          Decline
        </Button>
      </div>
      <Button
        variant="ghost"
        size="sm"
        fullWidth
        className="mt-1"
        icon={<MessageSquare size={16} aria-hidden="true" />}
        onClick={onMessage}
      >
        Message {name}
      </Button>
    </li>
  )
}

interface MemberCardsState {
  /** Cards by member id (members who aren't approved are missing). */
  byId: Readonly<Record<string, MemberCard>>
  /** True while the cards for the current requesters are loading. */
  loading: boolean
}

const NO_CARDS: Readonly<Record<string, MemberCard>> = {}

/**
 * Every requester's member card in one member_cards call (NEXT-09), reloaded
 * when the set of requesters changes. Cards already loaded stay on screen
 * meanwhile, so nothing flickers when one request is answered.
 */
function useMemberCards(userIds: readonly string[]): MemberCardsState {
  const key = [...new Set(userIds)].sort().join(',')
  const [state, setState] = useState<{ key: string; byId: Record<string, MemberCard> } | null>(null)

  useEffect(() => {
    if (!key) return
    let cancelled = false
    getMemberCards(createClient(), key.split(','))
      .then((cards) => {
        if (!cancelled) setState({ key, byId: Object.fromEntries(cards.map((c) => [c.user_id, c])) })
      })
      .catch(() => {
        // A hint only: the requests still work without it.
        if (!cancelled) setState((prev) => ({ key, byId: prev?.byId ?? {} }))
      })
    return () => {
      cancelled = true
    }
  }, [key])

  return { byId: state?.byId ?? NO_CARDS, loading: key !== '' && state?.key !== key }
}

/** Trust score and covered/given counts from member_cards (no contact details). */
function MemberStats({ card, loading }: { card: MemberCard | null; loading: boolean }) {
  if (!card && loading) {
    return (
      <span role="status" className="mt-1.5 block">
        <span className="sr-only">Loading their trade record…</span>
        <Skeleton className="h-5 w-40" />
      </span>
    )
  }
  if (!card) return <p className="mt-1.5 text-xs text-fg-dim">Trade record unavailable right now.</p>
  const { trust_score, covered, given } = card
  return (
    <p className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs text-fg-muted">
      <Badge tone={trust_score >= 80 ? 'green' : 'neutral'}>
        <Star size={12} aria-hidden="true" />
        Trust {trust_score}
      </Badge>
      <span>
        Covered {covered} · Given {given}
      </span>
    </p>
  )
}
