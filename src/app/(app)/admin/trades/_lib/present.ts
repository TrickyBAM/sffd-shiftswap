// How a shift/trade row is described on /admin/trades and in its CSV export.

import type { BadgeTone } from '@/components/ui'
import { formatDate } from '@/lib/sffd/dates'
import { battalionLabel, stationLabel } from '@/lib/sffd/stations'
import type { Shift } from '@/lib/types/database'
import { toCsv } from '../../_lib/csv'
import { formatInstant } from '../../_lib/format'

export interface TradeStatus {
  label: string
  tone: BadgeTone
}

type StatusFields = Pick<Shift, 'status' | 'starts_at' | 'coverer_name'>

/** True once the shift has started (starts_at <= now). */
export function hasStarted(shift: Pick<Shift, 'starts_at'>, now: Date = new Date()): boolean {
  const start = Date.parse(shift.starts_at)
  return Number.isFinite(start) && start <= now.getTime()
}

/** Plain-English status: Open, Expired, Confirmed, Worked, Trade undone, Post taken down. */
export function tradeStatus(shift: StatusFields, now: Date = new Date()): TradeStatus {
  const started = hasStarted(shift, now)
  switch (shift.status) {
    case 'open':
      return started ? { label: 'Expired (nobody took it)', tone: 'gray' } : { label: 'Open', tone: 'orange' }
    case 'covered':
      return started ? { label: 'Worked', tone: 'gray' } : { label: 'Confirmed', tone: 'green' }
    case 'cancelled':
      return shift.coverer_name
        ? { label: 'Trade undone', tone: 'red' }
        : { label: 'Post taken down', tone: 'neutral' }
  }
}

/** "Oct 14, 2026 · 24-Hour" */
export function shiftTitle(shift: Pick<Shift, 'date' | 'shift_type'>): string {
  return `${formatDate(shift.date, 'medium')} · ${shift.shift_type}`
}

/** SwapMatch text for a row: the confirmed return date, or the dates offered. */
export function swapText(shift: Pick<Shift, 'return_dates' | 'return_leg_id'>, returnLeg?: Pick<Shift, 'date'> | null): string {
  if (returnLeg) return `Pays back ${formatDate(returnLeg.date, 'weekday')}`
  if (shift.return_dates.length) {
    return `SwapMatch: ${shift.return_dates.map((d) => formatDate(d, 'short')).join(', ')}`
  }
  return ''
}

export const TRADE_CSV_HEADERS = [
  'Date',
  'Day',
  'Shift type',
  'Hours',
  'Station',
  'Battalion',
  'Posted by',
  'Covered by',
  'Status',
  'SwapMatch return date',
  'Return dates offered',
  'Confirmed at (Pacific)',
  'Cancelled at (Pacific)',
  'Cancel note',
  'Notes',
  'Trade ID',
] as const

/** The CSV export: a header row plus one row per shift. */
export function tradesCsv(
  shifts: readonly Shift[],
  returnLegs: ReadonlyMap<string, Pick<Shift, 'date'>>,
  now: Date = new Date(),
): string {
  const rows = shifts.map((shift) => {
    const leg = shift.return_leg_id ? returnLegs.get(shift.return_leg_id) : undefined
    return [
      shift.date,
      formatDate(shift.date, 'weekday').split(',')[0],
      shift.shift_type,
      shift.hours,
      stationLabel(shift.station),
      battalionLabel(shift.battalion),
      shift.poster_name,
      shift.coverer_name ?? '',
      tradeStatus(shift, now).label,
      leg?.date ?? '',
      shift.return_dates.join(' '),
      formatInstant(shift.confirmed_at),
      formatInstant(shift.cancelled_at),
      shift.cancel_note ?? '',
      shift.notes ?? '',
      shift.id,
    ]
  })
  return toCsv([TRADE_CSV_HEADERS, ...rows])
}
