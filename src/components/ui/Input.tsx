'use client'

import { useCallback, useId, useState, type ComponentPropsWithRef, type Ref } from 'react'
import { ChevronDown } from 'lucide-react'
import { useFieldControl } from './Field'
import { cn } from './cn'

// 16 px text (text-base) on every control: iOS Safari zooms the page when a focused
// input's font is smaller, and we no longer block zoom with maximum-scale.
const CONTROL =
  'block w-full rounded-xl border bg-elevated text-base text-fg placeholder:text-fg-dim ' +
  'transition-colors duration-150 hover:border-white/20 focus-visible:border-focus ' +
  'disabled:cursor-not-allowed disabled:opacity-60'

function stateClasses(invalid: boolean): string {
  return invalid ? 'border-sffd-red-text/70' : 'border-line-strong'
}

interface WiredProps {
  id?: string
  'aria-describedby'?: string
  'aria-required'?: boolean | 'true' | 'false'
}

/**
 * Merges Field wiring with explicit props (explicit props win).
 * <Field required> sets aria-required, not the native `required` attribute, so the
 * browser's own validation bubbles don't compete with the form's (zod) error messages.
 */
function useControlProps(props: WiredProps, invalidProp: boolean | undefined) {
  const field = useFieldControl()
  const invalid = invalidProp ?? field?.invalid ?? false
  return {
    id: props.id ?? field?.id,
    'aria-describedby': props['aria-describedby'] ?? field?.describedBy,
    'aria-required': props['aria-required'] ?? (field?.required || undefined),
    'aria-invalid': invalid || undefined,
    invalid,
  }
}

export interface InputProps extends ComponentPropsWithRef<'input'> {
  /** Force the invalid style/aria-invalid outside a <Field error>. */
  invalid?: boolean
}

export function Input({ invalid: invalidProp, className, ...props }: InputProps) {
  const { invalid, ...wiring } = useControlProps(props, invalidProp)
  return (
    <input
      {...props}
      {...wiring}
      className={cn(CONTROL, 'min-h-12 px-4 py-2.5', stateClasses(invalid), className)}
    />
  )
}

export interface SelectProps extends ComponentPropsWithRef<'select'> {
  invalid?: boolean
}

/** Native <select> (best on phones), styled to match Input with a chevron. */
export function Select({ invalid: invalidProp, className, children, ...props }: SelectProps) {
  const { invalid, ...wiring } = useControlProps(props, invalidProp)
  return (
    <div className="relative">
      <select
        {...props}
        {...wiring}
        className={cn(
          CONTROL,
          'min-h-12 appearance-none py-2.5 pl-4 pr-11',
          stateClasses(invalid),
          className,
        )}
      >
        {children}
      </select>
      <ChevronDown
        size={18}
        aria-hidden="true"
        className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-fg-dim"
      />
    </div>
  )
}

export interface TextareaProps extends ComponentPropsWithRef<'textarea'> {
  invalid?: boolean
  /** Show "12 / 500" under the box (requires maxLength). */
  showCount?: boolean
}

export function Textarea({
  invalid: invalidProp,
  showCount = false,
  className,
  ref,
  onInput,
  ...props
}: TextareaProps) {
  const { invalid, ...wiring } = useControlProps(props, invalidProp)
  const [length, setLength] = useState(() => String(props.value ?? props.defaultValue ?? '').length)

  // Works for controlled, uncontrolled and react-hook-form registered textareas:
  // measure on mount (RHF sets the value through the ref) and on every input.
  const setRefs = useCallback(
    (node: HTMLTextAreaElement | null) => {
      if (node) setLength(node.value.length)
      assignRef(ref, node)
    },
    [ref],
  )

  const fallbackId = useId()
  const counted = showCount && typeof props.maxLength === 'number'
  const countId = counted ? `${wiring.id ?? `textarea-${fallbackId}`}-count` : undefined
  const describedBy = [wiring['aria-describedby'], countId].filter(Boolean).join(' ') || undefined

  return (
    <div>
      <textarea
        rows={4}
        {...props}
        {...wiring}
        aria-describedby={describedBy}
        ref={setRefs}
        onInput={(event) => {
          setLength(event.currentTarget.value.length)
          onInput?.(event)
        }}
        className={cn(CONTROL, 'min-h-24 resize-y px-4 py-3 leading-relaxed', stateClasses(invalid), className)}
      />
      {counted ? (
        <p id={countId} className="mt-1 text-right text-xs text-fg-dim" aria-live="off">
          {typeof props.value === 'string' ? props.value.length : length} / {props.maxLength}
        </p>
      ) : null}
    </div>
  )
}

function assignRef<T>(ref: Ref<T> | undefined, value: T | null) {
  if (!ref) return
  if (typeof ref === 'function') ref(value)
  else ref.current = value
}
