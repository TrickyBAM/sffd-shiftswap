// Tailwind classes for the calendar colours (ARCHITECTURE §7.2), kept as full
// literal strings so Tailwind can see them. Shared by the grid, legend, day
// sheet and "Coming up" list so every place uses the same colour for the same
// meaning.

import type { DayTone } from '@/lib/schedule/effective'
import type { BarKind, LineTone } from './calendar-model'

/** Solid fill for a bar / swatch. */
export const BAR_CLASS: Record<BarKind, string> = {
  working: 'bg-cal-work',
  openPost: 'bg-cal-open',
  covering: 'bg-cal-covering',
  swap: 'bg-cal-swap',
  available: 'bg-cal-available',
}

/** Soft background tint for a grid cell, by the day's main tone. */
export const CELL_TINT: Record<DayTone, string> = {
  swap: 'bg-cal-swap/15',
  covering: 'bg-cal-covering/15',
  openPost: 'bg-cal-open/15',
  working: 'bg-cal-work/15',
  givenAway: '',
  available: 'bg-cal-available/[0.08]',
  off: '',
}

/** Small round marker next to a status line or list row. */
export const LINE_DOT: Record<LineTone, string> = {
  working: 'bg-cal-work',
  openPost: 'bg-cal-open',
  available: 'bg-cal-available',
  covering: 'bg-cal-covering',
  swap: 'bg-cal-swap',
  givenAway: 'border-2 border-cal-work bg-transparent',
  off: 'bg-white/20',
  note: 'bg-accent-yellow',
}

/** Marker for a "Coming up" row, by day tone. */
export const TONE_DOT: Record<DayTone, string> = {
  swap: LINE_DOT.swap,
  covering: LINE_DOT.covering,
  openPost: LINE_DOT.openPost,
  working: LINE_DOT.working,
  givenAway: LINE_DOT.givenAway,
  available: LINE_DOT.available,
  off: LINE_DOT.off,
}
