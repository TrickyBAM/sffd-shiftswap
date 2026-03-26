import { addDays, format, parse, isValid } from 'date-fns'

// Tour 1 base dates for 2025 (one per month)
// Tour 1: 1/17, 2/17, 3/20, 4/20, 5/21, 6/21, 7/22, 8/22, 9/22, 10/23, 11/23, 12/24
const TOUR_1_DATES_2025 = [
  '2025-01-17',
  '2025-02-17',
  '2025-03-20',
  '2025-04-20',
  '2025-05-21',
  '2025-06-21',
  '2025-07-22',
  '2025-08-22',
  '2025-09-22',
  '2025-10-23',
  '2025-11-23',
  '2025-12-24',
]

// SFFD runs 31 tours on a 24-hour rotation
// Each tour works every 3rd day (3-platoon system)
// Tour N starts on (Tour 1 date + (N-1) days)
export function getTourDateForMonth(tour: number, year: number, month: number): Date | null {
  if (tour < 1 || tour > 31) return null

  // Find base date for this month in 2025
  // For other years, we need to compute offset
  const monthIndex = month - 1

  // Use 2025 as base year
  const baseDate = parse(TOUR_1_DATES_2025[monthIndex], 'yyyy-MM-dd', new Date())
  if (!isValid(baseDate)) return null

  // Adjust for year difference from 2025
  const yearDiff = year - 2025
  // Each year, dates shift by about 1-2 days (365 % 3 = 1 or 2 for leap)
  // We'll compute actual shift dates by adding tour offset and cycling
  const tourOffset = (tour - 1)

  // The actual tour date: base + tourOffset, but modulo 3 shifts per cycle
  // In a 3-platoon system, if Tour 1 works on day D, Tour 2 works on D+1, Tour 3 on D+2,
  // Tour 4 on D+3 (same as Tour 1), etc.
  const candidateDate = addDays(baseDate, tourOffset + yearDiff * 365)
  return candidateDate
}

// Get all dates in a month that a given tour is working
// SFFD 24-hour shifts: Tour works, has 2 days off, repeats
export function getTourWorkDaysInMonth(tour: number, year: number, month: number): string[] {
  // Get first work date for this tour in this year
  // Use known anchor: Tour 1 works 2025-01-17
  const anchor = new Date('2025-01-17')
  const tourAnchor = addDays(anchor, tour - 1)

  // Days since anchor that are in target month
  const startOfMonth = new Date(year, month - 1, 1)
  const endOfMonth = new Date(year, month, 0)

  const workDays: string[] = []
  let current = new Date(tourAnchor)

  // Walk backwards if needed to find first work day on or before start of month
  while (current > startOfMonth) {
    current = addDays(current, -3)
  }

  // Now walk forward through the month collecting work days
  while (current <= endOfMonth) {
    if (current >= startOfMonth) {
      workDays.push(format(current, 'yyyy-MM-dd'))
    }
    current = addDays(current, 3)
  }

  return workDays
}

export function isTourWorkingOnDate(tour: number, dateStr: string): boolean {
  const date = parse(dateStr, 'yyyy-MM-dd', new Date())
  if (!isValid(date)) return false

  const anchor = new Date('2025-01-17')
  const tourAnchor = addDays(anchor, tour - 1)

  const diffMs = date.getTime() - tourAnchor.getTime()
  const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24))

  return diffDays % 3 === 0
}

export function getTourNumber(tour: number): string {
  return `Tour ${tour}`
}

export const TOUR_COUNT = 31
