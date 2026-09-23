'use client'

import { useId, useMemo } from 'react'
import { Chip, Field, Input } from '@/components/ui'
import { formatDate, isYmd, monthOf, type Ymd } from '@/lib/sffd/dates'
import { tourWorks } from '@/lib/sffd/tours'
import { MonthPicker, type PickerDay } from './MonthPicker'
import {
  DATE_BLOCK_SHORT,
  dateBlock,
  lastPostableDate,
  pickerMonths,
  postableTourDays,
  type PostContext,
} from './post-model'

export interface ShiftDateFieldProps {
  ctx: PostContext
  value: Ymd | null
  onChange: (ymd: Ymd | null) => void
  error?: string
  disabled?: boolean
}

const QUICK_PICKS = 4

/**
 * Which shift to post. Tour members pick one of their upcoming tour days in a
 * month calendar (days already posted, traded or started are crossed out);
 * members without a tour type any date up to 180 days ahead.
 */
export function ShiftDateField({ ctx, value, onChange, error, disabled = false }: ShiftDateFieldProps) {
  if (ctx.tour == null) {
    return (
      <Field
        label="Shift date"
        hint={`The day your shift starts. Up to ${formatDate(lastPostableDate(ctx.today), 'medium')}.`}
        error={error}
        required
      >
        <Input
          type="date"
          min={ctx.today}
          max={lastPostableDate(ctx.today)}
          value={value ?? ''}
          disabled={disabled}
          onChange={(event) => {
            const next = event.target.value
            onChange(isYmd(next) ? next : null)
          }}
        />
      </Field>
    )
  }
  return <TourDatePicker ctx={ctx} value={value} onChange={onChange} error={error} disabled={disabled} />
}

function TourDatePicker({ ctx, value, onChange, error, disabled }: ShiftDateFieldProps) {
  const baseId = useId()
  const hintId = `${baseId}-hint`
  const errorId = `${baseId}-error`
  const statusId = `${baseId}-status`
  const postable = useMemo(() => postableTourDays(ctx), [ctx])
  const { first, last } = pickerMonths(ctx.today)

  const describeDay = (ymd: Ymd): PickerDay => {
    if (!tourWorks(ctx.tour, ymd)) return { kind: 'plain' }
    const block = dateBlock(ymd, ctx)
    if (disabled) return { kind: 'blocked', reason: 'not available right now' }
    if (block === null) return { kind: 'pick' }
    // Past tour days are just history; everything else says why it's crossed out.
    return block === 'past' ? { kind: 'plain' } : { kind: 'blocked', reason: DATE_BLOCK_SHORT[block] }
  }

  const quick = postable.slice(0, QUICK_PICKS)

  return (
    <fieldset className="min-w-0 space-y-3" aria-describedby={[error ? errorId : null, hintId].filter(Boolean).join(' ')}>
      <legend className="mb-1.5 text-sm font-medium text-fg">
        Which shift?
        <span className="ml-0.5 text-sffd-red-text" aria-hidden="true">
          *
        </span>
      </legend>

      {quick.length ? (
      <div>
        <p className="mb-1.5 text-sm text-fg-muted">Your next shifts</p>
        <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 scrollbar-none">
          {quick.map((ymd) => (
            <Chip
              key={ymd}
              selected={value === ymd}
              disabled={disabled}
              onSelectedChange={(on) => onChange(on ? ymd : null)}
            >
              {formatDate(ymd, 'weekday')}
            </Chip>
          ))}
        </div>
      </div>
      ) : null}

      <MonthPicker
        label={`Tour ${ctx.tour} shift days`}
        today={ctx.today}
        first={first}
        last={last}
        initialMonth={postable.length ? monthOf(postable[0]) : null}
        followMonth={value ? monthOf(value) : null}
        selected={value ? [value] : []}
        onToggle={(ymd) => onChange(value === ymd ? null : ymd)}
        describeDay={describeDay}
        variant="date"
        describedBy={[error ? errorId : null, hintId, statusId].filter(Boolean).join(' ')}
        invalid={Boolean(error)}
      />

      <p id={statusId} aria-live="polite" className="text-[15px] text-fg">
        {value ? (
          <>
            Selected: <span className="font-semibold">{formatDate(value, 'long')}</span>
          </>
        ) : (
          <span className="text-fg-muted">No shift selected yet.</span>
        )}
      </p>
      {error ? (
        <p id={errorId} className="text-sm text-sffd-red-text">
          {error}
        </p>
      ) : null}
      <p id={hintId} className="text-sm text-fg-dim">
        Red days are your Tour {ctx.tour} shifts you can post. Crossed-out days are already posted, traded or started.
      </p>
    </fieldset>
  )
}
