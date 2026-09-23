import { describe, expect, it } from 'vitest'
import {
  acceptLimitExplanation,
  acceptLimitLabel,
  dateBlock,
  errorField,
  firstErrorField,
  hasErrors,
  lastPostableDate,
  listDates,
  MAX_RETURN_DATES,
  parseDateParam,
  pickerMonths,
  postableTourDays,
  returnDateBlock,
  shouldReloadAfter,
  summaryRows,
  toggleReturnDate,
  toPostInput,
  typeForDate,
  typeStarted,
  validatePost,
  type PostContext,
  type PostDraft,
} from '@/app/(app)/post/_components/post-model'
import { computeDays, type ScheduleDay, type ScheduleShift } from '@/lib/schedule/effective'
import { addDays, type Ymd } from '@/lib/sffd/dates'
import { tourDaysInRange, tourWorks } from '@/lib/sffd/tours'

const ME = 'me'
const MIKE = 'mike'
const ANA = 'ana'

// Tour 2 works 2026-09-23 (today), 09-26, 09-29, 10-03, … and is off 09-24, 09-25, 09-27, 09-28.
const TOUR = 2
const TODAY: Ymd = '2026-09-23'
// 10:00 in San Francisco (PDT): today's 24-Hour shift has started, the PM shift hasn't.
const NOW = new Date('2026-09-23T17:00:00Z')

function shift(partial: Partial<ScheduleShift> & Pick<ScheduleShift, 'id' | 'date'>): ScheduleShift {
  return {
    poster_id: ME,
    poster_name: 'Brian Machado',
    coverer_id: null,
    coverer_name: null,
    shift_type: '24-Hour',
    status: 'open',
    return_leg_of: null,
    return_leg_id: null,
    ...partial,
  }
}

const SHIFTS: ScheduleShift[] = [
  // Already posted: 09-29 (tour day).
  shift({ id: 'p1', date: '2026-09-29' }),
  // Given away to Mike: 10-03 (tour day).
  shift({ id: 'g1', date: '2026-10-03', status: 'covered', coverer_id: MIKE, coverer_name: 'Mike Lee' }),
  // I'm covering Ana on 09-25 (a day off for tour 2).
  shift({ id: 'c1', date: '2026-09-25', poster_id: ANA, poster_name: 'Ana Cruz', status: 'covered', coverer_id: ME }),
]

function context(tour: number | null = TOUR, now: Date = NOW, shifts: ScheduleShift[] = SHIFTS): PostContext {
  const list = computeDays({
    userId: ME,
    tour,
    myShifts: shifts,
    today: TODAY,
    fromYmd: TODAY,
    toYmd: lastPostableDate(TODAY),
  })
  return { tour, today: TODAY, now, days: new Map<Ymd, ScheduleDay>(list.map((d) => [d.ymd, d])) }
}

const CTX = context()
const NO_TOUR = context(null)

function draft(partial: Partial<PostDraft> = {}): PostDraft {
  return {
    date: '2026-09-26',
    shiftType: '24-Hour',
    station: 19,
    swapMatch: false,
    returnDates: [],
    acceptLimit: 'anyone',
    notes: '',
    ...partial,
  }
}

describe('window', () => {
  it('runs 180 days from today', () => {
    expect(lastPostableDate(TODAY)).toBe('2027-03-22')
    expect(pickerMonths(TODAY)).toEqual({ first: { year: 2026, month: 9 }, last: { year: 2027, month: 3 } })
  })
})

