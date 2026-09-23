'use client'

import { createContext, useContext, useId, type ReactNode } from 'react'
import { cn } from './cn'

interface FieldContextValue {
  id: string
  describedBy: string | undefined
  invalid: boolean
  required: boolean
}

const FieldContext = createContext<FieldContextValue | null>(null)

/**
 * Wiring for the control inside a <Field>: id, aria-describedby, aria-invalid, required.
 * Input/Select/Textarea read it automatically; custom controls can call it too.
 */
export function useFieldControl(): FieldContextValue | null {
  return useContext(FieldContext)
}

export interface FieldProps {
  label: ReactNode
  /** Help text under the control. */
  hint?: ReactNode
  /** Validation message; also sets aria-invalid on the control. */
  error?: ReactNode
  required?: boolean
  /** Explicit control id; generated when omitted. */
  id?: string
  /** Visually hide the label (it stays available to screen readers). */
  hideLabel?: boolean
  className?: string
  children: ReactNode
}

/**
 * Label + control + hint + error, bound together with ids:
 *
 *   <Field label="Phone" hint="Only trade partners see this" error={errors.phone?.message}>
 *     <Input type="tel" autoComplete="tel" {...register('phone')} />
 *   </Field>
 */
export function Field({
  label,
  hint,
  error,
  required = false,
  id,
  hideLabel = false,
  className,
  children,
}: FieldProps) {
  const generated = useId()
  const controlId = id ?? `field-${generated}`
  const hintId = hint ? `${controlId}-hint` : undefined
  const errorId = error ? `${controlId}-error` : undefined
  const describedBy = [errorId, hintId].filter(Boolean).join(' ') || undefined

  return (
    <FieldContext.Provider value={{ id: controlId, describedBy, invalid: Boolean(error), required }}>
      <div className={cn('space-y-1.5', className)}>
        <label
          htmlFor={controlId}
          className={cn('block text-sm font-medium text-fg', hideLabel && 'sr-only')}
        >
          {label}
          {required ? (
            <span className="ml-0.5 text-sffd-red-text" aria-hidden="true">
              *
            </span>
          ) : null}
        </label>
        {children}
        {error ? (
          <p id={errorId} className="text-sm text-sffd-red-text">
            {error}
          </p>
        ) : null}
        {hint ? (
          <p id={hintId} className="text-sm text-fg-dim">
            {hint}
          </p>
        ) : null}
      </div>
    </FieldContext.Provider>
  )
}

export interface FieldsetProps {
  legend: ReactNode
  hint?: ReactNode
  error?: ReactNode
  hideLegend?: boolean
  className?: string
  children: ReactNode
}

/** Groups related controls (chips, radios, date pickers) under one accessible legend. */
export function Fieldset({ legend, hint, error, hideLegend = false, className, children }: FieldsetProps) {
  const generated = useId()
  const hintId = hint ? `fieldset-${generated}-hint` : undefined
  const errorId = error ? `fieldset-${generated}-error` : undefined
  const describedBy = [errorId, hintId].filter(Boolean).join(' ') || undefined

  return (
    <fieldset
      aria-describedby={describedBy}
      aria-invalid={error ? true : undefined}
      className={cn('min-w-0 space-y-2', className)}
    >
      <legend className={cn('mb-1.5 text-sm font-medium text-fg', hideLegend && 'sr-only')}>{legend}</legend>
      {children}
      {error ? (
        <p id={errorId} className="text-sm text-sffd-red-text">
          {error}
        </p>
      ) : null}
      {hint ? (
        <p id={hintId} className="text-sm text-fg-dim">
          {hint}
        </p>
      ) : null}
    </fieldset>
  )
}
