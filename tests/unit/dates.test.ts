import { afterEach, describe, expect, it } from 'vitest'
import {
  addDays,
  assertYmd,
  compareYmd,
  dayNumberToYmd,
  dayOfWeek,
  daysInMonth,
  diffDays,
  eachDay,
  formatDate,
  formatMonth,
  formatTimePT,
  isBetween,
  isStarted,
  isYmd,
  makeYmd,
  monthGrid,
  monthOf,
  parseYmd,
  ptWallTimeToDate,
  shiftMonth,
  shiftStartsAt,
  startsAtISO,
  todayPT,
  ymdToDayNumber,
} from '@/lib/sffd/dates'

const ORIGINAL_TZ = process.env.TZ

afterEach(() => {
  if (ORIGINAL_TZ === undefined) delete process.env.TZ
  else process.env.TZ = ORIGINAL_TZ
})

describe('validation', () => {
  it('accepts real calendar dates only', () => {
    expect(isYmd('2026-09-23')).toBe(true)
    expect(isYmd('2024-02-29')).toBe(true)
    expect(isYmd('2000-02-29')).toBe(true)
    expect(isYmd('1900-02-29')).toBe(false)
    expect(isYmd('2026-02-29')).toBe(false)
    expect(isYmd('2026-02-30')).toBe(false)
    expect(isYmd('2026-04-31')).toBe(false)
    expect(isYmd('2026-13-01')).toBe(false)
    expect(isYmd('2026-00-10')).toBe(false)
    expect(isYmd('2026-09-00')).toBe(false)
    expect(isYmd('2026-9-23')).toBe(false)
    expect(isYmd('2026-09-23T00:00:00Z')).toBe(false)
    expect(isYmd(' 2026-09-23')).toBe(false)
    expect(isYmd(20260923)).toBe(false)
    expect(isYmd(null)).toBe(false)
    expect(isYmd(undefined)).toBe(false)
  })

  it('assertYmd throws a RangeError with the bad value', () => {
    expect(assertYmd('2026-09-23')).toBe('2026-09-23')
    expect(() => assertYmd('2026-02-30')).toThrow(RangeError)
    expect(() => assertYmd('nope', 'return date')).toThrow(/Invalid return date: "nope"/)
  })

  it('parseYmd / makeYmd round-trip and roll over like Date.UTC', () => {
    expect(parseYmd('2026-09-23')).toEqual({ year: 2026, month: 9, day: 23 })
    expect(makeYmd(2026, 9, 23)).toBe('2026-09-23')
    expect(makeYmd(2026, 13, 1)).toBe('2027-01-01')
    expect(makeYmd(2026, 3, 0)).toBe('2026-02-28')
    expect(makeYmd(2024, 2, 30)).toBe('2024-03-01')
  })
})

describe('day numbers', () => {
  it('counts days from the Unix epoch', () => {
    expect(ymdToDayNumber('1970-01-01')).toBe(0)
    expect(ymdToDayNumber('1970-01-02')).toBe(1)
    expect(ymdToDayNumber('1969-12-31')).toBe(-1)
    expect(ymdToDayNumber('2019-01-01')).toBe(17897)
    expect(dayNumberToYmd(17897)).toBe('2019-01-01')
  })

  it('round-trips every day 2015–2040', () => {
    const start = ymdToDayNumber('2015-01-01')
    const end = ymdToDayNumber('2040-12-31')
    for (let n = start; n <= end; n++) {
      const ymd = dayNumberToYmd(n)
      expect(isYmd(ymd)).toBe(true)
      expect(ymdToDayNumber(ymd)).toBe(n)
    }
  })

  it('rejects invalid input', () => {
    expect(() => ymdToDayNumber('2026-02-30')).toThrow(RangeError)
    expect(() => dayNumberToYmd(1.5)).toThrow(RangeError)
  })
})

