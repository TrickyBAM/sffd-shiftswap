import { readFileSync } from 'node:fs'
import path from 'node:path'
import type { PGlite } from '@electric-sql/pglite'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { addDays, diffDays, dayNumberToYmd, ymdToDayNumber } from '@/lib/sffd/dates'
import {
  isTour,
  nextTourDays,
  SHIFTS_PER_CYCLE,
  TOUR1_OFFSETS,
  TOUR_EPOCH,
  TOURS,
  tourDaysInRange,
  toursOnDuty,
  tourWatches,
  tourWorks,
  watchOf,
} from '@/lib/sffd/tours'
import { extractSqlFunction, pgWithFunctions } from './helpers/sql-functions'

// Ground truth scraped from the public per-tour Google Calendars linked from
// https://sffirecu.org/about-us/3461-2/ — rebuild with
// `node tests/fixtures/build-tour-truth.mjs`.
interface TourTruth {
  source: string
  fetchedAt: string
  range: { from: string; to: string }
  watchCalendar: { calendarId: string; anchors: Record<string, string> }
  calendars: Record<string, { calendarId: string; name: string; description: string; watches: number[] }>
  tours: Record<string, string[]>
  anomalies: Array<{ tour: number; missingWatches: number[]; firstMissing: string | null; extra: string[] }>
}

const truth: TourTruth = JSON.parse(
  readFileSync(path.resolve(__dirname, '../fixtures/tour-truth.json'), 'utf8'),
)

/** Expands a feed's first-cycle DTSTARTs as RRULE:FREQ=DAILY;INTERVAL=31 over a range. */
function expandFeed(firstCycle: string[], from: string, to: string): Set<string> {
  const out = new Set<string>()
  const end = ymdToDayNumber(to)
  for (const start of firstCycle) {
    for (let n = ymdToDayNumber(start); n <= end; n += 31) {
      if (n >= ymdToDayNumber(from)) out.add(dayNumberToYmd(n))
    }
  }
  return out
}

describe('fixture sanity', () => {
  it('covers all 31 tours with 9 first-cycle dates each', () => {
    expect(Object.keys(truth.tours).map(Number).sort((a, b) => a - b)).toEqual([...TOURS])
    for (const dates of Object.values(truth.tours)) {
      expect(dates).toHaveLength(SHIFTS_PER_CYCLE)
      for (const d of dates) {
        const offset = diffDays(TOUR_EPOCH, d)
        expect(offset).toBeGreaterThanOrEqual(0)
        expect(offset).toBeLessThan(31)
      }
    }
    expect(truth.range).toEqual({ from: '2019-01-01', to: '2035-12-31' })
  })
})

describe('watchOf', () => {
  it('2019-01-01 is Watch 1 and the cycle is 31 days', () => {
    expect(watchOf('2019-01-01')).toBe(1)
    expect(watchOf('2019-01-31')).toBe(31)
    expect(watchOf('2019-02-01')).toBe(1)
    expect(watchOf('2018-12-31')).toBe(31)
    expect(watchOf('2026-09-23')).toBe(2)
  })

  it('matches the department-wide watch calendar (sffdwatch) anchors', () => {
    const anchors = Object.entries(truth.watchCalendar.anchors)
    expect(anchors).toHaveLength(31)
    for (const [watch, first] of anchors) {
      // Each watch event repeats every 31 days from its 2009 DTSTART.
      for (let k = 0; k < 330; k += 7) {
        expect(watchOf(addDays(first, 31 * k))).toBe(Number(watch))
      }
    }
  })
})

describe('tourWorks vs the public tour calendars', () => {
  it('matches every tour on every day 2019–2035', () => {
    const { from, to } = truth.range
    let checked = 0
    for (const tour of TOURS) {
      const expected = expandFeed(truth.tours[String(tour)], from, to)
      const actual = new Set(tourDaysInRange(tour, from, to))
      expect(actual).toEqual(expected)
      for (let n = ymdToDayNumber(from); n <= ymdToDayNumber(to); n++) {
        const ymd = dayNumberToYmd(n)
        if (tourWorks(tour, ymd) !== expected.has(ymd)) {
          throw new Error(`Tour ${tour} on ${ymd}: tourWorks=${tourWorks(tour, ymd)}, feed=${expected.has(ymd)}`)
        }
        checked++
      }
    }
    expect(checked).toBe(31 * (ymdToDayNumber(to) - ymdToDayNumber(from) + 1))
  })

  it('matches the watch lists printed on each tour calendar', () => {
    for (const tour of TOURS) {
      expect(tourWatches(tour)).toEqual(truth.calendars[String(tour)].watches)
      // …and the fixture's first-cycle dates are exactly those watches.
      expect(truth.tours[String(tour)].map(watchOf)).toEqual(tourWatches(tour))
    }
  })

  it('only known defects exist in the raw feeds', () => {
    // Tour 26's "Watch 11" series was accidentally ended on 2019-12-18 in the
    // public calendar; its description still lists watch 11 and every other
    // day has 9 tours on duty, so the feed (not the rule) is wrong there.
    expect(truth.anomalies).toEqual([
      expect.objectContaining({ tour: 26, missingWatches: [11], firstMissing: '2020-01-18', extra: [] }),
    ])
  })
})

