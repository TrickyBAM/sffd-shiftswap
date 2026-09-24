'use client'

import { useEffect, useState, type ReactNode } from 'react'
import Link from 'next/link'
import { ArrowRight, Clock, MapPin, Repeat2, ShieldCheck } from 'lucide-react'
import {
  Avatar,
  Badge,
  Button,
  ErrorState,
  Field,
  Fieldset,
  Sheet,
  Skeleton,
  Textarea,
  buttonClasses,
  cn,
  useToast,
} from '@/components/ui'
import { useProfile } from '@/components/providers/ProfileProvider'
import { getShift, getShiftEligibility, listRequestsForShift, requestShift } from '@/lib/api'
import { toAppError, type AppError } from '@/lib/errors'
import { acceptLimitLabel, relativeTime } from '@/lib/format'
import { formatDate, type Ymd } from '@/lib/sffd/dates'
import { stationPathLabel } from '@/lib/sffd/stations'
import { createClient } from '@/lib/supabase/client'
import type { Eligibility, Shift, ShiftRequest } from '@/lib/types/database'
import { isStaleDataError, toastActionError } from '../_lib/errors'
import { currentTime, shiftTimesLabel } from '../_lib/format'
import { EligibilityReasons } from './EligibilityReasons'
import { Notice } from './Notice'
import { WithdrawRequestDialog } from './WithdrawRequestDialog'

export const REQUEST_MESSAGE_MAX = 300

export interface RequestSheetProps {
  shiftId: string
  /** The shift as already loaded (shown right away while fresh data loads). */
  initialShift?: Shift | null
  onClose: () => void
  /** After a request is sent or withdrawn (e.g. refresh the list behind). */
  onChanged?: () => void
  /** Show the "Open details" link (off on the details page itself). */
  showDetailsLink?: boolean
}

interface SheetData {
  shift: Shift | null
  eligibility: Eligibility
  /** My requests on this shift (RLS: a non-poster only sees their own). */
  myRequests: ShiftRequest[]
}

type LoadState = { status: 'loading' } | { status: 'ready'; data: SheetData } | { status: 'error'; error: AppError }

/**
 * Bottom sheet to request a shift: details, eligibility (with the reasons in
 * plain English when I can't), SwapMatch return date, optional message, and my
 * pending request with Withdraw (asks first). Mount it only while open (key it
 * by shift id).
 */
