import type { ReactNode } from 'react'
import { cn } from '@/components/ui'
import { BAR_CLASS } from './tones'

function Bar({ className }: { className: string }) {
  return <span aria-hidden="true" className={cn('h-1.5 w-6 shrink-0 rounded-full', className)} />
}

const ITEMS: ReadonlyArray<{ key: string; swatch: ReactNode; label: string }> = [
  { key: 'working', swatch: <Bar className={BAR_CLASS.working} />, label: "You're on duty" },
  { key: 'openPost', swatch: <Bar className={BAR_CLASS.openPost} />, label: 'Your open post' },
  {
    key: 'available',
    swatch: (
      <span
        aria-hidden="true"
        className={cn(
          'flex h-4 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-bold leading-none text-on-accent',
          BAR_CLASS.available,
        )}
      >
        2
      </span>
    ),
    label: 'Open shifts you could take',
  },
  { key: 'covering', swatch: <Bar className={BAR_CLASS.covering} />, label: "You're covering someone" },
  { key: 'swap', swatch: <Bar className={BAR_CLASS.swap} />, label: 'SwapMatch day' },
  {
    key: 'givenAway',
    swatch: <span aria-hidden="true" className="h-4 w-6 shrink-0 rounded-md ring-2 ring-inset ring-cal-work" />,
    label: 'Someone is covering you',
  },
  {
    key: 'today',
    swatch: (
      <span aria-hidden="true" className="flex w-6 shrink-0 justify-center">
        <span className="h-3.5 w-3.5 rounded-full bg-fg" />
      </span>
    ),
    label: 'Today',
  },
]

/** Always-visible key for the calendar colours, in words as well as colour. */
export function CalendarLegend({ className }: { className?: string }) {
  return (
    <div className={className}>
      <h3 className="sr-only">Calendar key</h3>
      <ul className="grid grid-cols-1 gap-x-4 gap-y-2 text-sm text-fg-muted min-[360px]:grid-cols-2">
        {ITEMS.map((item) => (
          <li key={item.key} className="flex items-center gap-2">
            {item.swatch}
            <span>{item.label}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
