// Helpers behind /profile (src/app/(app)/profile/_components/profile-model.ts).
import { describe, expect, it } from 'vitest'
import type { Shift } from '@/lib/types/database'
import {
  balanceSentence,
  clampScore,
  coversInRange,
  detailsSchema,
  formatSigned,
  isValidPhone,
  locationLabels,
  monthRange,
  notifyScopeDescription,
  notifyScopeLabel,
  passwordSchema,
  reciprocity,
  tourLabel,
  trustHeadline,
  trustMessage,
} from '@/app/(app)/profile/_components/profile-model'

const ME = '00000000-0000-4000-8000-000000000001'
const ANA = '00000000-0000-4000-8000-000000000002'

let seq = 0
function shift(overrides: Partial<Shift> = {}): Shift {
  seq += 1
  const date = overrides.date ?? '2026-09-10'
  return {
    id: `10000000-0000-4000-8000-${String(seq).padStart(12, '0')}`,
    poster_id: ANA,
    poster_name: 'Ana Cruz',
    rank: 'Firefighter',
    station: 19,
    battalion: 9,
    division: 3,
    date,
    shift_type: '24-Hour',
    hours: 24,
    starts_at: `${date}T15:00:00Z`,
    status: 'covered',
    return_dates: [],
    accept_limit: 'anyone',
    notes: null,
    coverer_id: ME,
    coverer_name: 'Brian Machado',
    confirmed_at: '2026-09-01T00:00:00Z',
    return_leg_of: null,
    return_leg_id: null,
    cancel_requested_by: null,
    cancel_requested_at: null,
    cancel_reason: null,
    cancelled_at: null,
    cancelled_by: null,
    cancel_note: null,
    created_at: '2026-09-01T00:00:00Z',
    updated_at: '2026-09-01T00:00:00Z',
    ...overrides,
  }
}

describe('identity labels', () => {
  it('labels tours', () => {
    expect(tourLabel(12)).toBe('Tour 12')
    expect(tourLabel(null)).toBe('No tour')
    expect(tourLabel(undefined)).toBe('No tour')
    expect(tourLabel(40)).toBe('No tour')
  })

  it('labels station, battalion and division', () => {
    expect(locationLabels(19)).toEqual({ station: 'Station 19', battalion: 'Battalion 9', division: 'Division 3' })
    expect(locationLabels(101)).toEqual({
      station: 'Airport Station 1',
      battalion: 'Airport Battalion',
      division: 'Airport Division',
    })
    expect(locationLabels(null)).toBeNull()
  })
})

describe('new-shift alert scope', () => {
  it('uses plain labels', () => {
    expect(notifyScopeLabel('off')).toBe('Off')
    expect(notifyScopeLabel('station')).toBe('My Station')
    expect(notifyScopeLabel('all')).toBe('Everywhere')
    expect(notifyScopeLabel('nonsense')).toBe('My Battalion')
  })

  it('words each option with the chosen station', () => {
    expect(notifyScopeDescription('station', 19)).toBe('New shifts at Station 19')
    expect(notifyScopeDescription('battalion', 19)).toBe('New shifts in Battalion 9')
    expect(notifyScopeDescription('division', 19)).toBe('New shifts in Division 3')
    expect(notifyScopeDescription('all', 19)).toBe('New shifts anywhere in the department')
    expect(notifyScopeDescription('battalion', null)).toBe('New shifts in your battalion')
    expect(notifyScopeDescription('off', 19)).toMatch(/still get alerts about your own trades/)
  })
})

