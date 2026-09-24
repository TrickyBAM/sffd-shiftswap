'use client'

import { useState, type FormEvent } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { AlertTriangle, CalendarX, Send } from 'lucide-react'
import { FormAlert } from '@/components/forms/FormAlert'
import { Button, buttonClasses, Card, CardHeader, EmptyState, Field, Textarea, useToast } from '@/components/ui'
import { postShift } from '@/lib/api'
import { toAppError, type AppErrorCode } from '@/lib/errors'
import type { Ymd } from '@/lib/sffd/dates'
import { SHIFT_TYPE_LIST, type ShiftType } from '@/lib/sffd/shift-types'
import { createClient } from '@/lib/supabase/client'
import type { AcceptLimit } from '@/lib/types/database'
import { LocationField } from './LocationField'
import { PostSummary } from './PostSummary'
import { SegmentedControl, type SegmentOption } from './SegmentedControl'
import { ShiftDateField } from './ShiftDateField'
import { SwapMatchField } from './SwapMatchField'
import {
  ACCEPT_LIMIT_ORDER,
  acceptLimitExplanation,
  acceptLimitLabel,
  errorField,
  firstErrorField,
  NOTES_MAX,
  parseDateParam,
  postableTourDays,
  shouldReloadAfter,
  summaryRows,
  toggleReturnDate,
  toPostInput,
  typeForDate,
  typeStarted,
  validatePost,
  type PostContext,
  type PostDraft,
  type PostField,
} from './post-model'

export interface PostFormProps {
  ctx: PostContext
  /** The poster (a MyProfile fits). */
  me: { rank: string | null; station: number | null }
  /** ?date= from the URL (validated here). */
  initialDate: string | null
  /** Called after a rule failure that means my schedule changed elsewhere. */
  onScheduleStale: () => void
}

interface ServerError {
  field: PostField | 'form'
  code: AppErrorCode
  message: string
}

/** Element ids used to move focus to the first problem. */
const FIELD_ID: Record<PostField, string> = {
  date: 'post-field-date',
  shiftType: 'post-field-type',
  station: 'post-field-station',
  returnDates: 'post-field-return',
  notes: 'post-field-notes',
}

function focusField(field: PostField) {
  requestAnimationFrame(() => document.getElementById(FIELD_ID[field])?.focus())
}

