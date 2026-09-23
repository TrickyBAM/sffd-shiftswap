import { describe, expect, it } from 'vitest'
import { AppError } from '@/lib/errors'
import { describeActionError, isAccountError, isStaleDataError } from '@/app/(app)/board/_lib/errors'
import {
  acceptLimitLabel,
  chatDayLabel,
  dayHeading,
  dialable,
  groupByDate,
  listDates,
  plural,
  shiftTimesLabel,
  stationBattalionLabel,
  timeAgo,
  uniqueById,
  ymdOfInstant,
} from '@/app/(app)/board/_lib/format'

// 2026-09-23 12:00 Pacific (PDT, UTC−7)
const NOW = Date.parse('2026-09-23T19:00:00Z')
const MIN = 60_000

describe('timeAgo', () => {
  it('uses short, friendly buckets', () => {
    expect(timeAgo(new Date(NOW - 20_000).toISOString(), NOW)).toBe('just now')
    expect(timeAgo(new Date(NOW - 5 * MIN).toISOString(), NOW)).toBe('5 min ago')
    expect(timeAgo(new Date(NOW - 3 * 60 * MIN).toISOString(), NOW)).toBe('3 hr ago')
    expect(timeAgo(new Date(NOW - 26 * 60 * MIN).toISOString(), NOW)).toBe('yesterday')
    expect(timeAgo(new Date(NOW - 3 * 24 * 60 * MIN).toISOString(), NOW)).toBe('3 days ago')
    expect(timeAgo('2026-09-03T19:00:00Z', NOW)).toBe('on Sep 3')
  })

  it('is empty for missing or bad input', () => {
    expect(timeAgo(null, NOW)).toBe('')
    expect(timeAgo('not a date', NOW)).toBe('')
  })
})

describe('ymdOfInstant', () => {
  it('gives the Pacific calendar day of an instant', () => {
    // 23:30 PDT on Sep 23 is already Sep 24 in UTC.
    expect(ymdOfInstant('2026-09-24T06:30:00Z')).toBe('2026-09-23')
    expect(ymdOfInstant('2026-09-24T07:30:00Z')).toBe('2026-09-24')
    expect(ymdOfInstant(null)).toBeNull()
    expect(ymdOfInstant('garbage')).toBeNull()
  })
})

describe('day labels', () => {
  it('board headings say Today / Tomorrow', () => {
    expect(dayHeading('2026-09-23', '2026-09-23')).toBe('Wed, Sep 23 · Today')
    expect(dayHeading('2026-09-24', '2026-09-23')).toBe('Thu, Sep 24 · Tomorrow')
    expect(dayHeading('2026-10-14', '2026-09-23')).toBe('Wed, Oct 14')
  })

  it('chat separators say Today / Yesterday', () => {
    expect(chatDayLabel('2026-09-23', '2026-09-23')).toBe('Today')
    expect(chatDayLabel('2026-09-22', '2026-09-23')).toBe('Yesterday')
    expect(chatDayLabel('2026-09-20', '2026-09-23')).toBe('Sun, Sep 20')
  })
})

