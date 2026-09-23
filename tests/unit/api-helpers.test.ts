// Pure helpers of the API layer (no Supabase client involved).

import { describe, expect, it } from 'vitest'
import {
  acceptLimitFilter,
  boardCursorFilter,
  boardCursorOf,
  calendarFeedPath,
  calendarFeedUrls,
  countByDate,
  latestRequestByShift,
  notificationCursorFilter,
  pendingNotesByMember,
  pushSubscriptionInput,
  rankRosterCandidates,
  rosterLastKeys,
  withinAcceptLimit,
} from '@/lib/api'
import {
  assertDate,
  assertInt,
  assertUuid,
  blankToNull,
  clampLimit,
  ilikeContains,
  isUuid,
  quoteFilterValue,
  sanitizeSearch,
} from '@/lib/api/core'
import { AppError } from '@/lib/errors'

const ID = '11111111-1111-4111-8111-111111111111'

describe('input checks', () => {
  it('isUuid / assertUuid', () => {
    expect(isUuid(ID)).toBe(true)
    expect(isUuid(ID.toUpperCase())).toBe(true)
    expect(isUuid('1111')).toBe(false)
    expect(isUuid(`${ID},id.neq.x`)).toBe(false)
    expect(isUuid(null)).toBe(false)
    expect(assertUuid(ID)).toBe(ID)
    expect(() => assertUuid('nope', 'shift')).toThrowError(AppError)
    try {
      assertUuid('nope', 'shift')
    } catch (e) {
      expect(e).toMatchObject({ code: 'INVALID_INPUT', message: "That shift link isn't valid." })
    }
  })

  it('assertDate / assertInt', () => {
    expect(assertDate('2026-02-28')).toBe('2026-02-28')
    expect(() => assertDate('2026-02-30')).toThrow(AppError)
    expect(() => assertDate('2026-9-1')).toThrow(AppError)
    expect(assertInt(19)).toBe(19)
    expect(() => assertInt(1.5)).toThrow(AppError)
    expect(() => assertInt('19')).toThrow(AppError)
  })

  it('clampLimit', () => {
    expect(clampLimit(undefined, 20)).toBe(20)
    expect(clampLimit(Number.NaN, 20)).toBe(20)
    expect(clampLimit(0, 20)).toBe(1)
    expect(clampLimit(-5, 20)).toBe(1)
    expect(clampLimit(10.9, 20)).toBe(10)
    expect(clampLimit(10_000, 20, 100)).toBe(100)
  })

  it('blankToNull', () => {
    expect(blankToNull('  hi ')).toBe('hi')
    expect(blankToNull('   ')).toBeNull()
    expect(blankToNull(null)).toBeNull()
    expect(blankToNull(undefined)).toBeNull()
  })
})