describe('dateBlock (post_shift date rules)', () => {
  it('allows my untraded tour days', () => {
    expect(dateBlock('2026-09-26', CTX)).toBeNull()
    // Today still has the PM shift ahead.
    expect(dateBlock(TODAY, CTX)).toBeNull()
  })

  it('explains every other case', () => {
    expect(dateBlock('2026-09-22', CTX)).toBe('past')
    expect(dateBlock('2026-9-26', CTX)).toBe('invalid')
    expect(dateBlock('2026-02-30', CTX)).toBe('invalid')
    expect(dateBlock('2026-09-29', CTX)).toBe('posted')
    expect(dateBlock('2026-10-03', CTX)).toBe('given-away')
    expect(dateBlock('2026-09-25', CTX)).toBe('covering')
    expect(dateBlock('2026-09-24', CTX)).toBe('not-your-day')
    const far = tourDaysInRange(TOUR, addDays(TODAY, 181), addDays(TODAY, 220))[0]
    expect(dateBlock(far, CTX)).toBe('too-far')
    // After 16:00 today nothing on today can be posted.
    expect(dateBlock(TODAY, context(TOUR, new Date('2026-09-23T23:00:00Z')))).toBe('started')
  })

  it('lets members without a tour post any open day', () => {
    expect(dateBlock('2026-09-24', NO_TOUR)).toBeNull()
    expect(dateBlock('2026-09-25', NO_TOUR)).toBe('covering')
    expect(dateBlock('2026-09-29', NO_TOUR)).toBe('posted')
    expect(dateBlock(lastPostableDate(TODAY), NO_TOUR)).toBeNull()
    expect(dateBlock(addDays(TODAY, 181), NO_TOUR)).toBe('too-far')
  })

  it('lists the tour days I can post', () => {
    const days = postableTourDays(CTX)
    expect(days.slice(0, 3)).toEqual([TODAY, '2026-09-26', '2026-10-06'])
    expect(days.every((d) => tourWorks(TOUR, d))).toBe(true)
    expect(days).not.toContain('2026-09-29')
    expect(days).not.toContain('2026-10-03')
    expect(days[days.length - 1] <= lastPostableDate(TODAY)).toBe(true)
    expect(postableTourDays(NO_TOUR)).toEqual([])
  })
})

describe('shift type', () => {
  it("switches to PM when today's 24-Hour has started", () => {
    expect(typeStarted(TODAY, '24-Hour', NOW)).toBe(true)
    expect(typeStarted(TODAY, 'PM', NOW)).toBe(false)
    expect(typeStarted(null, '24-Hour', NOW)).toBe(false)
    expect(typeForDate(TODAY, '24-Hour', NOW)).toBe('PM')
    expect(typeForDate('2026-09-26', '24-Hour', NOW)).toBe('24-Hour')
    expect(typeForDate('2026-09-26', 'PM', NOW)).toBe('PM')
  })
})