describe('tour rule', () => {
  it('Tour 1 works watches 1,4,7,11,14,17,21,24,27', () => {
    expect([...TOUR1_OFFSETS]).toEqual([0, 3, 6, 10, 13, 16, 20, 23, 26])
    expect(tourWatches(1)).toEqual([1, 4, 7, 11, 14, 17, 21, 24, 27])
  })

  it('sanity anchor: 2026-09-23 is Watch 2 with tours {2,7,10,13,17,20,23,27,30}', () => {
    expect(toursOnDuty('2026-09-23')).toEqual([2, 7, 10, 13, 17, 20, 23, 27, 30])
  })

  it('exactly 9 tours are on duty every day, and each tour works 9 of every 31 days', () => {
    for (let n = ymdToDayNumber('2019-01-01'); n <= ymdToDayNumber('2035-12-31'); n++) {
      const onDuty = toursOnDuty(dayNumberToYmd(n))
      if (onDuty.length !== 9) throw new Error(`${dayNumberToYmd(n)}: ${onDuty.length} tours on duty`)
    }
    for (const tour of TOURS) {
      expect(tourDaysInRange(tour, '2026-09-01', '2026-10-01')).toHaveLength(9)
    }
  })

  it('tour N is tour 1 shifted N−1 days', () => {
    for (const tour of TOURS) {
      for (let i = 0; i < 62; i++) {
        const d = addDays('2026-01-01', i)
        expect(tourWorks(tour, addDays(d, tour - 1))).toBe(tourWorks(1, d))
      }
    }
  })

  it('works before the epoch too', () => {
    expect(tourWorks(1, '2018-12-31')).toBe(false) // watch 31
    expect(tourWorks(1, '2018-12-27')).toBe(true) // watch 27
    expect(toursOnDuty('2010-06-15')).toHaveLength(9)
  })

  it('no tour / invalid tour never works', () => {
    expect(tourWorks(null, '2026-09-23')).toBe(false)
    expect(tourWorks(undefined, '2026-09-23')).toBe(false)
    expect(tourWorks(0, '2026-09-23')).toBe(false)
    expect(tourWorks(32, '2026-09-23')).toBe(false)
    expect(tourWorks(2.5, '2026-09-23')).toBe(false)
    expect(() => tourWorks(null, 'bad')).toThrow(RangeError)
    expect(() => tourWorks(2, 'bad')).toThrow(RangeError)
    expect(isTour(1)).toBe(true)
    expect(isTour(31)).toBe(true)
    expect(isTour('1')).toBe(false)
    expect(() => tourWatches(0)).toThrow(RangeError)
  })
})

describe('range helpers', () => {
  it('tourDaysInRange is inclusive and ordered', () => {
    expect(tourDaysInRange(2, '2026-09-23', '2026-10-05')).toEqual(['2026-09-23', '2026-09-26', '2026-09-29', '2026-10-03'])
    expect(tourDaysInRange(2, '2026-09-24', '2026-09-25')).toEqual([])
    expect(tourDaysInRange(2, '2026-10-05', '2026-09-23')).toEqual([])
    expect(tourDaysInRange(null, '2026-09-01', '2026-09-30')).toEqual([])
  })

  it('nextTourDays starts at (and includes) fromYmd', () => {
    expect(nextTourDays(2, '2026-09-23', 3)).toEqual(['2026-09-23', '2026-09-26', '2026-09-29'])
    expect(nextTourDays(2, '2026-09-24', 1)).toEqual(['2026-09-26'])
    const many = nextTourDays(17, '2026-01-01', 90)
    expect(many).toHaveLength(90)
    expect(many.every((d) => tourWorks(17, d))).toBe(true)
    expect(many).toEqual(tourDaysInRange(17, '2026-01-01', many[89]))
    expect(nextTourDays(null, '2026-09-23', 3)).toEqual([])
    expect(nextTourDays(2, '2026-09-23', 0)).toEqual([])
  })
})

// ARCHITECTURE §4: the SQL implementation is checked against the same fixture.
const tourWorksSql = extractSqlFunction('public.tour_works')

describe('SQL public.tour_works', () => {
  it('is defined in supabase/migrations', () => {
    expect(tourWorksSql).not.toBeNull()
  })

  describe.skipIf(!tourWorksSql)('vs the public tour calendars', () => {
    let pg: PGlite
    beforeAll(async () => {
      pg = await pgWithFunctions([tourWorksSql!])
    })
    afterAll(async () => {
      await pg?.close()
    })

    it('matches every tour on every day 2019–2035', async () => {
      const { from, to } = truth.range
      const { rows } = await pg.query<{ tour: number; days: string[] }>(
        `select t.tour, array_agg(to_char(g.d, 'YYYY-MM-DD') order by g.d) as days
           from generate_series(1, 31) as t(tour)
           cross join generate_series($1::date, $2::date, interval '1 day') as g(d)
          where public.tour_works(t.tour::smallint, g.d::date)
          group by t.tour
          order by t.tour`,
        [from, to],
      )
      expect(rows.map((r) => r.tour)).toEqual([...TOURS])
      for (const { tour, days } of rows) {
        expect(new Set(days)).toEqual(expandFeed(truth.tours[String(tour)], from, to))
      }
    })

    it('agrees with tourWorks() for null, out-of-range and pre-epoch input', async () => {
      const { rows } = await pg.query<{ t: number | null; d: string; works: boolean }>(
        `select t, to_char(d, 'YYYY-MM-DD') as d, public.tour_works(t::smallint, d) as works
           from (values (null::int), (0), (1), (2), (31), (32)) as a(t)
           cross join (values (date '2018-12-27'), (date '2018-12-31'), (date '2026-09-23'), (date '2010-06-15')) as b(d)`,
      )
      for (const { t, d, works } of rows) expect(works, `tour ${t} ${d}`).toBe(tourWorks(t, d))
      const nullDate = await pg.query<{ works: boolean }>(`select public.tour_works(1::smallint, null::date) as works`)
      expect(nullDate.rows[0].works).toBe(false)
    })
  })
})
