import type { HTMLAttributes } from 'react'
import { cn } from './cn'

export type BadgeTone = 'neutral' | 'red' | 'orange' | 'blue' | 'purple' | 'green' | 'yellow' | 'gray'

// Tinted background + accent text; every text color here is ≥ 4.5:1 on its tint.
const TONES: Record<BadgeTone, string> = {
  neutral: 'bg-white/[0.06] text-fg-muted border-line-strong',
  red: 'bg-sffd-red/12 text-sffd-red-text border-sffd-red/30',
  orange: 'bg-accent-orange/12 text-accent-orange border-accent-orange/30',
  blue: 'bg-accent-blue/12 text-accent-blue border-accent-blue/30',
  purple: 'bg-accent-purple/12 text-accent-purple border-accent-purple/30',
  green: 'bg-accent-green/12 text-accent-green border-accent-green/30',
  yellow: 'bg-accent-yellow/12 text-accent-yellow border-accent-yellow/30',
  gray: 'bg-cal-covering/12 text-cal-covering border-cal-covering/30',
}

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: BadgeTone
}

/** Small, non-interactive status label ("Open", "SwapMatch", "Pending"). */
export function Badge({ tone = 'neutral', className, children, ...rest }: BadgeProps) {
  return (
    <span
      {...rest}
      className={cn(
        'inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-semibold',
        TONES[tone],
        className,
      )}
    >
      {children}
    </span>
  )
}

export interface CountBadgeProps {
  count: number
  /** Numbers above this render as "max+". */
  max?: number
  className?: string
}

/**
 * Red numeric bubble for unread counts. Decorative: the owning control's aria-label must
 * carry the number (e.g. "Alerts, 3 unread").
 */
export function CountBadge({ count, max = 99, className }: CountBadgeProps) {
  if (count <= 0) return null
  return (
    <span
      aria-hidden="true"
      className={cn(
        'inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-sffd-red px-1 text-[11px] font-bold leading-none text-white',
        className,
      )}
    >
      {count > max ? `${max}+` : count}
    </span>
  )
}