describe('stats', () => {
  it('formats signed balances with a real minus sign', () => {
    expect(formatSigned(2)).toBe('+2')
    expect(formatSigned(0)).toBe('0')
    expect(formatSigned(-3)).toBe('−3')
  })

  it('describes the balance', () => {
    expect(balanceSentence({ covered: 0, given: 0 })).toMatch(/No trades yet/)
    expect(balanceSentence({ covered: 3, given: 1 })).toBe("You've covered 2 more shifts than you've given away.")
    expect(balanceSentence({ covered: 1, given: 2 })).toBe("You've given away 1 more shift than you've covered.")
    expect(balanceSentence({ covered: 2, given: 2 })).toMatch(/You're even/)
  })

  it('splits the reciprocity bar into two shares that add up to 100', () => {
    expect(reciprocity(0, 0)).toBeNull()
    expect(reciprocity(3, 1)).toEqual({ coveredPct: 75, givenPct: 25, total: 4 })
    expect(reciprocity(1, 2)).toEqual({ coveredPct: 33, givenPct: 67, total: 3 })
    expect(reciprocity(5, 0)).toEqual({ coveredPct: 100, givenPct: 0, total: 5 })
  })
})

describe('trust score copy', () => {
  it('clamps scores and picks a positive headline', () => {
    expect(clampScore(140)).toBe(100)
    expect(clampScore(-5)).toBe(0)
    expect(clampScore(null)).toBe(100)
    expect(trustHeadline(95).text).toBe('Great teammate')
    expect(trustHeadline(75).text).toBe('Reliable teammate')
    expect(trustHeadline(55).text).toBe('Good teammate')
    expect(trustHeadline(20).text).toBe('Building your score')
  })

  it('mentions shifts covered this month', () => {
    const base = { covered: 5, given: 2, outstanding: 0 }
    expect(trustMessage(100, { ...base, month: { done: 3, upcoming: 1 } })).toBe(
      "Great teammate — you've covered 3 shifts this month.",
    )
    expect(trustMessage(100, { ...base, month: { done: 0, upcoming: 1 } })).toBe(
      "Great teammate — you're covering 1 shift this month.",
    )
  })

  it('stays warm without recent covers', () => {
    expect(trustMessage(100, { covered: 0, given: 0, outstanding: 0, month: null })).toBe(
      "Great teammate — you're starting with a perfect score.",
    )
    expect(trustMessage(100, { covered: 4, given: 4, outstanding: 0, month: { done: 0, upcoming: 0 } })).toBe(
      'Great teammate — members can count on you.',
    )
    expect(trustMessage(80, { covered: 1, given: 3, outstanding: 2, month: null })).toMatch(
      /^Reliable teammate — covering a shift, or taking down a post/,
    )
  })
})

describe('month covers', () => {
  it('finds the first and last day of the month', () => {
    expect(monthRange('2026-09-23')).toEqual({ from: '2026-09-01', to: '2026-09-30' })
    expect(monthRange('2028-02-10')).toEqual({ from: '2028-02-01', to: '2028-02-29' })
  })

  it('counts shifts I cover this month, split into done and upcoming', () => {
    const now = Date.parse('2026-09-23T19:00:00Z')
    const range = monthRange('2026-09-23')
    const shifts = [
      shift({ date: '2026-09-10' }), // done
      shift({ date: '2026-09-23', starts_at: '2026-09-23T15:00:00Z' }), // started this morning
      shift({ date: '2026-09-28' }), // upcoming
      shift({ date: '2026-10-02' }), // next month
      shift({ date: '2026-09-12', poster_id: ME, coverer_id: ANA }), // someone covered me
      shift({ date: '2026-09-14', status: 'open', coverer_id: null }), // not a trade
    ]
    expect(coversInRange(shifts, ME, range, now)).toEqual({ done: 2, upcoming: 1 })
  })
})

describe('forms', () => {
  it('checks phone numbers like the database does', () => {
    expect(isValidPhone('415-555-0123')).toBe(true)
    expect(isValidPhone('(415) 555 0123')).toBe(true)
    expect(isValidPhone('+1 415 555 0123')).toBe(true)
    expect(isValidPhone('555-12')).toBe(false)
    expect(isValidPhone('call me')).toBe(false)
    expect(isValidPhone('------------')).toBe(false)
  })

  it('validates the details form', () => {
    const ok = detailsSchema.safeParse({ phone: ' 415-555-0123 ', station: 19, tour: null, notifyScope: 'division' })
    expect(ok.success).toBe(true)
    expect(ok.data?.phone).toBe('415-555-0123')

    const bad = detailsSchema.safeParse({ phone: '12', station: null, tour: 44, notifyScope: 'battalion' })
    expect(bad.success).toBe(false)
    const paths = bad.error?.issues.map((i) => i.path.join('.')).sort()
    expect(paths).toEqual(['phone', 'station', 'tour'])
  })

  it('validates a new password and its confirmation', () => {
    expect(passwordSchema.safeParse({ password: 'longenough', confirmPassword: 'longenough' }).success).toBe(true)
    const short = passwordSchema.safeParse({ password: 'short', confirmPassword: 'short' })
    expect(short.error?.issues[0]?.message).toBe('Use at least 8 characters.')
    const mismatch = passwordSchema.safeParse({ password: 'longenough', confirmPassword: 'longenougH' })
    expect(mismatch.error?.issues[0]?.path).toEqual(['confirmPassword'])
  })
})
