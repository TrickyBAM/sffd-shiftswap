'use client'

import { useState } from 'react'
import { Undo2 } from 'lucide-react'
import { Button, Card, CardHeader, ConfirmDialog, Field, Textarea, useToast } from '@/components/ui'
import { requestTradeCancel, respondTradeCancel, withdrawTradeCancel } from '@/lib/api'
import { toAppError } from '@/lib/errors'
import { relativeTime } from '@/lib/format'
import { formatDate } from '@/lib/sffd/dates'
import { createClient } from '@/lib/supabase/client'
import type { Shift } from '@/lib/types/database'
import { Notice } from '@/app/(app)/board/_components/Notice'
import { isStaleDataError, toastActionError, type ErrorExtras } from '@/app/(app)/board/_lib/errors'
import { currentTime } from '@/app/(app)/board/_lib/format'
import { otherPartyName, type CancelState } from '../_lib/trade-model'

export const CANCEL_REASON_MAX = 500

/** How the cancel flow explains ALREADY_COVERING and STARTED (ARCHITECTURE §9). */
const CANCEL_EXTRAS: ErrorExtras = {
  ALREADY_COVERING:
    'Undoing this trade would put one of you on two shifts the same day. Sort out the other shift first, or ask an admin to void this trade.',
  STARTED: 'Once either shift has started, only an admin can void the trade.',
}

interface CancelProps {
  /** The original (covered) leg — holds the cancel request. */
  shift: Shift
  returnLeg: Shift | null
  me: string
  state: CancelState
  /** Actions off (offline snapshot). */
  disabled: boolean
  onChanged: () => Promise<void>
  /**
   * Either leg has started: agreeing is no longer possible (only an admin can
   * void it), but the request can still be withdrawn or declined so it never
   * sits there unanswerable.
   */
  started?: boolean
}

/** What agreeing to cancel does, from my side. */
function undoEffect(shift: Shift, returnLeg: Shift | null, me: string): string {
  const back =
    shift.poster_id === me
      ? `Your ${formatDate(shift.date, 'weekday')} shift comes back to you and goes back on the board.`
      : `The ${formatDate(shift.date, 'weekday')} shift goes back to ${shift.poster_name} and back on the board.`
  const swap = returnLeg ? ` The ${formatDate(returnLeg.date, 'weekday')} return shift is cancelled too.` : ''
  return `${back}${swap}`
}

function useCancelAction(onChanged: () => Promise<void>) {
  const toast = useToast()
  return async function run(action: () => Promise<void>, fallbackTitle: string): Promise<void> {
    try {
      await action()
    } catch (err) {
      toastActionError(toast, err, fallbackTitle, CANCEL_EXTRAS)
      if (isStaleDataError(err)) await onChanged()
      // Keep a dialog open only when trying again could help.
      if (toAppError(err).code === 'NETWORK') throw err
    }
  }
}

/**
 * A cancel request is waiting: the other member asked (Agree / Keep the
 * trade), or I asked (Withdraw).
 */