describe('arithmetic', () => {
  it('addDays crosses months, years, leap days and DST changes', () => {
    expect(addDays('2026-09-23', 1)).toBe('2026-09-24')
    expect(addDays('2026-09-30', 1)).toBe('2026-10-01')
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
    expect(addDays('2027-01-01', -1)).toBe('2026-12-31')
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29')
    expect(addDays('2027-02-28', 1)).toBe('2027-03-01')
    // US DST 2026: starts Mar 8, ends Nov 1 — must not skip or repeat a day.
    expect(addDays('2026-03-07', 1)).toBe('2026-03-08')
    expect(addDays('2026-03-08', 1)).toBe('2026-03-09')
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01')
    expect(addDays('2026-11-01', 1)).toBe('2026-11-02')
    expect(addDays('2026-09-23', 0)).toBe('2026-09-23')
    expect(addDays('2026-09-23', 365)).toBe('2027-09-23')
    expect(() => addDays('2026-09-23', 0.5)).toThrow(RangeError)
  })

  it('diffDays is b − a', () => {
    expect(diffDays('2026-09-23', '2026-09-25')).toBe(2)
    expect(diffDays('2026-09-25', '2026-09-23')).toBe(-2)
    expect(diffDays('2019-01-01', '2026-09-23')).toBe(2822)
    expect(diffDays('2026-03-01', '2026-04-01')).toBe(31)
    expect(diffDays('2026-01-01', '2027-01-01')).toBe(365)
    expect(diffDays('2028-01-01', '2029-01-01')).toBe(366)
  })

  it('dayOfWeek: 0 = Sunday', () => {
    expect(dayOfWeek('1970-01-01')).toBe(4) // Thursday
    expect(dayOfWeek('2026-09-23')).toBe(3) // Wednesday
    expect(dayOfWeek('2026-09-27')).toBe(0) // Sunday
    expect(dayOfWeek('2026-09-26')).toBe(6) // Saturday
    expect(dayOfWeek('1969-12-28')).toBe(0) // Sunday, before the epoch
    expect(dayOfWeek('2019-01-01')).toBe(2) // Tuesday
  })

  it('compareYmd / isBetween', () => {
    expect(compareYmd('2026-09-23', '2026-09-24')).toBe(-1)
    expect(compareYmd('2026-09-24', '2026-09-23')).toBe(1)
    expect(compareYmd('2026-09-23', '2026-09-23')).toBe(0)
    expect(['2026-10-01', '2025-12-31', '2026-09-23'].sort(compareYmd)).toEqual([
      '2025-12-31',
      '2026-09-23',
      '2026-10-01',
    ])
    expect(isBetween('2026-09-23', '2026-09-01', '2026-09-30')).toBe(true)
    expect(isBetween('2026-09-01', '2026-09-01', '2026-09-30')).toBe(true)
    expect(isBetween('2026-10-01', '2026-09-01', '2026-09-30')).toBe(false)
    expect(() => compareYmd('2026-09-23', 'x')).toThrow(RangeError)
  })

  it('month helpers', () => {
    expect(daysInMonth(2026, 2)).toBe(28)
    expect(daysInMonth(2028, 2)).toBe(29)
    expect(daysInMonth(2100, 2)).toBe(28)
    expect(daysInMonth(2000, 2)).toBe(29)
    expect(daysInMonth(2026, 9)).toBe(30)
    expect(daysInMonth(2026, 12)).toBe(31)
    expect(monthOf('2026-09-23')).toEqual({ year: 2026, month: 9 })
    expect(shiftMonth(2026, 12, 1)).toEqual({ year: 2027, month: 1 })
    expect(shiftMonth(2026, 1, -1)).toEqual({ year: 2025, month: 12 })
    expect(shiftMonth(2026, 9, 0)).toEqual({ year: 2026, month: 9 })
    expect(shiftMonth(2026, 9, -21)).toEqual({ year: 2024, month: 12 })
    expect(eachDay('2026-09-29', '2026-10-02')).toEqual(['2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02'])
    expect(eachDay('2026-10-02', '2026-09-29')).toEqual([])
  })
})

describe('monthGrid', () => {
  it('returns 6 Sunday-first weeks covering the month', () => {
    const grid = monthGrid(2026, 9)
    expect(grid).toHaveLength(6)
    for (const week of grid) {
      expect(week).toHaveLength(7)
      expect(dayOfWeek(week[0].ymd)).toBe(0)
    }
    // September 2026 starts on a Tuesday.
    expect(grid[0].map((d) => d.ymd)).toEqual([
      '2026-08-30',
      '2026-08-31',
      '2026-09-01',
      '2026-09-02',
      '2026-09-03',
      '2026-09-04',
      '2026-09-05',
    ])
    expect(grid[0][1].inMonth).toBe(false)
    expect(grid[0][2].inMonth).toBe(true)
    const inMonth = grid.flat().filter((d) => d.inMonth)
    expect(inMonth).toHaveLength(30)
    expect(inMonth[0].ymd).toBe('2026-09-01')
    expect(inMonth[29].ymd).toBe('2026-09-30')
    expect(grid[5][6].ymd).toBe('2026-10-10')
  })

  it('handles a month starting on Sunday and February in leap years', () => {
    const feb = monthGrid(2026, 2) // Feb 1 2026 is a Sunday
    expect(feb[0][0]).toEqual({ ymd: '2026-02-01', inMonth: true })
    expect(feb.flat().filter((d) => d.inMonth)).toHaveLength(28)
    const leap = monthGrid(2028, 2)
    expect(leap.flat().filter((d) => d.inMonth)).toHaveLength(29)
    // Consecutive days throughout.
    const all = monthGrid(2026, 12).flat()
    for (let i = 1; i < all.length; i++) expect(diffDays(all[i - 1].ymd, all[i].ymd)).toBe(1)
  })

  it('rejects bad months', () => {
    expect(() => monthGrid(2026, 0)).toThrow(RangeError)
    expect(() => monthGrid(2026, 13)).toThrow(RangeError)
  })
})