/** The "Post a shift" form (ARCHITECTURE §7.2 "Post", §6.3 post_shift). */
export function PostForm({ ctx, me, initialDate, onScheduleStale }: PostFormProps) {
  const router = useRouter()
  const toast = useToast()
  const [prefill] = useState(() => parseDateParam(initialDate, ctx))
  const [draft, setDraft] = useState<PostDraft>(() => ({
    date: prefill.date,
    shiftType: prefill.date ? typeForDate(prefill.date, '24-Hour', ctx.now) : '24-Hour',
    station: me.station,
    swapMatch: false,
    returnDates: [],
    acceptLimit: 'anyone',
    notes: '',
  }))
  const [editingStation, setEditingStation] = useState(me.station == null)
  const [touched, setTouched] = useState<ReadonlySet<PostField>>(() => new Set())
  const [submitted, setSubmitted] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [serverError, setServerError] = useState<ServerError | null>(null)

  const errors = validatePost(draft, ctx)
  const errorFor = (field: PostField): string | undefined => {
    if (serverError?.field === field) return serverError.message
    return submitted || touched.has(field) ? errors[field] : undefined
  }

  function change(fields: readonly PostField[], update: (d: PostDraft) => PostDraft) {
    setDraft(update)
    setTouched((prev) => new Set([...prev, ...fields]))
    setServerError((prev) => (prev && prev.field !== 'form' && fields.includes(prev.field) ? null : prev))
  }

  const setDate = (ymd: Ymd | null) =>
    change(['date'], (d) => ({
      ...d,
      date: ymd,
      shiftType: ymd ? typeForDate(ymd, d.shiftType, ctx.now) : d.shiftType,
      // The shift being posted can't also be a return date.
      returnDates: ymd ? d.returnDates.filter((r) => r !== ymd) : d.returnDates,
    }))

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (submitting) return
    setSubmitted(true)
    setServerError(null)
    const first = firstErrorField(validatePost(draft, ctx))
    if (first) {
      focusField(first)
      return
    }
    setSubmitting(true)
    try {
      const id = await postShift(createClient(), toPostInput(draft))
      toast.success('Posted! Eligible members are being alerted.')
      // Stay "submitting" until the trade page opens, so it can't be posted twice.
      router.push(`/trades/${encodeURIComponent(id)}`)
    } catch (err) {
      const error = toAppError(err)
      const field = errorField(error.code)
      setServerError({ field, code: error.code, message: error.message })
      toast.error("Couldn't post your shift", error.message)
      setSubmitting(false)
      if (field !== 'form') focusField(field)
      if (shouldReloadAfter(error.code)) onScheduleStale()
    }
  }

  const noticeCard = prefill.notice && !draft.date ? (
    <Card role="status" className="flex items-start gap-3 border-accent-yellow/40 bg-accent-yellow/[0.06]">
      <AlertTriangle size={20} aria-hidden="true" className="mt-0.5 shrink-0 text-accent-yellow" />
      <p className="text-[15px] text-fg">{prefill.notice}</p>
    </Card>
  ) : null

  if (ctx.tour != null && !draft.date && postableTourDays(ctx).length === 0) {
    return (
      <div className="space-y-4">
        {noticeCard}
        <EmptyState
          icon={<CalendarX size={28} />}
          title="No shifts to post"
          description={`Every Tour ${ctx.tour} shift in the next 180 days is already posted or traded.`}
          action={
            <Link href="/trades" className={buttonClasses({ variant: 'secondary' })}>
              See my trades
            </Link>
          }
        />
      </div>
    )
  }

  const typeOptions: SegmentOption<ShiftType>[] = SHIFT_TYPE_LIST.map((t) => ({
    value: t.label,
    label: t.label,
    sublabel: t.description,
    disabled: typeStarted(draft.date, t.label, ctx.now),
  }))
  const onlyPmLeft = typeStarted(draft.date, '24-Hour', ctx.now) && !typeStarted(draft.date, 'PM', ctx.now)
  const typeHint = onlyPmLeft
    ? "That day's 24-hour shift has already started, so only the PM shift can be posted."
    : 'A 24-Hour shift runs 0800 to 0800. A PM shift runs 1600 to 0800.'

  const limitOptions: SegmentOption<AcceptLimit>[] = ACCEPT_LIMIT_ORDER.map((limit) => ({
    value: limit,
    label: acceptLimitLabel(limit, draft.station, me.station),
  }))

  return (
    <form onSubmit={onSubmit} noValidate aria-busy={submitting || undefined} className="animate-fade-in-up space-y-4">
      {noticeCard}

      <Card as="section" aria-labelledby="post-when-title">
        <CardHeader title={<span id="post-when-title">Your shift</span>} />
        <div id={FIELD_ID.date} tabIndex={-1} className="scroll-mt-24 outline-none">
          <ShiftDateField ctx={ctx} value={draft.date} onChange={setDate} error={errorFor('date')} disabled={submitting} />
        </div>
        <div id={FIELD_ID.shiftType} tabIndex={-1} className="mt-5 scroll-mt-24 outline-none">
          <SegmentedControl
            legend="Shift type"
            name="shift-type"
            value={draft.shiftType}
            options={typeOptions}
            onChange={(shiftType) => change(['shiftType'], (d) => ({ ...d, shiftType }))}
            hint={typeHint}
            error={errorFor('shiftType')}
            disabled={submitting}
          />
        </div>
      </Card>

      <Card as="section" aria-labelledby="post-where-title">
        <CardHeader title={<span id="post-where-title">Location</span>} />
        <div id={FIELD_ID.station} tabIndex={-1} className="scroll-mt-24 outline-none">
          <LocationField
            value={draft.station}
            onChange={(station) => change(['station'], (d) => ({ ...d, station }))}
            myStation={me.station}
            editing={editingStation}
            onEditingChange={setEditingStation}
            error={errorFor('station')}
            disabled={submitting}
          />
        </div>
      </Card>

      <Card as="section" aria-labelledby="post-swap-title">
        <CardHeader title={<span id="post-swap-title">Shift back</span>} />
        <div id={FIELD_ID.returnDates} tabIndex={-1} className="scroll-mt-24 outline-none">
          <SwapMatchField
            ctx={ctx}
            enabled={draft.swapMatch}
            onEnabledChange={(swapMatch) => {
              // Not marked "touched": turning it on shouldn't flash "pick a day" before any tap.
              setDraft((d) => ({ ...d, swapMatch }))
              setServerError((prev) => (prev?.field === 'returnDates' ? null : prev))
            }}
            postDate={draft.date}
            shiftType={draft.shiftType}
            value={draft.returnDates}
            onToggleDate={(ymd) => change(['returnDates'], (d) => ({ ...d, returnDates: toggleReturnDate(d.returnDates, ymd) }))}
            error={draft.swapMatch ? errorFor('returnDates') : undefined}
            disabled={submitting}
          />
        </div>
      </Card>

      <Card as="section" aria-labelledby="post-who-title">
        <CardHeader title={<span id="post-who-title">Who can take it</span>} />
        <SegmentedControl
          legend="Who can take it"
          hideLegend
          name="accept-limit"
          value={draft.acceptLimit}
          options={limitOptions}
          onChange={(acceptLimit) => change([], (d) => ({ ...d, acceptLimit }))}
          hint={`${acceptLimitExplanation(draft.acceptLimit, draft.station, me.rank)} Trades are same rank only.`}
          disabled={submitting}
        />
        <div id={FIELD_ID.notes} tabIndex={-1} className="mt-5 scroll-mt-24 outline-none">
          <Field label="Notes (optional)" hint="Anything the person taking it should know." error={errorFor('notes')}>
            <Textarea
              value={draft.notes}
              maxLength={NOTES_MAX}
              showCount
              rows={3}
              disabled={submitting}
              placeholder="e.g. Truck company this rotation. Text me with questions."
              onChange={(event) => {
                const notes = event.target.value
                change(['notes'], (d) => ({ ...d, notes }))
              }}
            />
          </Field>
        </div>
      </Card>

      <PostSummary rows={summaryRows(draft, me.rank)} />

      {serverError?.field === 'form' ? (
        <FormAlert
          action={
            serverError.code === 'ACK_REQUIRED' ? (
              <Link href="/welcome" className="inline-flex min-h-11 items-center font-semibold text-accent-blue hover:underline">
                Read the TeleStaff notice
              </Link>
            ) : undefined
          }
        >
          {serverError.message}
        </FormAlert>
      ) : null}

      <div className="space-y-2">
        <Button type="submit" size="lg" fullWidth loading={submitting} icon={<Send size={18} aria-hidden="true" />}>
          {submitting ? 'Posting…' : 'Post shift'}
        </Button>
        <p className="text-center text-sm text-fg-dim">Members who can take it get an alert right away.</p>
      </div>
    </form>
  )
}
