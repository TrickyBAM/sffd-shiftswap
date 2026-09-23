'use client'

import { useId } from 'react'
import { Fieldset } from '@/components/ui'
import { cn } from '@/components/ui/cn'
import type { NotifyScope } from '@/lib/types/database'
import { NOTIFY_SCOPE_LABELS, NOTIFY_SCOPE_ORDER, notifyScopeDescription } from './profile-model'

export interface ScopeRadiosProps {
  value: NotifyScope
  onChange: (scope: NotifyScope) => void
  /** The station chosen in the form, to word the options ("New shifts in Battalion 9"). */
  station: number | null
  disabled?: boolean
  error?: string
}

/** New-shift alert scope: Off / My Station / My Battalion / My Division / Everywhere. */
export function ScopeRadios({ value, onChange, station, disabled = false, error }: ScopeRadiosProps) {
  const name = useId()
  return (
    <Fieldset
      legend="New-shift alerts"
      hint="Only for shifts you could take: same rank, on a day you're off."
      error={error}
    >
      <div className="space-y-2">
        {NOTIFY_SCOPE_ORDER.map((scope) => {
          const checked = value === scope
          const inputId = `${name}-${scope}`
          return (
            <label
              key={scope}
              htmlFor={inputId}
              className={cn(
                'flex min-h-11 cursor-pointer items-start gap-3 rounded-xl border px-3 py-2.5 transition-colors',
                checked ? 'border-sffd-red/60 bg-sffd-red/[0.08]' : 'border-line-strong bg-elevated hover:border-white/20',
                disabled && 'cursor-not-allowed opacity-60',
              )}
            >
              <input
                id={inputId}
                type="radio"
                name={name}
                value={scope}
                checked={checked}
                disabled={disabled}
                onChange={() => onChange(scope)}
                className="mt-1 h-4 w-4 shrink-0 accent-sffd-red"
              />
              <span className="min-w-0">
                <span className={cn('block text-fg', checked ? 'font-bold' : 'font-semibold')}>
                  {NOTIFY_SCOPE_LABELS[scope]}
                </span>
                <span className="block text-sm text-fg-muted">{notifyScopeDescription(scope, station)}</span>
              </span>
            </label>
          )
        })}
      </div>
    </Fieldset>
  )
}