describe('parseDateParam (?date= prefill)', () => {
  it('uses a postable date and explains an unusable one', () => {
    expect(parseDateParam(null, CTX)).toEqual({ date: null, notice: null })
    expect(parseDateParam('2026-09-26', CTX)).toEqual({ date: '2026-09-26', notice: null })
    expect(parseDateParam('tomorrow', CTX).notice).toMatch(/isn't valid/)
    expect(parseDateParam('2026-09-24', CTX)).toEqual({
      date: null,
      notice: "Thursday, September 24, 2026 can't be posted. That isn't one of your tour days.",
    })
    expect(parseDateParam('2026-09-29', CTX).notice).toMatch(/already posted/)
    expect(parseDateParam('2026-09-24', NO_TOUR)).toEqual({ date: '2026-09-24', notice: null })
  })
})

describe('SwapMatch return dates', () => {
  const opts = { postDate: '2026-09-26', shiftType: '24-Hour' } as const

  it('offers only my days off', () => {
    expect(returnDateBlock('2026-09-24', CTX, opts)).toBeNull()
    expect(returnDateBlock('2026-09-27', CTX, opts)).toBeNull()
    expect(returnDateBlock('2026-09-26', CTX, opts)).toBe('post-date')
    expect(returnDateBlock('2026-10-06', CTX, opts)).toBe('working')
    // Picked-up days count as working; given-away days would clash on confirm.
    expect(returnDateBlock('2026-09-25', CTX, opts)).toBe('working')
    expect(returnDateBlock('2026-10-03', CTX, opts)).toBe('given-away')
    expect(returnDateBlock('2026-09-22', CTX, opts)).toBe('past')
    expect(returnDateBlock(addDays(TODAY, 181), CTX, opts)).toBe('too-far')
    expect(returnDateBlock('nope', CTX, opts)).toBe('invalid')
  })

  it("checks today's start time for the posted shift type", () => {
    const noTourToday = { postDate: '2026-09-24', shiftType: '24-Hour' } as const
    expect(returnDateBlock(TODAY, NO_TOUR, noTourToday)).toBe('past')
    expect(returnDateBlock(TODAY, NO_TOUR, { ...noTourToday, shiftType: 'PM' })).toBeNull()
  })

  it('blocks my open posts for members without a tour', () => {
    expect(returnDateBlock('2026-09-29', NO_TOUR, { postDate: '2026-09-24', shiftType: '24-Hour' })).toBe('posted')
  })

  it('toggles dates, sorted, at most ten', () => {
    expect(toggleReturnDate(['2026-10-01'], '2026-09-27')).toEqual(['2026-09-27', '2026-10-01'])
    expect(toggleReturnDate(['2026-09-27', '2026-10-01'], '2026-09-27')).toEqual(['2026-10-01'])
    const ten = Array.from({ length: MAX_RETURN_DATES }, (_, i) => addDays('2026-11-01', i))
    expect(toggleReturnDate(ten, '2026-12-01')).toEqual(ten)
    expect(toggleReturnDate(ten, ten[0])).toHaveLength(MAX_RETURN_DATES - 1)
  })
})

describe('who can take it', () => {
  it('labels limits relative to the shift station', () => {
    expect(acceptLimitLabel('anyone', 19, 19)).toBe('Anyone')
    expect(acceptLimitLabel('battalion', 19, 19)).toBe('My Battalion')
    expect(acceptLimitLabel('station', 19, 19)).toBe('My Station')
    expect(acceptLimitLabel('division', 7, 19)).toBe('Division 3')
    expect(acceptLimitLabel('battalion', 7, 19)).toBe('Battalion 6')
    expect(acceptLimitLabel('station', 102, 19)).toBe('Airport Station 2')
  })

  it('explains each limit in one line', () => {
    expect(acceptLimitExplanation('anyone', 19, 'Firefighter')).toBe('Any Firefighter in the department can ask for it.')
    expect(acceptLimitExplanation('division', 19, 'Captain')).toBe('Only Captains in Division 3 can ask for it.')
    expect(acceptLimitExplanation('battalion', 19, 'Lieutenant')).toBe('Only Lieutenants in Battalion 9 can ask for it.')
    expect(acceptLimitExplanation('station', 19, 'Firefighter')).toBe(
      'Only Firefighters assigned to Station 19 can ask for it.',
    )
  })
})

describe('validatePost', () => {
  it('accepts a complete straight post and a complete SwapMatch', () => {
    expect(validatePost(draft(), CTX)).toEqual({})
    expect(validatePost(draft({ swapMatch: true, returnDates: ['2026-09-24', '2026-09-27'] }), CTX)).toEqual({})
  })

  it('asks for the missing pieces', () => {
    const errors = validatePost(draft({ date: null, station: null, swapMatch: true }), CTX)
    expect(errors.date).toBe('Choose the shift you want to post.')
    expect(errors.station).toBe('Choose the station where the shift is.')
    expect(errors.returnDates).toMatch(/Pick at least one day/)
    expect(firstErrorField(errors)).toBe('date')
    expect(hasErrors(errors)).toBe(true)
    expect(validatePost(draft({ date: null }), NO_TOUR).date).toBe('Choose the date of the shift you want to post.')
  })

  it('mirrors the database rules', () => {
    expect(validatePost(draft({ date: '2026-09-29' }), CTX).date).toBe("You've already posted that shift.")
    expect(validatePost(draft({ date: TODAY }), CTX).shiftType).toMatch(/already started. Choose PM/)
    expect(validatePost(draft({ date: TODAY, shiftType: 'PM' }), CTX)).toEqual({})
    expect(validatePost(draft({ swapMatch: true, returnDates: ['2026-10-06'] }), CTX).returnDates).toBe(
      "Tue, Oct 6 can't be offered: you're working that day.",
    )
    const eleven = Array.from({ length: 11 }, (_, i) => addDays('2026-11-01', i))
    expect(validatePost(draft({ swapMatch: true, returnDates: eleven }), CTX).returnDates).toBe(
      'You can offer up to 10 days.',
    )
    expect(validatePost(draft({ notes: 'x'.repeat(501) }), CTX).notes).toMatch(/500/)
    // Return dates are ignored while SwapMatch is off.
    expect(validatePost(draft({ returnDates: ['2026-10-06'] }), CTX)).toEqual({})
  })
})

describe('toPostInput', () => {
  it('sends return dates only for a SwapMatch and trims notes', () => {
    expect(toPostInput(draft({ returnDates: ['2026-09-27'], notes: '   ' }))).toEqual({
      date: '2026-09-26',
      shiftType: '24-Hour',
      station: 19,
      returnDates: [],
      acceptLimit: 'anyone',
      notes: null,
    })
    expect(
      toPostInput(
        draft({ swapMatch: true, returnDates: ['2026-09-27', '2026-09-24'], acceptLimit: 'battalion', notes: ' Hi ' }),
      ),
    ).toMatchObject({ returnDates: ['2026-09-24', '2026-09-27'], acceptLimit: 'battalion', notes: 'Hi' })
    expect(() => toPostInput(draft({ date: null }))).toThrow()
  })
})

describe('server errors', () => {
  it('puts each post_shift error next to the right field', () => {
    expect(errorField('ALREADY_POSTED')).toBe('date')
    expect(errorField('NOT_YOUR_SHIFT_DAY')).toBe('date')
    expect(errorField('STARTED')).toBe('date')
    expect(errorField('TOO_FAR_AHEAD')).toBe('date')
    expect(errorField('POSTER_WORKS_RETURN_DAY')).toBe('returnDates')
    expect(errorField('RETURN_DATE_INVALID')).toBe('returnDates')
    expect(errorField('ACK_REQUIRED')).toBe('form')
    expect(errorField('NETWORK')).toBe('form')
    expect(shouldReloadAfter('ALREADY_POSTED')).toBe(true)
    expect(shouldReloadAfter('NETWORK')).toBe(false)
  })
})

describe('summary', () => {
  it('describes the post in plain English', () => {
    const rows = summaryRows(
      draft({ swapMatch: true, returnDates: ['2026-10-09', '2026-10-01', '2026-10-04'], acceptLimit: 'battalion' }),
      'Firefighter',
    )
    expect(rows).toEqual([
      { label: 'Shift', value: 'Saturday, September 26, 2026 · 24-Hour · 0800–0800 (24 hours)' },
      { label: 'Where', value: 'Station 19 · Battalion 9 · Division 3' },
      {
        label: 'In return',
        value: 'SwapMatch: they pick one of Oct 1, Oct 4 and Oct 9 and you work their shift that day.',
      },
      { label: 'Who can take it', value: 'Only Firefighters in Battalion 9 can ask for it.' },
      { label: 'Notes', value: 'None' },
    ])
    const empty = summaryRows(draft({ date: null, station: null }), 'Firefighter')
    expect(empty[0]).toEqual({ label: 'Shift', value: 'Pick a date', missing: true })
    expect(empty[1].missing).toBe(true)
    expect(listDates(['2026-10-01'])).toBe('Oct 1')
    expect(listDates([])).toBe('')
  })
})