describe('filter building', () => {
  it('quoteFilterValue escapes quotes and backslashes', () => {
    expect(quoteFilterValue('2026-09-20T17:05:03.1+00:00')).toBe('"2026-09-20T17:05:03.1+00:00"')
    expect(quoteFilterValue('a"b\\c')).toBe('"a\\"b\\\\c"')
  })

  it('sanitizeSearch strips wildcard and filter syntax', () => {
    expect(sanitizeSearch('  Smith  ')).toBe('Smith')
    expect(sanitizeSearch('%_*')).toBe('')
    expect(sanitizeSearch('a,b(c)d:e"f\\g')).toBe('a b c d e f g')
    expect(sanitizeSearch("O'Brien")).toBe("O'Brien")
    expect(sanitizeSearch('x'.repeat(100))).toHaveLength(60)
    expect(sanitizeSearch(null)).toBe('')
  })

  it('ilikeContains', () => {
    expect(ilikeContains('full_name', 'ana diaz')).toBe('full_name.ilike."%ana diaz%"')
  })

  it('acceptLimitFilter includes only the viewer’s known location', () => {
    expect(acceptLimitFilter({ station: 19, battalion: 9, division: 3 })).toBe(
      'accept_limit.eq.anyone,and(accept_limit.eq.division,division.eq.3),and(accept_limit.eq.battalion,battalion.eq.9),and(accept_limit.eq.station,station.eq.19)',
    )
    expect(acceptLimitFilter({ station: null, battalion: null, division: null })).toBe('accept_limit.eq.anyone')
  })

  it('withinAcceptLimit mirrors OUTSIDE_LIMIT', () => {
    const shift = { station: 19, battalion: 9, division: 3 }
    const viewer = { station: 33, battalion: 9, division: 3 }
    expect(withinAcceptLimit({ ...shift, accept_limit: 'anyone' }, viewer)).toBe(true)
    expect(withinAcceptLimit({ ...shift, accept_limit: 'division' }, viewer)).toBe(true)
    expect(withinAcceptLimit({ ...shift, accept_limit: 'battalion' }, viewer)).toBe(true)
    expect(withinAcceptLimit({ ...shift, accept_limit: 'station' }, viewer)).toBe(false)
    expect(withinAcceptLimit({ ...shift, accept_limit: 'division' }, { station: 1, battalion: 2, division: 3 })).toBe(true)
    expect(withinAcceptLimit({ ...shift, accept_limit: 'battalion' }, { station: 1, battalion: 2, division: 3 })).toBe(false)
  })

  it('boardCursorFilter / boardCursorOf', () => {
    const cursor = boardCursorOf({ date: '2026-10-02', created_at: '2026-09-20T17:05:03.123456+00:00', id: ID })
    expect(cursor).toEqual({ date: '2026-10-02', created_at: '2026-09-20T17:05:03.123456+00:00', id: ID })
    expect(boardCursorFilter(cursor)).toBe(
      `date.gt.2026-10-02,and(date.eq.2026-10-02,created_at.gt."2026-09-20T17:05:03.123456+00:00"),and(date.eq.2026-10-02,created_at.eq."2026-09-20T17:05:03.123456+00:00",id.gt.${ID})`,
    )
    expect(() => boardCursorFilter({ ...cursor, date: 'x' })).toThrow(AppError)
    expect(() => boardCursorFilter({ ...cursor, id: 'x' })).toThrow(AppError)
    expect(() => boardCursorFilter({ ...cursor, created_at: 'not a time' })).toThrow(AppError)
  })

  it('notificationCursorFilter', () => {
    expect(notificationCursorFilter({ created_at: '2026-09-23T10:00:00+00:00', id: ID })).toBe(
      `created_at.lt."2026-09-23T10:00:00+00:00",and(created_at.eq."2026-09-23T10:00:00+00:00",id.lt.${ID})`,
    )
    expect(() => notificationCursorFilter({ created_at: 'x', id: ID })).toThrow(AppError)
  })
})

describe('schedule helpers', () => {
  it('countByDate', () => {
    expect(countByDate([{ date: '2026-10-01' }, { date: '2026-10-01' }, { date: '2026-10-03' }, { date: 'bad' }])).toEqual({
      '2026-10-01': 2,
      '2026-10-03': 1,
    })
    expect(countByDate([])).toEqual({})
  })

  it('calendar feed links', () => {
    expect(calendarFeedPath(ID)).toBe(`/api/calendar/${ID}`)
    expect(calendarFeedUrls('https://shiftswap.example', ID)).toEqual({
      https: `https://shiftswap.example/api/calendar/${ID}`,
      webcal: `webcal://shiftswap.example/api/calendar/${ID}`,
    })
    expect(calendarFeedUrls('http://localhost:3000/', ID).webcal).toBe(`webcal://localhost:3000/api/calendar/${ID}`)
  })
})

