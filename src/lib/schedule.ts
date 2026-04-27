import {
  addDays,
  addMonths,
  differenceInCalendarDays,
  startOfMonth,
  endOfMonth,
  format,
  parse,
  isValid,
} from 'date-fns'

export interface PatternResult {
  gapPattern: number[]
  confidence: number
  anchorDate: string // yyyy-MM-dd format, first known work date
}

export interface ValidationResult {
  isValid: boolean
  pattern: number[]
  confidence: number
}

/**
 * Choose the month to ask the user to confirm after their selected work days.
 * Uses the month after the latest selected day so recalibration works for
 * past or future months, not just the current calendar month.
 */
export function getPredictionMonth(
  workDates: Date[],
  fallbackMonth: Date = new Date()
): Date {
  const sortedValidDates = [...workDates]
    .filter((date) => isValid(date))
    .sort((a, b) => a.getTime() - b.getTime())

  const baseMonth = sortedValidDates.at(-1) ?? fallbackMonth
  return startOfMonth(addMonths(baseMonth, 1))
}

/**
 * Compute day gaps between consecutive sorted dates.
 */
function computeGaps(dates: Date[]): number[] {
  const sorted = [...dates].sort((a, b) => a.getTime() - b.getTime())
  const gaps: number[] = []
  for (let i = 1; i < sorted.length; i++) {
    gaps.push(differenceInCalendarDays(sorted[i], sorted[i - 1]))
  }
  return gaps
}

/**
 * Fold a gap array into a repeating pattern of length cycleLen.
 * Uses median-like rounding to find the best integer gap at each position.
 */
function foldGaps(gaps: number[], cycleLen: number): number[] {
  const buckets: number[][] = Array.from({ length: cycleLen }, () => [])
  for (let i = 0; i < gaps.length; i++) {
    buckets[i % cycleLen].push(gaps[i])
  }
  return buckets.map((bucket) => {
    if (bucket.length === 0) return 3 // default
    const sum = bucket.reduce((a, b) => a + b, 0)
    return Math.round(sum / bucket.length)
  })
}

/**
 * Score how well a gap pattern reproduces a set of known dates.
 * Returns a value between 0 and 1, where 1 is a perfect match.
 */
function scorePattern(dates: Date[], pattern: number[]): number {
  if (dates.length < 2 || pattern.length === 0) return 0
  const sorted = [...dates].sort((a, b) => a.getTime() - b.getTime())

  // Project forward from first date using the pattern
  const projected: Date[] = [sorted[0]]
  let current = sorted[0]
  let patIdx = 0
  const maxProjected = sorted.length + pattern.length
  while (projected.length < maxProjected) {
    current = addDays(current, pattern[patIdx % pattern.length])
    projected.push(current)
    patIdx++
  }

  // For each actual date (except first), find the closest projected date
  let totalError = 0
  for (let i = 1; i < sorted.length; i++) {
    let minDist = Infinity
    for (const p of projected) {
      const dist = Math.abs(differenceInCalendarDays(sorted[i], p))
      if (dist < minDist) minDist = dist
    }
    totalError += minDist
  }

  const avgError = totalError / (sorted.length - 1)
  // Score: 1.0 = perfect, approaches 0 as error grows
  return 1 / (1 + avgError)
}

/**
 * Detect the repeating gap pattern from a set of work dates.
 * Tries multiple cycle lengths and picks the best fit.
 */
export function detectSchedulePattern(workDates: Date[]): PatternResult {
  const sorted = [...workDates].sort((a, b) => a.getTime() - b.getTime())
  const anchorDate = format(sorted[0], 'yyyy-MM-dd')

  if (sorted.length < 2) {
    return { gapPattern: [3, 3, 4], confidence: 0, anchorDate }
  }

  const gaps = computeGaps(sorted)

  if (gaps.length < 2) {
    return { gapPattern: gaps, confidence: 0.5, anchorDate }
  }

  let bestPattern: number[] = gaps
  let bestScore = 0

  // Try cycle lengths from 2 up to the number of gaps (max 12)
  const maxCycleLen = Math.min(gaps.length, 12)
  for (let cycleLen = 2; cycleLen <= maxCycleLen; cycleLen++) {
    const pattern = foldGaps(gaps, cycleLen)
    // Ensure minimum gap of 1
    const safePattern = pattern.map((g) => Math.max(g, 1))
    const score = scorePattern(sorted, safePattern)

    // Prefer shorter patterns with similar scores (Occam's razor)
    // Give a small bonus for shorter patterns
    const adjustedScore = score + (1 - cycleLen / (maxCycleLen + 1)) * 0.05

    if (adjustedScore > bestScore) {
      bestScore = adjustedScore
      bestPattern = safePattern
    }
  }

  // Also score the raw gaps as a pattern (exact fit to training data)
  if (gaps.length <= 12) {
    const rawScore = scorePattern(sorted, gaps)
    // Raw gaps get a slight penalty for overfitting
    const adjustedRaw = rawScore - 0.05
    if (adjustedRaw > bestScore) {
      bestScore = adjustedRaw
      bestPattern = gaps
    }
  }

  return {
    gapPattern: bestPattern,
    confidence: Math.min(bestScore, 1),
    anchorDate,
  }
}

