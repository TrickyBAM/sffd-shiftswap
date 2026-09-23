import { Flame } from 'lucide-react'
import { cn } from '@/components/ui/cn'

const SIZES = {
  sm: { text: 'text-lg', icon: 18 },
  lg: { text: 'text-5xl', icon: 36 },
} as const

export interface BrandMarkProps {
  size?: keyof typeof SIZES
  className?: string
}

/** "SFFD ShiftSwap" wordmark in the display font. Decorative text, not a heading. */
export function BrandMark({ size = 'lg', className }: BrandMarkProps) {
  const { text, icon } = SIZES[size]
  return (
    <span className={cn('inline-flex items-center gap-2 font-display leading-none tracking-wide text-fg', text, className)}>
      <Flame size={icon} aria-hidden="true" className="shrink-0 text-sffd-red-text" />
      <span>
        SFFD Shift<span className="text-sffd-red-text">Swap</span>
      </span>
    </span>
  )
}
