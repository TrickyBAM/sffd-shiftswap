'use client'

import type { ReactNode } from 'react'
import { cn, Fieldset } from '@/components/ui'

export interface SegmentOption<T extends string> {
  value: T
  label: ReactNode
  /** Smaller second line inside the segment. */
  sublabel?: ReactNode
  disabled?: boolean
}

export interface SegmentedControlProps<T extends string> {
  legend: ReactNode
  /** Radio group name (unique on the page). */
  name: string
  value: T
  options: readonly SegmentOption<T>[]
  onChange: (value: T) => void
  hint?: ReactNode
  error?: ReactNode
  disabled?: boolean
  /** Visually hide the legend (a visible heading already names the group). */
  hideLegend?: boolean
  /** Grid columns on phones (desktop always fits every option on one row). */
  mobileColumns?: 2 | 4
  className?: string
}

/**
 * Segmented choice built from native radio buttons (arrow keys move between
 * options, the legend names the group), styled as a row of tiles.
 */
export function SegmentedControl<T extends string>({
  legend,
  name,
  value,
  options,
  onChange,
  hint,
  error,
  disabled = false,
  hideLegend = false,
  mobileColumns = 2,
  className,
}: SegmentedControlProps<T>) {
  return (
    <Fieldset legend={legend} hint={hint} error={error} hideLegend={hideLegend} className={className}>
      <div
        className={cn(
          'grid gap-2',
          mobileColumns === 4 ? 'grid-cols-4' : 'grid-cols-2',
          options.length > 2 && 'sm:grid-cols-4',
        )}
      >
        {options.map((option) => (
          <label key={option.value} className="relative block min-w-0">
            <input
              type="radio"
              name={name}
              value={option.value}
              checked={value === option.value}
              disabled={disabled || option.disabled}
              onChange={() => onChange(option.value)}
              className="peer sr-only"
            />
            <span
              className={cn(
                'flex min-h-12 cursor-pointer flex-col items-center justify-center rounded-xl border px-2 py-2 text-center',
                'border-line-strong bg-elevated text-fg-muted transition-colors hover:bg-raised hover:text-fg',
                'peer-checked:border-sffd-red/70 peer-checked:bg-sffd-red/15 peer-checked:text-fg',
                'peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-focus',
                'peer-disabled:cursor-not-allowed peer-disabled:opacity-50',
              )}
            >
              <span className="text-[15px] font-semibold leading-tight">{option.label}</span>
              {option.sublabel ? <span className="mt-0.5 text-xs text-fg-muted">{option.sublabel}</span> : null}
            </span>
          </label>
        ))}
      </div>
    </Fieldset>
  )
}
