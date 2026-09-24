'use client'

import type { ComponentPropsWithRef, ReactNode } from 'react'
import { buttonClasses, type ButtonStyleOptions } from './button-styles'
import { Spinner } from './Spinner'

export interface ButtonProps
  extends ComponentPropsWithRef<'button'>,
    Omit<ButtonStyleOptions, 'className'> {
  /** Shows a spinner, sets aria-busy and ignores clicks while an action is running. */
  loading?: boolean
  /** Icon shown before the label (replaced by the spinner while loading). */
  icon?: ReactNode
  /** Icon shown after the label. */
  iconRight?: ReactNode
}

export function Button({
  variant = 'primary',
  size = 'md',
  fullWidth = false,
  loading = false,
  icon,
  iconRight,
  className,
  children,
  type = 'button',
  onClick,
  ...rest
}: ButtonProps) {
  return (
    <button
      {...rest}
      type={type}
      aria-busy={loading || undefined}
      // Stay focusable while loading (disabling would drop focus to <body>) but swallow
      // clicks, including implicit form submits, so an action can't run twice.
      onClick={loading ? (event) => event.preventDefault() : onClick}
      className={buttonClasses({ variant, size, fullWidth, className })}
    >
      {loading ? <Spinner size={size === 'lg' ? 'md' : 'sm'} /> : icon}
      {children}
      {iconRight}
    </button>
  )
}