describe('Pacific time', () => {
  it('todayPT uses the San Francisco calendar day', () => {
    // 2026-09-24 06:59 UTC is still Sept 23 in PDT (UTC−7).
    expect(todayPT(new Date('2026-09-24T06:59:00Z'))).toBe('2026-09-23')
    expect(todayPT(new Date('2026-09-24T07:00:00Z'))).toBe('2026-09-24')
    // Winter: PST (UTC−8).
    expect(todayPT(new Date('2026-01-15T07:59:00Z'))).toBe('2026-01-14')
    expect(todayPT(new Date('2026-01-15T08:00:00Z'))).toBe('2026-01-15')
    expect(todayPT(new Date('2026-12-31T23:30:00-08:00'))).toBe('2026-12-31')
  })

  it('startsAtISO is DST-correct', () => {
    // PDT (UTC−7)
    expect(startsAtISO('2026-09-23', '24-Hour')).toBe('2026-09-23T15:00:00.000Z')
    expect(startsAtISO('2026-09-23', 'PM')).toBe('2026-09-23T23:00:00.000Z')
    // PST (UTC−8)
    expect(startsAtISO('2026-01-15', '24-Hour')).toBe('2026-01-15T16:00:00.000Z')
    expect(startsAtISO('2026-01-15', 'PM')).toBe('2026-01-16T00:00:00.000Z')
    // Transition days: DST starts 2026-03-08 02:00, ends 2026-11-01 02:00.
    expect(startsAtISO('2026-03-07', '24-Hour')).toBe('2026-03-07T16:00:00.000Z')
    expect(startsAtISO('2026-03-08', '24-Hour')).toBe('2026-03-08T15:00:00.000Z')
    expect(startsAtISO('2026-10-31', '24-Hour')).toBe('2026-10-31T15:00:00.000Z')
    expect(startsAtISO('2026-11-01', '24-Hour')).toBe('2026-11-01T16:00:00.000Z')
    expect(startsAtISO('2026-11-01', 'PM')).toBe('2026-11-02T00:00:00.000Z')
    expect(shiftStartsAt('2026-09-23', 'PM')).toBeInstanceOf(Date)
  })

  it('ptWallTimeToDate validates the time', () => {
    expect(ptWallTimeToDate('2026-07-04', '00:00').toISOString()).toBe('2026-07-04T07:00:00.000Z')
    expect(() => ptWallTimeToDate('2026-07-04', '8:00')).toThrow(RangeError)
  })

  it('isStarted compares the start instant with now (inclusive)', () => {
    const start = new Date('2026-09-23T15:00:00Z')
    expect(isStarted('2026-09-23', '24-Hour', new Date(start.getTime() - 1))).toBe(false)
    expect(isStarted('2026-09-23', '24-Hour', start)).toBe(true)
    expect(isStarted('2026-09-23', 'PM', new Date('2026-09-23T22:59:59Z'))).toBe(false)
    expect(isStarted('2026-09-23', 'PM', new Date('2026-09-23T23:00:00Z'))).toBe(true)
    expect(isStarted('2026-09-22', '24-Hour', start)).toBe(true)
  })
})

describe('formatDate', () => {
  it('formats every style without shifting the day', () => {
    expect(formatDate('2026-09-23', 'short')).toBe('Sep 23')
    expect(formatDate('2026-09-23', 'medium')).toBe('Sep 23, 2026')
    expect(formatDate('2026-09-23', 'long')).toBe('Wednesday, September 23, 2026')
    expect(formatDate('2026-09-23', 'weekday')).toBe('Wed, Sep 23')
    expect(formatDate('2026-09-23', 'monthYear')).toBe('September 2026')
    expect(formatDate('2027-01-01', 'short')).toBe('Jan 1')
    expect(formatDate('2026-09-23')).toBe('Sep 23, 2026')
    expect(formatMonth(2026, 12)).toBe('December 2026')
  })

  it('rejects invalid dates and styles', () => {
    expect(() => formatDate('2026-02-30', 'short')).toThrow(RangeError)
    // @ts-expect-error — unknown style
    expect(() => formatDate('2026-09-23', 'bogus')).toThrow(RangeError)
  })

  it('formatTimePT shows Pacific clock time', () => {
    expect(formatTimePT(new Date('2026-09-23T22:45:00Z'))).toBe('3:45 PM')
    expect(formatTimePT('2026-01-15T16:05:00.000Z')).toBe('8:05 AM')
    expect(() => formatTimePT('not a date')).toThrow(RangeError)
  })
})

describe('time-zone independence', () => {
  it('gives identical answers whatever the process time zone is', () => {
    const zones = ['America/Los_Angeles', 'Pacific/Kiritimati', 'Pacific/Pago_Pago', 'UTC', 'Asia/Kolkata']
    const results = zones.map((tz) => {
      process.env.TZ = tz
      return [
        ymdToDayNumber('2026-09-23'),
        addDays('2026-03-08', 1),
        dayOfWeek('2026-09-23'),
        formatDate('2026-09-23', 'long'),
        todayPT(new Date('2026-09-24T06:59:00Z')),
        startsAtISO('2026-11-01', 'PM'),
        monthGrid(2026, 9)[0][0].ymd,
      ]
    })
    for (const r of results) expect(r).toEqual(results[0])
  })
})
