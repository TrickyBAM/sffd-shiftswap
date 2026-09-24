'use client'

import type { ComponentPropsWithRef, ReactNode } from 'react'
import { Check } from 'lucide-react'
import { cn } from './cn'

export interface ChipProps extends Omit<ComponentPropsWithRef<'button'>, 'onChange'> {
  /** Toggle state, exposed to assistive tech with aria-pressed. */
  selected: boolean
  onSelectedChange?: (selected: boolean) => void
  icon?: ReactNode
  /** Show a check mark when selected (default true). */
  showCheck?: boolean
}

/**
 * Toggle chip for filters ("My Battalion", "Only shifts I can take").
 * A 44 px tall button with aria-pressed; calls onSelectedChange(!selected) on click.
 */
export function Chip({
  selected,
  onSelectedChange,
  icon,
  showCheck = true,
  className,
  children,
  onClick,
  type = 'button',
  ...rest
}: ChipProps) {
  return (
    <button
      {...rest}
      type={type}
      aria-pressed={selected}
      onClick={(event) => {
        onClick?.(event)
        if (!event.defaultPrevented) onSelectedChange?.(!selected)
      }}
      className={cn(
        'inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-full border px-4 text-sm font-medium',
        'transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-50',
        selected
          ? 'border-sffd-red/60 bg-sffd-red/15 text-fg'
          : 'border-line-strong bg-elevated text-fg-muted hover:bg-raised hover:text-fg',
        className,
      )}
    >
      {selected && showCheck ? (
        <Check size={16} aria-hidden="true" className="text-sffd-red-text" />
      ) : (
        icon
      )}
      {children}
    </button>
  )
}