export function RequestSheet({ shiftId, initialShift = null, onClose, onChanged, showDetailsLink = true }: RequestSheetProps) {
  const { profile } = useProfile()
  const toast = useToast()
  const me = profile.id
  const [seed] = useState(initialShift)
  const [nowMs] = useState(() => currentTime())
  const [load, setLoad] = useState<LoadState>({ status: 'loading' })
  const [reloadTick, setReloadTick] = useState(0)
  const [returnDate, setReturnDate] = useState<Ymd | null>(null)
  const [message, setMessage] = useState('')
  const [submitting, setSubmitting] = useState(false)
  // The request the "Withdraw your request?" dialog is asking about.
  const [withdrawing, setWithdrawing] = useState<ShiftRequest | null>(null)

  useEffect(() => {
    let cancelled = false
    const sb = createClient()
    Promise.all([getShift(sb, shiftId), getShiftEligibility(sb, shiftId), listRequestsForShift(sb, shiftId)])
      .then(([shift, eligibility, requests]) => {
        if (cancelled) return
        setLoad({
          status: 'ready',
          data: { shift, eligibility, myRequests: requests.filter((r) => r.requester_id === me) },
        })
      })
      .catch((err: unknown) => {
        if (!cancelled) setLoad({ status: 'error', error: toAppError(err) })
      })
    return () => {
      cancelled = true
    }
  }, [shiftId, me, reloadTick])

  function reload() {
    setLoad({ status: 'loading' })
    setReloadTick((t) => t + 1)
  }

  const data = load.status === 'ready' ? load.data : null
  const shift = data ? data.shift : seed
  const pending = data?.myRequests.find((r) => r.status === 'pending') ?? null
  const isMine = shift?.poster_id === me
  const eligibility = data?.eligibility ?? null
  const validReturns = eligibility?.valid_return_dates ?? []
  const isSwap = (shift?.return_dates.length ?? 0) > 0
  const chosenReturn = returnDate ?? (validReturns.length === 1 ? validReturns[0] : null)
  const canRequest = Boolean(
    data?.shift && eligibility?.eligible && !pending && !isMine && (!isSwap || chosenReturn),
  )
  const posterName = shift?.poster_name ?? 'the poster'
  const busy = submitting

  async function submit() {
    if (!canRequest || submitting) return
    setSubmitting(true)
    try {
      await requestShift(createClient(), {
        shiftId,
        returnDate: isSwap ? chosenReturn : null,
        message,
      })
      toast.success(`Request sent to ${posterName}.`, "You'll get an alert when they answer.")
      onChanged?.()
      onClose()
    } catch (err) {
      toastActionError(toast, err, "Couldn't send your request")
      if (isStaleDataError(err)) reload()
    } finally {
      setSubmitting(false)
    }
  }

  function afterWithdraw() {
    onChanged?.()
    reload()
  }

  const detailsLink =
    showDetailsLink && shift ? (
      <Link
        href={`/trades/${shift.id}`}
        className={buttonClasses({ variant: 'ghost', size: 'sm', fullWidth: true })}
      >
        Open details
        <ArrowRight size={16} aria-hidden="true" />
      </Link>
    ) : null

  let footer: ReactNode = detailsLink
  if (data?.shift && !isMine && pending) {
    footer = (
      <div className="space-y-2">
        <Button variant="secondary" fullWidth onClick={() => setWithdrawing(pending)}>
          Withdraw my request
        </Button>
        {detailsLink}
      </div>
    )
  } else if (data?.shift && !isMine && eligibility?.eligible) {
    footer = (
      <div className="space-y-2">
        <Button fullWidth size="lg" loading={submitting} disabled={!canRequest} onClick={submit}>
          Send request
        </Button>
        {isSwap && !chosenReturn ? (
          <p className="text-center text-sm text-fg-muted">Pick a return date to send your request.</p>
        ) : null}
        {detailsLink}
      </div>
    )
  }

  return (
    <>
      <Sheet
        open
        onClose={busy ? () => {} : onClose}
        closeOnOverlay={!busy}
        closeOnEscape={!busy}
        title={isMine ? 'Your post' : 'Request this shift'}
        description={shift ? formatDate(shift.date, 'long') : undefined}
        footer={footer}
      >
        {shift ? <ShiftDetails shift={shift} nowMs={nowMs} /> : null}

        <div className="mt-4 space-y-4">
          {load.status === 'loading' ? (
            <div role="status" aria-live="polite" className="space-y-2">
              <span className="sr-only">Checking if you can take this shift…</span>
              {!shift ? <Skeleton className="h-24 w-full" /> : null}
              <Skeleton className="h-4 w-2/3" />
              <Skeleton className="h-12 w-full" />
            </div>
          ) : null}

          {load.status === 'error' ? (
            <ErrorState title="Couldn't check this shift" message={load.error.message} onRetry={reload} />
          ) : null}

          {data && !data.shift ? (
            <Notice tone="warning" title="This shift isn't available anymore">
              The member may have cancelled it, or someone else took it.
            </Notice>
          ) : null}

          {data?.shift && isMine ? (
            <Notice tone="info" title="This is your post">
              Requests from other members show up on the details page, where you can confirm one.
            </Notice>
          ) : null}

          {data?.shift && !isMine && pending ? (
            <PendingRequest request={pending} posterName={posterName} nowMs={nowMs} />
          ) : null}

          {data?.shift && !isMine && !pending && eligibility && !eligibility.eligible ? (
            <EligibilityReasons reasons={eligibility.reasons} />
          ) : null}

          {data?.shift && !isMine && !pending && eligibility?.eligible ? (
            <>
              {isSwap ? (
                <ReturnDatePicker
                  offered={data.shift.return_dates}
                  valid={validReturns}
                  value={chosenReturn}
                  onChange={setReturnDate}
                  posterName={posterName}
                  disabled={submitting}
                />
              ) : null}
              <Field
                label={`Message to ${posterName} (optional)`}
                hint="They'll see it with your request."
              >
                <Textarea
                  rows={3}
                  maxLength={REQUEST_MESSAGE_MAX}
                  showCount
                  value={message}
                  disabled={submitting}
                  onChange={(e) => setMessage(e.target.value)}
                  placeholder="e.g. Happy to swap — text me if you need anything."
                />
              </Field>
            </>
          ) : null}
        </div>
      </Sheet>

      <WithdrawRequestDialog
        request={withdrawing}
        posterName={posterName}
        onClose={() => setWithdrawing(null)}
        onChanged={afterWithdraw}
      />
    </>
  )
}

