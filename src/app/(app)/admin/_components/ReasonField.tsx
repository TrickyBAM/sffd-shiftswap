'use client'

import { Field, Textarea } from '@/components/ui'

export const REASON_MAX = 500
/** Shortest reason accepted where one is required. */
export const REASON_MIN = 3

export interface ReasonFieldProps {
  value: string
  onChange: (value: string) => void
  label?: string
  hint?: string
  required?: boolean
  placeholder?: string
}

/** Labelled reason box (≤ 500 characters, with a counter) for admin actions. */
export function ReasonField({
  value,
  onChange,
  label = 'Reason',
  hint,
  required = false,
  placeholder,
}: ReasonFieldProps) {
  return (
    <Field label={label} hint={hint} required={required}>
      <Textarea
        value={value}
        onChange={(event) => onChange(event.target.value)}
        maxLength={REASON_MAX}
        showCount
        rows={3}
        placeholder={placeholder}
      />
    </Field>
  )
}

/** True when a required reason is long enough to send. */
export function reasonOk(value: string): boolean {
  return value.trim().length >= REASON_MIN
}
