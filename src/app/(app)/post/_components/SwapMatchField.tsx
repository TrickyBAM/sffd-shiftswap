'use client'

import { useId } from 'react'
import { X } from 'lucide-react'
import { cn } from '@/components/ui'
import { formatDate, monthOf, type Ymd } from '@/lib/sffd/dates'
import type { ShiftType } from '@/lib/sffd/shift-types'
import { MonthPicker, type PickerDay } from './MonthPicker'
import {
  MAX_RETURN_DATES,
  pickerMonths,
  RETURN_BLOCK_MESSAGE,
  returnDateBlock,
  type PostContext,
} from './post-model'

export interface SwapMatchFieldProps {
  ctx: PostContext
  enabled: boolean
  onEnabledChange: (enabled: boolean) => void
  /** The shift being posted (can't be offered back) and its type. */
  postDate: Ymd | null
  shiftType: ShiftType
  value: readonly Ymd[]
  onToggleDate: (ymd: Ymd) => void
  error?: string
  disabled?: boolean
}

/**
 * "Want a shift back?" switch and, when on, a calendar of my days off to offer
 * as return dates (up to 10).
 */
export function SwapMatchField({
  ctx,
  enabled,
  onEnabledChange,
  postDate,
  shiftType,
  value,
  onToggleDate,
  error,
  disabled = false,
}: SwapMatchFieldProps) {
  const baseId = useId()
  const explainId = `${baseId}-explain`
  const errorId = `${baseId}-error`
  const countId = `${baseId}-count`
  const { first, last } = pickerMonths(ctx.today)
  const full = value.length >= MAX_RETURN_DATES

  const describeDay = (ymd: Ymd): PickerDay => {
    const block = returnDateBlock(ymd, ctx, { postDate, shiftType })
    if (block === 'past' || block === 'too-far' || block === 'invalid') return { kind: 'plain' }
    if (block === 'post-date') return { kind: 'blocked', mark: 'post', reason: RETURN_BLOCK_MESSAGE[block] }
    if (block === 'working') return { kind: 'blocked', mark: 'work', reason: RETURN_BLOCK_MESSAGE[block] }
    if (block) return { kind: 'blocked', reason: RETURN_BLOCK_MESSAGE[block] }
    if (disabled) return { kind: 'blocked', reason: 'not available right now' }
    if (full) return { kind: 'blocked', reason: `you can offer up to ${MAX_RETURN_DATES} days` }
    return { kind: 'pick' }
  }

  return (
    <div className="space-y-3">
      <button
        type="button"
        role="switch"
        aria-checked={enabled}
        aria-describedby={explainId}
        disabled={disabled}
        onClick={() => onEnabledChange(!enabled)}
        className={cn(
          'flex min-h-14 w-full items-center gap-3 rounded-xl border px-4 py-3 text-left transition-colors',
          'disabled:cursor-not-allowed disabled:opacity-60',
          enabled ? 'border-cal-swap/60 bg-cal-swap/10' : 'border-line-strong bg-elevated hover:bg-raised',
        )}
      >
        <span className="min-w-0 flex-1 text-[15px] font-semibold text-fg">Want a shift back? (SwapMatch)</span>
        <span
          aria-hidden="true"
          className={cn(
            'relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors',
            enabled ? 'bg-cal-swap' : 'bg-white/15',
          )}
        >
          <span
            className={cn(
              'absolute h-5 w-5 rounded-full bg-white shadow transition-transform motion-reduce:transition-none',
              enabled ? 'translate-x-6' : 'translate-x-1',
            )}
          />
        </span>
      </button>
      <p id={explainId} className="text-sm text-fg-muted">
        {enabled
          ? 'The person who takes your shift picks one of these days, and you work their shift that day.'
          : "Off: whoever takes your shift covers you, and you'll owe them a shift."}
      </p>

      {enabled ? (
        <fieldset
          className="min-w-0 space-y-3"
          aria-describedby={[error ? errorId : null, countId].filter(Boolean).join(' ')}
        >
          <legend className="mb-1.5 text-sm font-medium text-fg">Days you could work in return</legend>
          <MonthPicker
            label="Your days off"
            today={ctx.today}
            first={first}
            last={last}
            initialMonth={postDate ? monthOf(postDate) : null}
            selected={value}
            onToggle={onToggleDate}
            describeDay={describeDay}
            variant="return"
            describedBy={[error ? errorId : null, countId].filter(Boolean).join(' ')}
            invalid={Boolean(error)}
          />

          <p id={countId} aria-live="polite" className="text-sm text-fg-muted">
            {value.length === 0
              ? `Tap your days off to offer them (up to ${MAX_RETURN_DATES}). Days with a red bar are days you work.`
              : `${value.length} of ${MAX_RETURN_DATES} days picked.`}
          </p>

          {value.length ? (
            <ul className="flex flex-wrap gap-2" aria-label="Return days you picked">
              {value.map((ymd) => (
                <li key={ymd}>
                  <button
                    type="button"
                    onClick={() => onToggleDate(ymd)}
                    disabled={disabled}
                    aria-label={`Remove ${formatDate(ymd, 'long')}`}
                    className="inline-flex min-h-11 items-center gap-1.5 rounded-full border border-cal-swap/50 bg-cal-swap/15 pl-3 pr-2 text-sm font-semibold text-fg hover:bg-cal-swap/25 disabled:opacity-50"
                  >
                    {formatDate(ymd, 'weekday')}
                    <X size={16} aria-hidden="true" className="text-fg-muted" />
                  </button>
                </li>
              ))}
            </ul>
          ) : null}

          {error ? (
            <p id={errorId} className="text-sm text-sffd-red-text">
              {error}
            </p>
          ) : null}
        </fieldset>
      ) : null}
    </div>
  )
}