function ShiftDetails({ shift, nowMs }: { shift: Shift; nowMs: number }) {
  const limit = acceptLimitLabel(shift.accept_limit, shift.station)
  const posted = relativeTime(shift.created_at, nowMs, { style: 'inline' })
  return (
    <div className="rounded-2xl border border-line bg-elevated/60 p-4">
      <p className="font-display text-2xl leading-none text-fg">{shift.shift_type}</p>
      <ul className="mt-3 space-y-2 text-sm text-fg-muted">
        <li className="flex items-center gap-2">
          <Clock size={15} aria-hidden="true" className="shrink-0 text-fg-dim" />
          {shiftTimesLabel(shift.shift_type)}
        </li>
        <li className="flex items-center gap-2">
          <MapPin size={15} aria-hidden="true" className="shrink-0 text-fg-dim" />
          <span className="text-fg">{stationPathLabel(shift.station)}</span>
        </li>
        <li className="flex items-center gap-2">
          <Avatar name={shift.poster_name} colorKey={shift.poster_id} size="sm" />
          <span>
            <span className="font-medium text-fg">{shift.poster_name}</span> · {shift.rank}
            {posted ? <span className="text-fg-dim"> · posted {posted}</span> : null}
          </span>
        </li>
      </ul>
      {shift.return_dates.length > 0 || limit ? (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {shift.return_dates.length > 0 ? (
            <Badge tone="purple">
              <Repeat2 size={13} aria-hidden="true" />
              SwapMatch
            </Badge>
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
        <p className="mt-3 whitespace-pre-line break-words text-sm text-fg">
          <span className="sr-only">Notes: </span>“{shift.notes}”
        </p>
      ) : null}
    </div>
  )
}

function ReturnDatePicker({
  offered,
  valid,
  value,
  onChange,
  posterName,
  disabled,
}: {
  offered: readonly Ymd[]
  valid: readonly Ymd[]
  value: Ymd | null
  onChange: (date: Ymd) => void
  posterName: string
  disabled: boolean
}) {
  const unavailable = offered.filter((d) => !valid.includes(d))
  return (
    <Fieldset
      legend="Pick your return date"
      hint={
        unavailable.length > 0
          ? `${unavailable.map((d) => formatDate(d, 'short')).join(', ')} ${unavailable.length === 1 ? "doesn't" : "don't"} work with your schedule.`
          : undefined
      }
    >
      <p className="text-sm text-fg-muted">
        This is a SwapMatch: you work {posterName}&apos;s shift, and {posterName} works one of your shifts in return.
      </p>
      <div className="space-y-2">
        {valid.map((d) => (
          <label
            key={d}
            className={cn(
              'flex min-h-11 cursor-pointer items-start gap-3 rounded-xl border px-4 py-3 text-sm transition-colors',
              value === d ? 'border-accent-purple/60 bg-accent-purple/10' : 'border-line-strong bg-elevated hover:bg-raised',
              disabled && 'cursor-not-allowed opacity-60',
            )}
          >
            <input
              type="radio"
              name="return-date"
              value={d}
              checked={value === d}
              disabled={disabled}
              onChange={() => onChange(d)}
              className="mt-0.5 h-5 w-5 shrink-0 accent-accent-purple"
            />
            <span>
              <span className="font-semibold text-fg">{formatDate(d, 'weekday')}</span>
              <span className="text-fg-muted"> — you&apos;re on duty; {posterName} works it for you</span>
            </span>
          </label>
        ))}
      </div>
    </Fieldset>
  )
}

function PendingRequest({ request, posterName, nowMs }: { request: ShiftRequest; posterName: string; nowMs: number }) {
  const ago = relativeTime(request.created_at, nowMs, { style: 'inline' })
  return (
    <Notice tone="success" title="You asked for this shift">
      <span className="block">
        Sent {ago}. Waiting for {posterName} to answer — you&apos;ll get an alert.
      </span>
      {request.return_date ? (
        <span className="mt-1 block">
          In return, {posterName} works your {formatDate(request.return_date, 'weekday')} shift.
        </span>
      ) : null}
      {request.message ? <span className="mt-1 block break-words">Your message: “{request.message}”</span> : null}
    </Notice>
  )
}
