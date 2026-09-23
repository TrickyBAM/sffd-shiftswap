import type { ReactNode } from 'react'
import { PM_GIVEN_AWAY_HOURS } from '@/lib/schedule/effective'
import { BarMark } from './BarMark'

/** A small cell-shaped swatch with the red outline of a covered day. */
function Outlined({ children }: { children?: ReactNode }) {
  return (
    <span
      aria-hidden="true"
      className="flex h-4 w-6 shrink-0 flex-col justify-end rounded-md p-[3px] ring-2 ring-inset ring-cal-work"
    >
      {children}
    </span>
  )
}

// Same marks as the grid (BarMark), in words as well as colour. Names match
// the rest of the app: "Your open post" (orange everywhere), "SwapMatch".
const ITEMS: ReadonlyArray<{ key: string; swatch: ReactNode; label: string }> = [
  { key: 'working', swatch: <BarMark kind="working" className="w-6 shrink-0" />, label: "You're on duty" },
  { key: 'openPost', swatch: <BarMark kind="openPost" className="w-6 shrink-0" />, label: 'Your open post' },
  {
    key: 'available',
    swatch: <BarMark kind="available" count={2} className="w-6 shrink-0" />,
    label: 'Open shifts you could take',
  },
  { key: 'covering', swatch: <BarMark kind="covering" className="w-6 shrink-0" />, label: "You're covering someone" },
  { key: 'swap', swatch: <BarMark kind="swap" className="w-6 shrink-0" />, label: 'SwapMatch day' },
  { key: 'givenAway', swatch: <Outlined />, label: 'Someone covers your shift' },
  {
    key: 'pmGivenAway',
    swatch: (
      <Outlined>
        <BarMark kind="working" className="h-1 w-full" />
      </Outlined>
    ),
    label: `You work ${PM_GIVEN_AWAY_HOURS}, PM covered`,
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