/**
 * Project work dates forward from an anchor date using a gap pattern.
 */
export function projectSchedule(
  anchorDate: Date,
  gapPattern: number[],
  endDate: Date
): Date[] {
  if (gapPattern.length === 0) return [anchorDate]

  const dates: Date[] = [anchorDate]
  let current = anchorDate
  let patIdx = 0

  while (current < endDate) {
    current = addDays(current, gapPattern[patIdx % gapPattern.length])
    if (current <= endDate) {
      dates.push(current)
    }
    patIdx++
    if (dates.length > 500) break // safety
  }

  return dates
}

/**
 * Project work dates backward from an anchor date.
 */
export function projectScheduleBackward(
  anchorDate: Date,
  gapPattern: number[],
  startDate: Date
): Date[] {
  if (gapPattern.length === 0) return [anchorDate]

  const dates: Date[] = [anchorDate]
  let current = anchorDate
  let patIdx = gapPattern.length - 1

  while (current > startDate) {
    current = addDays(current, -gapPattern[patIdx])
    if (current >= startDate) {
      dates.unshift(current)
    }
    patIdx = (patIdx - 1 + gapPattern.length) % gapPattern.length
    if (dates.length > 500) break // safety
  }

  return dates
}

/**
 * Get all projected work dates for a specific month.
 */
export function getWorkDatesForMonth(
  anchorDate: string, // yyyy-MM-dd
  gapPattern: number[],
  year: number,
  month: number // 1-based
): string[] {
  const anchor = parse(anchorDate, 'yyyy-MM-dd', new Date())
  if (!isValid(anchor) || gapPattern.length === 0) return []

  const monthStart = startOfMonth(new Date(year, month - 1))
  const monthEnd = endOfMonth(new Date(year, month - 1))

  // Project far enough in both directions
  const forwardDates = projectSchedule(anchor, gapPattern, addDays(monthEnd, 1))
  const backwardDates = projectScheduleBackward(anchor, gapPattern, addDays(monthStart, -1))

  const allDateStrs = new Set<string>()
  for (const d of [...forwardDates, ...backwardDates]) {
    const str = format(d, 'yyyy-MM-dd')
    const parsed = parse(str, 'yyyy-MM-dd', new Date())
    if (parsed >= monthStart && parsed <= monthEnd) {
      allDateStrs.add(str)
    }
  }

  return Array.from(allDateStrs).sort()
}

/**
 * Validate a pattern detected from work dates.
 */
export function validatePattern(workDates: Date[]): ValidationResult {
  if (workDates.length < 3) {
    return { isValid: false, pattern: [], confidence: 0 }
  }

  const result = detectSchedulePattern(workDates)

  return {
    isValid: result.confidence >= 0.7,
    pattern: result.gapPattern,
    confidence: result.confidence,
  }
}

/**
 * Project work dates for the next month given known dates.
 * Returns projected dates as yyyy-MM-dd strings.
 */
export function projectNextMonth(
  knownDates: Date[],
  targetYear: number,
  targetMonth: number // 1-based
): { dates: string[]; pattern: number[]; confidence: number } {
  const result = detectSchedulePattern(knownDates)
  const dates = getWorkDatesForMonth(
    result.anchorDate,
    result.gapPattern,
    targetYear,
    targetMonth
  )

  return {
    dates,
    pattern: result.gapPattern,
    confidence: result.confidence,
  }
}

/**
 * Re-analyze pattern with combined data from multiple months.
 * Used when user corrects the prediction for better accuracy.
 */
export function refinePattern(
  originalDates: Date[],
  correctedDates: Date[]
): PatternResult {
  // Combine all dates, remove duplicates
  const allDateStrs = new Set<string>()
  for (const d of [...originalDates, ...correctedDates]) {
    allDateStrs.add(format(d, 'yyyy-MM-dd'))
  }

  const allDates = Array.from(allDateStrs)
    .sort()
    .map((s) => parse(s, 'yyyy-MM-dd', new Date()))
    .filter((d) => isValid(d))

  return detectSchedulePattern(allDates)
}