describe('latestRequestByShift', () => {
  it('prefers a pending request, then the newest', () => {
    const rows = [
      { id: 'a', shift_id: 's1', status: 'declined' as const, created_at: '2026-09-23T10:00:00+00:00' },
      { id: 'b', shift_id: 's1', status: 'pending' as const, created_at: '2026-09-22T10:00:00+00:00' },
      { id: 'c', shift_id: 's2', status: 'withdrawn' as const, created_at: '2026-09-21T10:00:00+00:00' },
      { id: 'd', shift_id: 's2', status: 'declined' as const, created_at: '2026-09-22T10:00:00+00:00' },
    ]
    const map = latestRequestByShift(rows)
    expect(map.get('s1')?.id).toBe('b')
    expect(map.get('s2')?.id).toBe('d')
    expect(map.size).toBe(2)
  })
})

describe('pendingNotesByMember', () => {
  it('takes the latest note per member and counts attempts', () => {
    const other = '22222222-2222-4222-8222-222222222222'
    const notes = pendingNotesByMember([
      { target_id: ID, created_at: '2026-09-21T10:00:00+00:00', details: { roster_note: 'first', attempt: 1 } },
      {
        target_id: ID,
        created_at: '2026-09-23T10:00:00+00:00',
        details: { roster_note: 'third', roster_id: other, attempt: 3, auto_approve_blocked: true },
      },
      { target_id: ID, created_at: '2026-09-22T10:00:00+00:00', details: { roster_note: 'second', attempt: 2 } },
      { target_id: other, created_at: '2026-09-23T10:00:00+00:00', details: { roster_id: 'not-a-uuid' } },
      { target_id: null, created_at: '2026-09-23T10:00:00+00:00', details: {} },
    ])
    expect(notes.get(ID)).toEqual({
      rosterNote: 'third',
      rosterId: other,
      attempts: 3,
      autoApproveBlocked: true,
      submittedAt: '2026-09-23T10:00:00+00:00',
    })
    expect(notes.get(other)).toEqual({
      rosterNote: null,
      rosterId: null,
      attempts: 1,
      autoApproveBlocked: false,
      submittedAt: '2026-09-23T10:00:00+00:00',
    })
    expect(notes.size).toBe(2)
  })
})

describe('roster candidates', () => {
  it('rosterLastKeys tries the last word and compound last names', () => {
    expect(rosterLastKeys('John Smith')).toEqual(['smith'])
    expect(rosterLastKeys('Maria De La Cruz')).toEqual(['cruz', 'delacruz'])
    expect(rosterLastKeys('De La Cruz, Maria')).toEqual(['delacruz'])
    expect(rosterLastKeys("Seán O'Brien Jr.")).toEqual(['obrien'])
    expect(rosterLastKeys('Cher')).toEqual([])
    expect(rosterLastKeys('   ')).toEqual([])
  })

  it('rankRosterCandidates: exact first name, then initial, unclaimed first', () => {
    const rows = [
      { id: 'x', first_key: 'jane', claimed_by: null },
      { id: 'initial', first_key: 'j', claimed_by: null },
      { id: 'claimed', first_key: 'john', claimed_by: ID },
      { id: 'exact', first_key: 'john', claimed_by: null },
    ]
    expect(rankRosterCandidates(rows, 'John Smith').map((r) => r.id)).toEqual(['exact', 'claimed', 'initial', 'x'])
  })
})

describe('pushSubscriptionInput', () => {
  it('reads PushSubscription.toJSON()', () => {
    expect(
      pushSubscriptionInput({ endpoint: 'https://fcm.googleapis.com/fcm/send/a', keys: { p256dh: 'k', auth: 's' } }, 'UA'),
    ).toEqual({ endpoint: 'https://fcm.googleapis.com/fcm/send/a', p256dh: 'k', auth: 's', userAgent: 'UA' })
  })

  it('null when anything is missing', () => {
    expect(pushSubscriptionInput({ endpoint: 'https://x/', keys: { p256dh: 'k' } })).toBeNull()
    expect(pushSubscriptionInput({ keys: { p256dh: 'k', auth: 's' } })).toBeNull()
    expect(pushSubscriptionInput(null)).toBeNull()
  })
})