export function CancelBanner({ shift, returnLeg, me, state, disabled, onChanged, started = false }: CancelProps) {
  const toast = useToast()
  const run = useCancelAction(onChanged)
  const [agreeing, setAgreeing] = useState(false)
  const [busy, setBusy] = useState<'decline' | 'withdraw' | null>(null)
  const [nowMs] = useState(() => currentTime())
  const other = otherPartyName(shift, me)
  const asked = relativeTime(shift.cancel_requested_at, nowMs, { style: 'inline' })

  async function keepTrade() {
    setBusy('decline')
    try {
      await run(async () => {
        await respondTradeCancel(createClient(), shift.id, false)
        toast.success('The trade stays confirmed', `${other} has been told.`)
        await onChanged()
      }, "Couldn't answer")
    } catch {
      // Already shown as a toast.
    } finally {
      setBusy(null)
    }
  }

  async function withdraw() {
    setBusy('withdraw')
    try {
      await run(async () => {
        await withdrawTradeCancel(createClient(), shift.id)
        toast.success('Cancel request withdrawn', 'The trade stays confirmed.')
        await onChanged()
      }, "Couldn't withdraw")
    } catch {
      // Already shown as a toast.
    } finally {
      setBusy(null)
    }
  }

  if (state === 'mine') {
    return (
      <Notice
        tone="info"
        title="You asked to cancel this trade"
        actions={
          <Button variant="secondary" loading={busy === 'withdraw'} disabled={disabled} onClick={withdraw}>
            Withdraw my cancel request
          </Button>
        }
      >
        <span className="block" suppressHydrationWarning>
          {started
            ? `Sent ${asked}. The trade has started, so it can't be cancelled here any more — withdraw this request, and ask an admin if the trade needs to be voided.`
            : `Sent ${asked}. Waiting for ${other} to answer. Until they agree, the trade stands.`}
        </span>
        {shift.cancel_reason ? <span className="mt-1 block break-words">Your reason: “{shift.cancel_reason}”</span> : null}
      </Notice>
    )
  }

  if (state !== 'theirs') return null

  return (
    <>
      <Notice
        tone="warning"
        title={`${other} asked to cancel this trade`}
        actions={
          <>
            {started ? null : (
              <Button variant="danger" disabled={disabled || busy != null} onClick={() => setAgreeing(true)}>
                Agree to cancel
              </Button>
            )}
            <Button variant="secondary" loading={busy === 'decline'} disabled={disabled} onClick={keepTrade}>
              {started ? 'Dismiss — keep the trade' : 'Decline'}
            </Button>
          </>
        }
      >
        {shift.cancel_reason ? <span className="block break-words">Reason: “{shift.cancel_reason}”</span> : null}
        <span className="mt-1 block" suppressHydrationWarning>
          {started
            ? `Asked ${asked}. The trade has started, so only an admin can void it now. Dismiss the request to keep things tidy.`
            : `Asked ${asked}. Both of you must agree. If you decline, the trade stays confirmed and ${other} is told.`}
        </span>
      </Notice>

      <ConfirmDialog
        open={agreeing}
        onClose={() => setAgreeing(false)}
        onConfirm={() =>
          run(async () => {
            await respondTradeCancel(createClient(), shift.id, true)
            toast.success('Trade cancelled', 'You both get an alert. If it was entered in TeleStaff, update it there too.')
            await onChanged()
          }, "Couldn't cancel the trade")
        }
        title="Cancel this trade?"
        description={undoEffect(shift, returnLeg, me)}
        confirmLabel="Yes, cancel it"
        cancelLabel="Not yet"
        tone="danger"
      >
        <p className="mt-3 text-sm text-fg-muted">If the trade was already entered in TeleStaff, update it there too.</p>
      </ConfirmDialog>
    </>
  )
}

export interface CancelTradeCardProps extends CancelProps {
  started: boolean
}

/** Bottom of a confirmed trade: "Ask to cancel this trade", or why it can't be changed now. */
export function CancelTradeCard({ shift, returnLeg, me, state, started, disabled, onChanged }: CancelTradeCardProps) {
  const toast = useToast()
  const run = useCancelAction(onChanged)
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState('')
  const other = otherPartyName(shift, me)
  const iWork = shift.coverer_id === me

  if (started) {
    return (
      <Notice tone="info" title="This trade has started">
        It can&apos;t be cancelled in ShiftSwap anymore. If something is wrong, contact an admin.
      </Notice>
    )
  }
  if (state !== 'none') return null

  return (
    <>
      <Card as="section" aria-labelledby="cancel-trade-title">
        <CardHeader
          title={<span id="cancel-trade-title">Need to back out?</span>}
          description="A confirmed trade is only undone if both of you agree."
        />
        <Button
          variant="danger"
          fullWidth
          disabled={disabled}
          icon={<Undo2 size={16} aria-hidden="true" />}
          onClick={() => setOpen(true)}
        >
          Ask to cancel this trade
        </Button>
      </Card>

      <ConfirmDialog
        open={open}
        onClose={() => setOpen(false)}
        onConfirm={() =>
          run(async () => {
            await requestTradeCancel(createClient(), shift.id, reason)
            toast.success('Cancel request sent', `${other} gets an alert and can agree or decline.`)
            setReason('')
            await onChanged()
          }, "Couldn't send your cancel request")
        }
        title="Ask to cancel this trade?"
        description={`Both of you must agree. ${other} gets an alert and can agree or decline. Until then the trade stands${iWork ? ' and you still work the shift' : ` and ${other} still works the shift`}.`}
        confirmLabel="Send cancel request"
        cancelLabel="Keep the trade"
        tone="danger"
      >
        <div className="mt-4">
          <Field label="Reason (optional)" hint={`${other} will see it.`}>
            <Textarea
              rows={3}
              maxLength={CANCEL_REASON_MAX}
              showCount
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Family emergency — sorry for the short notice."
            />
          </Field>
          {returnLeg ? (
            <p className="mt-2 text-sm text-fg-muted">
              If {other} agrees, the {formatDate(returnLeg.date, 'weekday')} return shift is cancelled too.
            </p>
          ) : null}
        </div>
      </ConfirmDialog>
    </>
  )
}
