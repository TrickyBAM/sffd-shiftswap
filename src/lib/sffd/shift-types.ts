// SFFD shift types (ARCHITECTURE §1, §5). A shift is stored by its START date;
// both types end at 08:00 the next morning.

export const SHIFT_TYPE_VALUES = ['24-Hour', 'PM'] as const

export type ShiftType = (typeof SHIFT_TYPE_VALUES)[number]

export interface ShiftTypeInfo {
  /** Stored value and display label. */
  label: ShiftType
  /** Paid hours for the shift. */
  hours: 24 | 16
  /** Local (America/Los_Angeles) start time, 24-hour HH:MM. */
  startTime: '08:00' | '16:00'
  /** Short start–end description in fire-service time. */
  description: string
}

export const SHIFT_TYPES: Readonly<Record<ShiftType, ShiftTypeInfo>> = Object.freeze({
  '24-Hour': { label: '24-Hour', hours: 24, startTime: '08:00', description: '0800–0800' },
  PM: { label: 'PM', hours: 16, startTime: '16:00', description: '1600–0800' },
})

/** SHIFT_TYPES in display order, for selects and segmented controls. */
export const SHIFT_TYPE_LIST: readonly ShiftTypeInfo[] = SHIFT_TYPE_VALUES.map((t) => SHIFT_TYPES[t])

export function isShiftType(value: unknown): value is ShiftType {
  return typeof value === 'string' && (SHIFT_TYPE_VALUES as readonly string[]).includes(value)
}

export function shiftHours(type: ShiftType): 24 | 16 {
  return SHIFT_TYPES[type].hours
}
