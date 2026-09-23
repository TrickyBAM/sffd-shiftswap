import { ArrowLeftRight } from 'lucide-react'
import { cn } from '@/components/ui'
import type { BarKind } from './calendar-model'
import { BAR_CLASS } from './tones'

export interface BarMarkProps {
  kind: BarKind
  /** The open-shift count, for 'available'. */
  count?: number
  className?: string
}

/**
 * One mark in a calendar cell (and the same mark in the legend). Colour is
 * never the only cue (UX-13): the open-shift count is a numbered pill and a
 * SwapMatch day is a taller pill with ⇄, so it can't be mistaken for the
 * plain "covering" bar. Decorative: the cell's aria-label says it in words.
 */
export function BarMark({ kind, count, className }: BarMarkProps) {
  if (kind === 'available') {
    return (
      <span
        aria-hidden="true"
        className={cn(
          'flex h-4 items-center justify-center rounded-full text-[10px] font-bold leading-none text-on-accent',
          BAR_CLASS.available,
          className,
        )}
      >
        {count}
      </span>
    )
  }
  if (kind === 'swap') {
    return (
      <span
        aria-hidden="true"
        className={cn('flex h-3 items-center justify-center rounded-full text-on-accent', BAR_CLASS.swap, className)}
      >
        <ArrowLeftRight size={10} strokeWidth={3} />
      </span>
    )
  }
  return <span aria-hidden="true" className={cn('h-1.5 rounded-full', BAR_CLASS[kind], className)} />
}