describe('shift labels', () => {
  it('describes times and hours', () => {
    expect(shiftTimesLabel('24-Hour')).toBe('0800–0800 · 24 hrs')
    expect(shiftTimesLabel('PM')).toBe('1600–0800 · 16 hrs')
    expect(shiftTimesLabel('Other')).toBe('Other')
  })

  it('names station and battalion', () => {
    expect(stationBattalionLabel({ station: 19, battalion: 9 })).toBe('Station 19 · Battalion 9')
    expect(stationBattalionLabel({ station: 101, battalion: 99 })).toBe('Airport Station 1 · Airport Battalion')
  })

  it('explains accept limits relative to the shift’s station', () => {
    const at19 = { station: 19, battalion: 9, division: 3 }
    expect(acceptLimitLabel({ ...at19, accept_limit: 'anyone' })).toBeNull()
    expect(acceptLimitLabel({ ...at19, accept_limit: 'station' })).toBe('Station 19 only')
    expect(acceptLimitLabel({ ...at19, accept_limit: 'battalion' })).toBe('Battalion 9 only')
    expect(acceptLimitLabel({ ...at19, accept_limit: 'division' })).toBe('Division 3 only')
  })

  it('lists dates in plain English', () => {
    expect(listDates([])).toBe('')
    expect(listDates(['2026-10-16'])).toBe('Oct 16')
    expect(listDates(['2026-10-16', '2026-10-20', '2026-10-22'])).toBe('Oct 16, Oct 20 and Oct 22')
    expect(listDates(['2026-10-16', '2026-10-20'], 'weekday')).toBe('Fri, Oct 16 and Tue, Oct 20')
  })

  it('pluralises', () => {
    expect(plural(1, 'shift')).toBe('1 shift')
    expect(plural(3, 'shift')).toBe('3 shifts')
  })
})

describe('list helpers', () => {
  it('groups sorted rows by date', () => {
    const rows = [
      { id: 'a', date: '2026-10-01' },
      { id: 'b', date: '2026-10-01' },
      { id: 'c', date: '2026-10-03' },
    ]
    expect(groupByDate(rows)).toEqual([
      { date: '2026-10-01', items: [rows[0], rows[1]] },
      { date: '2026-10-03', items: [rows[2]] },
    ])
  })

  it('drops repeated ids (overlapping pages)', () => {
    expect(uniqueById([{ id: 'a' }, { id: 'b' }, { id: 'a' }]).map((r) => r.id)).toEqual(['a', 'b'])
  })

  it('makes phone numbers dialable', () => {
    expect(dialable('(415) 555-1234')).toBe('4155551234')
    expect(dialable('+1 415 555 1234')).toBe('+14155551234')
    expect(dialable('555')).toBe('')
    expect(dialable(null)).toBe('')
  })
})

describe('action errors', () => {
  it('titles each code and keeps the database message', () => {
    const copy = describeActionError(new AppError('RANK_MISMATCH', 'Trades are same rank only.'), "Couldn't send")
    expect(copy).toEqual({ code: 'RANK_MISMATCH', title: 'Same rank only', description: 'Trades are same rank only.' })
  })

  it('falls back to the action title for generic codes', () => {
    expect(describeActionError(new AppError('UNKNOWN'), "Couldn't send").title).toBe("Couldn't send")
    expect(describeActionError(new Error('boom'), "Couldn't send").description).toBe('Something went wrong. Please try again.')
  })

  it('adds an explanation for double-booking, with per-action wording', () => {
    const err = new AppError('ALREADY_COVERING', 'Mike Lee is already covering a shift that day')
    expect(describeActionError(err, 'x').description).toBe(
      'Mike Lee is already covering a shift that day. ShiftSwap won’t put anyone on two shifts the same day.',
    )
    expect(describeActionError(err, 'x', { ALREADY_COVERING: 'Sort it out first.' }).description).toBe(
      'Mike Lee is already covering a shift that day. Sort it out first.',
    )
  })

  it("doesn't repeat admin advice the message already gives", () => {
    const err = new AppError('STARTED', 'This trade has already started. Ask an admin if it needs to be voided.')
    expect(describeActionError(err, 'x').description).toBe(err.message)
    expect(describeActionError(new AppError('STARTED', 'This shift has already started.'), 'x').description).toContain(
      'only an admin',
    )
  })

  it('classifies stale-data and account errors', () => {
    expect(isStaleDataError(new AppError('NOT_OPEN'))).toBe(true)
    expect(isStaleDataError(new AppError('NO_CANCEL_PENDING'))).toBe(true)
    expect(isStaleDataError(new AppError('RANK_MISMATCH'))).toBe(false)
    expect(isAccountError(new AppError('NOT_APPROVED'))).toBe(true)
    expect(isAccountError(new AppError('NETWORK'))).toBe(false)
  })
})
