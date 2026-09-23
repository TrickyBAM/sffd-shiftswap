// The API layer driven through the real supabase-js client with a fake fetch:
// checks the exact PostgREST requests each wrapper sends and how responses and
// failures come back (typed data or AppError). No network.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AuthApiError, AuthSessionMissingError, createClient, type SupabaseClient } from '@supabase/supabase-js'
import { AppError, GENERIC_MESSAGE, NETWORK_MESSAGE } from '@/lib/errors'
import {
  adminRemoveMember,
  callRpc,
  confirmRequest,
  deletePushSubscription,
  getMemberCards,
  getMyProfile,
  getMySchedule,
  getShift,
  getShiftEligibility,
  getTrade,
  hasPushSubscription,
  importRoster,
  listAdminShifts,
  listBoardShifts,
  listIncomingRequests,
  listMembers,
  listMessages,
  listMyRequests,
  listMyTrades,
  listNotifications,
  listPendingApprovals,
  listUndoneTrades,
  markNotificationsRead,
  postShift,
  PUSH_UNSUPPORTED_MESSAGE,
  requestShift,
  resolveUserId,
  savePushSubscription,
  undoneTradesFrom,
  unreadCount,
  unreadMessagesBySender,
  updateMyProfile,
  type RequestWithShift,
} from '@/lib/api'
import { sessionCheckError } from '@/lib/api/core'
import type { Shift } from '@/lib/types/database'

const ME = '11111111-1111-4111-8111-111111111111'
const OTHER = '22222222-2222-4222-8222-222222222222'
const SHIFT = '33333333-3333-4333-8333-333333333333'
const LEG = '44444444-4444-4444-8444-444444444444'

interface Call {
  method: string
  url: URL
  path: string
  headers: Headers
  body: unknown
}

type Responder = (call: Call) => Response | Promise<Response>

function json(data: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json', ...headers } })
}

function fakeSupabase(respond: Responder): { sb: SupabaseClient; calls: Call[] } {
  const calls: Call[] = []
  const fetchImpl = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url)
    const raw = init?.body
    const call: Call = {
      method: init?.method ?? 'GET',
      url,
      path: url.pathname,
      headers: new Headers(init?.headers),
      body: typeof raw === 'string' && raw ? JSON.parse(raw) : undefined,
    }
    calls.push(call)
    return respond(call)
  }
  const sb = createClient('https://abc.supabase.co', 'sb_publishable_test', {
    global: { fetch: fetchImpl },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  })
  return { sb, calls }
}

/** All values of a query parameter, in order. */
function params(call: Call, key: string): string[] {
  return call.url.searchParams.getAll(key)
}

function shiftRow(overrides: Partial<Shift> = {}): Shift {
  return {
    id: SHIFT,
    poster_id: OTHER,
    poster_name: 'Pat Poster',
    rank: 'Firefighter',
    station: 19,
    battalion: 9,
    division: 3,
    date: '2026-10-01',
    shift_type: '24-Hour',
    hours: 24,
    starts_at: '2026-10-01T15:00:00+00:00',
    status: 'open',
    return_dates: [],
    accept_limit: 'anyone',
    notes: null,
    coverer_id: null,
    coverer_name: null,
    confirmed_at: null,
    return_leg_of: null,
    return_leg_id: null,
    cancel_requested_by: null,
    cancel_requested_at: null,
    cancel_reason: null,
    cancelled_at: null,
    cancelled_by: null,
    cancel_note: null,
    created_at: '2026-09-20T17:05:03.123456+00:00',
    updated_at: '2026-09-20T17:05:03.123456+00:00',
    ...overrides,
  }
}

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

// ---------------------------------------------------------------------------
// RPC plumbing and error mapping
// ---------------------------------------------------------------------------

describe('callRpc', () => {
  it('POSTs the exact SQL argument names and returns the data', async () => {
    const { sb, calls } = fakeSupabase(() => json('55555555-5555-4555-8555-555555555555'))
    const id = await postShift(sb, {
      date: '2026-10-01',
      shiftType: 'PM',
      returnDates: ['2026-10-05', '2026-10-09'],
      acceptLimit: 'battalion',
      notes: '  bring coffee  ',
    })
    expect(id).toBe('55555555-5555-4555-8555-555555555555')
    expect(calls).toHaveLength(1)
    expect(calls[0].method).toBe('POST')
    expect(calls[0].path).toBe('/rest/v1/rpc/post_shift')
    expect(calls[0].body).toEqual({
      p_date: '2026-10-01',
      p_shift_type: 'PM',
      p_station: null,
      p_return_dates: ['2026-10-05', '2026-10-09'],
      p_accept_limit: 'battalion',
      p_notes: 'bring coffee',
    })
  })

  it('sends nulls for omitted optional arguments', async () => {
    const { sb, calls } = fakeSupabase(() => json('55555555-5555-4555-8555-555555555555'))
    await postShift(sb, { date: '2026-10-01', shiftType: '24-Hour', notes: '   ' })
    expect(calls[0].body).toEqual({
      p_date: '2026-10-01',
      p_shift_type: '24-Hour',
      p_station: null,
      p_return_dates: null,
      p_accept_limit: null,
      p_notes: null,
    })
    await requestShift(sb, { shiftId: SHIFT })
    expect(calls[1].body).toEqual({ p_shift_id: SHIFT, p_return_date: null, p_message: null })
  })

  it('turns a raised rule failure into AppError(hint, message)', async () => {
    const { sb } = fakeSupabase(() =>
      json({ code: 'P0001', details: null, hint: 'ALREADY_POSTED', message: 'You already posted or traded your Thu Oct 1 shift.' }, 400),
    )
    const error = await postShift(sb, { date: '2026-10-01', shiftType: '24-Hour' }).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(AppError)
    expect(error).toMatchObject({
      code: 'ALREADY_POSTED',
      message: 'You already posted or traded your Thu Oct 1 shift.',
      status: 400,
    })
  })

  it('network failure → AppError NETWORK', async () => {
    const { sb } = fakeSupabase(() => {
      throw new TypeError('Failed to fetch')
    })
    await expect(callRpc(sb, 'my_stats', {})).rejects.toMatchObject({ code: 'NETWORK', message: NETWORK_MESSAGE, status: 0 })
  })

  it('paused backend (HTML page instead of JSON) → AppError NETWORK', async () => {
    const html = '<!DOCTYPE html><html><head><title>Project paused</title></head><body></body></html>'
    for (const status of [200, 503, 540]) {
      const { sb } = fakeSupabase(() => new Response(html, { status, headers: { 'content-type': 'text/html' } }))
      await expect(callRpc(sb, 'my_stats', {})).rejects.toMatchObject({ code: 'NETWORK', message: NETWORK_MESSAGE })
    }
  })

  it("an empty JSON error body never shows up as '{}'", async () => {
    const { sb } = fakeSupabase(() => json({}, 500))
    await expect(callRpc(sb, 'my_stats', {})).rejects.toMatchObject({ code: 'UNKNOWN', message: GENERIC_MESSAGE })
  })

  it('returns jsonb results as objects', async () => {
    const { sb } = fakeSupabase(() => json({ shift_id: SHIFT, return_leg_id: LEG }))
    await expect(confirmRequest(sb, '66666666-6666-4666-8666-666666666666')).resolves.toEqual({
      shift_id: SHIFT,
      return_leg_id: LEG,
    })
  })

  it('void RPCs resolve to undefined', async () => {
    const { sb, calls } = fakeSupabase(() => new Response(null, { status: 204 }))
    await expect(
      updateMyProfile(sb, { phone: '415-555-0100', station: 19, tour: null, notifyScope: 'battalion' }),
    ).resolves.toBeUndefined()
    expect(calls[0].body).toEqual({ p_phone: '415-555-0100', p_station: 19, p_tour: null, p_notify_scope: 'battalion' })
  })

  it('normalizes shift_eligibility', async () => {
    const { sb, calls } = fakeSupabase(() =>
      json({
        eligible: false,
        reasons: [{ code: 'YOU_WORK_THAT_DAY', message: "You're working on Thu Oct 1." }],
        valid_return_dates: [],
      }),
    )
    const result = await getShiftEligibility(sb, SHIFT)
    expect(calls[0].body).toEqual({ p_shift_id: SHIFT, p_return_date: null })
    expect(result.eligible).toBe(false)
    expect(result.reasons[0].code).toBe('YOU_WORK_THAT_DAY')
  })

  it('markNotificationsRead: null means all; bad ids are dropped', async () => {
    const { sb, calls } = fakeSupabase(() => new Response(null, { status: 204 }))
    await markNotificationsRead(sb)
    await markNotificationsRead(sb, ['nope', SHIFT, SHIFT])
    await markNotificationsRead(sb, ['nope'])
    expect(calls.map((c) => c.body)).toEqual([{ p_ids: null }, { p_ids: [SHIFT] }])
  })

  it('importRoster sends rows and the replace flag', async () => {
    const { sb, calls } = fakeSupabase(() => json({ inserted: 1, updated: 0, skipped: 0, deleted: 3, errors: [] }))
    const result = await importRoster(sb, [{ first_name: 'Ana', last_name: 'Diaz', station: 19 }], { replace: true })
    expect(calls[0].path).toBe('/rest/v1/rpc/admin_import_roster')
    expect(calls[0].body).toEqual({ p_rows: [{ first_name: 'Ana', last_name: 'Diaz', station: 19 }], p_replace: true })
    expect(result).toEqual({ inserted: 1, updated: 0, skipped: 0, deleted: 3, errors: [] })
  })
})

describe('push flush after notifying mutations', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  it('does nothing on the server (no window)', async () => {
    const flush = vi.fn(async () => new Response(null, { status: 202 }))
    vi.stubGlobal('fetch', flush)
    const { sb } = fakeSupabase(() => json(SHIFT))
    await requestShift(sb, { shiftId: SHIFT })
    await vi.runAllTimersAsync()
    expect(flush).not.toHaveBeenCalled()
  })

  it('in the browser, one coalesced POST /api/push/flush after notifying calls only', async () => {
    const flush = vi.fn(async () => new Response(null, { status: 202 }))
    vi.stubGlobal('window', {})
    vi.stubGlobal('fetch', flush)
    const { sb } = fakeSupabase(() => json(SHIFT))

    await callRpc(sb, 'my_stats', {})
    await vi.runAllTimersAsync()
    expect(flush).not.toHaveBeenCalled()

    await requestShift(sb, { shiftId: SHIFT })
    await requestShift(sb, { shiftId: SHIFT })
    await vi.runAllTimersAsync()
    expect(flush).toHaveBeenCalledTimes(1)
    expect(flush).toHaveBeenCalledWith('/api/push/flush', expect.objectContaining({ method: 'POST', keepalive: true }))
  })

  it('a failed flush is swallowed', async () => {
    vi.stubGlobal('window', {})
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('Failed to fetch'))))
    const { sb } = fakeSupabase(() => json(SHIFT))
    await expect(requestShift(sb, { shiftId: SHIFT })).resolves.toBe(SHIFT)
    await vi.runAllTimersAsync()
  })

  it('no flush when the RPC fails', async () => {
    const flush = vi.fn(async () => new Response(null, { status: 202 }))
    vi.stubGlobal('window', {})
    vi.stubGlobal('fetch', flush)
    const { sb } = fakeSupabase(() => json({ code: 'P0001', message: 'This shift is no longer open.', hint: 'NOT_OPEN' }, 400))
    await expect(requestShift(sb, { shiftId: SHIFT })).rejects.toMatchObject({ code: 'NOT_OPEN' })
    await vi.runAllTimersAsync()
    expect(flush).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

describe('session', () => {
  it('without a session, "my" reads throw NOT_SIGNED_IN before querying', async () => {
    const { sb, calls } = fakeSupabase(() => json([]))
    await expect(getMyProfile(sb)).rejects.toMatchObject({ code: 'NOT_SIGNED_IN' })
    await expect(listMyTrades(sb, { scope: 'confirmed' })).rejects.toMatchObject({ code: 'NOT_SIGNED_IN' })
    expect(calls.filter((c) => c.path.startsWith('/rest/'))).toHaveLength(0)
  })

  it('getMyProfile filters by my id and returns the row or null', async () => {
    const row = { id: ME, full_name: 'Me' }
    const { sb, calls } = fakeSupabase(() => json([row]))
    await expect(getMyProfile(sb, ME)).resolves.toEqual(row)
    expect(calls[0].path).toBe('/rest/v1/profiles')
    expect(params(calls[0], 'id')).toEqual([`eq.${ME}`])

    const empty = fakeSupabase(() => json([]))
    await expect(getMyProfile(empty.sb, ME)).resolves.toBeNull()
  })

  it('a failed profile read is an error, never "no profile"', async () => {
    const { sb } = fakeSupabase(() => {
      throw new TypeError('fetch failed')
    })
    // GETs are retried by supabase-js; keep the test fast.
    vi.useFakeTimers()
    const pending = getMyProfile(sb, ME).catch((e: unknown) => e)
    await vi.runAllTimersAsync()
    expect(await pending).toMatchObject({ code: 'NETWORK' })
  })
})

describe('getShift', () => {
  it('skips malformed ids without a request', async () => {
    const { sb, calls } = fakeSupabase(() => json([]))
    await expect(getShift(sb, 'not-a-uuid')).resolves.toBeNull()
    expect(calls).toHaveLength(0)
  })

  it('returns the row', async () => {
    const { sb, calls } = fakeSupabase(() => json([shiftRow()]))
    await expect(getShift(sb, SHIFT)).resolves.toMatchObject({ id: SHIFT })
    expect(params(calls[0], 'id')).toEqual([`eq.${SHIFT}`])
  })
})

describe('listBoardShifts', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-09-23T19:00:00.000Z'))
  })

  it('builds the board query: open, not started, from today, filters, order and limit+1', async () => {
    const { sb, calls } = fakeSupabase(() => json([]))
    await listBoardShifts(sb, { battalion: 9, rank: 'Firefighter', excludePosterId: ME }, { limit: 20 })
    const q = calls[0]
    expect(q.method).toBe('GET')
    expect(q.path).toBe('/rest/v1/shifts')
    expect(params(q, 'status')).toEqual(['eq.open'])
    expect(params(q, 'starts_at')).toEqual(['gt.2026-09-23T19:00:00.000Z'])
    expect(params(q, 'date')).toEqual(['gte.2026-09-23'])
    expect(params(q, 'battalion')).toEqual(['eq.9'])
    expect(params(q, 'rank')).toEqual(['eq.Firefighter'])
    expect(params(q, 'poster_id')).toEqual([`neq.${ME}`])
    expect(params(q, 'order')).toEqual(['date.asc,created_at.asc,id.asc'])
    expect(params(q, 'limit')).toEqual(['21'])
    expect(params(q, 'or')).toEqual([])
  })

  it('"only shifts I can take": rank, not mine, accept limit, excluded dates', async () => {
    const { sb, calls } = fakeSupabase(() => json([]))
    await listBoardShifts(sb, {
      eligibleFor: { id: ME, rank: 'Captain', station: 19, battalion: 9, division: 3 },
      excludeDates: ['2026-09-27', 'bad', '2026-09-30', '2026-09-27'],
      to: '2026-12-31',
    })
    const q = calls[0]
    expect(params(q, 'rank')).toEqual(['eq.Captain'])
    expect(params(q, 'poster_id')).toEqual([`neq.${ME}`])
    expect(params(q, 'or')).toEqual([
      '(accept_limit.eq.anyone,and(accept_limit.eq.division,division.eq.3),and(accept_limit.eq.battalion,battalion.eq.9),and(accept_limit.eq.station,station.eq.19))',
    ])
    expect(params(q, 'date')).toEqual(['gte.2026-09-23', 'lte.2026-12-31', 'not.in.(2026-09-27,2026-09-30)'])
  })

  it('a viewer without a rank gets nothing, without a request', async () => {
    const { sb, calls } = fakeSupabase(() => json([]))
    await expect(
      listBoardShifts(sb, { eligibleFor: { id: ME, rank: null, station: null, battalion: null, division: null } }),
    ).resolves.toEqual({ items: [], nextCursor: null })
    expect(calls).toHaveLength(0)
  })

  it('pages with a keyset cursor', async () => {
    const rows = [
      shiftRow({ id: '00000000-0000-4000-8000-000000000001', date: '2026-10-01' }),
      shiftRow({ id: '00000000-0000-4000-8000-000000000002', date: '2026-10-02' }),
      shiftRow({ id: '00000000-0000-4000-8000-000000000003', date: '2026-10-03' }),
    ]
    const { sb, calls } = fakeSupabase(() => json(rows))
    const first = await listBoardShifts(sb, {}, { limit: 2 })
    expect(first.items.map((s) => s.id)).toEqual([rows[0].id, rows[1].id])
    expect(first.nextCursor).toEqual({ date: '2026-10-02', created_at: rows[1].created_at, id: rows[1].id })

    await listBoardShifts(sb, {}, { limit: 2, after: first.nextCursor })
    expect(params(calls[1], 'or')).toEqual([
      `(date.gt.2026-10-02,and(date.eq.2026-10-02,created_at.gt."2026-09-20T17:05:03.123456+00:00"),and(date.eq.2026-10-02,created_at.eq."2026-09-20T17:05:03.123456+00:00",id.gt.${rows[1].id}))`,
    ])
  })

  it('last page has no cursor', async () => {
    const { sb } = fakeSupabase(() => json([shiftRow()]))
    await expect(listBoardShifts(sb, {}, { limit: 5 })).resolves.toMatchObject({ nextCursor: null })
  })

  it('rejects a tampered cursor', async () => {
    const { sb, calls } = fakeSupabase(() => json([]))
    await expect(
      listBoardShifts(sb, {}, { after: { date: '2026-10-02', created_at: 'x', id: `${SHIFT}),or(id.neq.0` } }),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' })
    expect(calls).toHaveLength(0)
  })
})

describe('requests', () => {
  it('listMyRequests embeds the shift and filters by requester', async () => {
    const { sb, calls } = fakeSupabase(() =>
      json([{ id: 'r1', shift_id: SHIFT, status: 'pending', shift: shiftRow() }, { id: 'r2', shift: null }]),
    )
    const rows = await listMyRequests(sb, { userId: ME, statuses: ['pending'], shiftIds: [SHIFT, 'junk'] })
    expect(rows.map((r) => r.id)).toEqual(['r1'])
    const q = calls[0]
    expect(params(q, 'select')).toEqual(['*,shift:shifts(*)'])
    expect(params(q, 'requester_id')).toEqual([`eq.${ME}`])
    expect(params(q, 'status')).toEqual(['in.(pending)'])
    expect(params(q, 'shift_id')).toEqual([`in.(${SHIFT})`])
    expect(params(q, 'order')).toEqual(['created_at.desc,id.asc'])
  })

  it('listMyRequests with only invalid shift ids makes no request', async () => {
    const { sb, calls } = fakeSupabase(() => json([]))
    await expect(listMyRequests(sb, { userId: ME, shiftIds: ['junk'] })).resolves.toEqual([])
    expect(calls).toHaveLength(0)
  })

  it('listIncomingRequests: requests on my posts via an inner join', async () => {
    const { sb, calls } = fakeSupabase(() => json([]))
    await listIncomingRequests(sb, { userId: ME })
    const q = calls[0]
    expect(params(q, 'select')).toEqual(['*,shift:shifts!inner(*)'])
    expect(params(q, 'shift.poster_id')).toEqual([`eq.${ME}`])
    expect(params(q, 'status')).toEqual(['in.(pending)'])
  })
})

describe('listMyTrades', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-09-23T19:00:00.000Z'))
  })

  it('confirmed: my covered, upcoming shifts (either side)', async () => {
    const { sb, calls } = fakeSupabase(() => json([]))
    await listMyTrades(sb, { scope: 'confirmed', userId: ME })
    const q = calls[0]
    expect(params(q, 'or')).toEqual([`(poster_id.eq.${ME},coverer_id.eq.${ME})`])
    expect(params(q, 'status')).toEqual(['eq.covered'])
    expect(params(q, 'starts_at')).toEqual(['gt.2026-09-23T19:00:00.000Z'])
    expect(params(q, 'order')).toEqual(['date.asc,created_at.asc,id.asc'])
  })

  it('cancel_requests: asked by the other member', async () => {
    const { sb, calls } = fakeSupabase(() => json([]))
    await listMyTrades(sb, { scope: 'cancel_requests', userId: ME })
    expect(params(calls[0], 'cancel_requested_by')).toEqual(['not.is.null', `neq.${ME}`])
  })

  it('history: started or cancelled, newest first', async () => {
    const { sb, calls } = fakeSupabase(() => json([]))
    await listMyTrades(sb, { scope: 'history', userId: ME })
    const q = calls[0]
    expect(params(q, 'or')).toEqual([
      `(poster_id.eq.${ME},coverer_id.eq.${ME})`,
      '(starts_at.lte."2026-09-23T19:00:00.000Z",status.eq.cancelled)',
    ])
    expect(params(q, 'order')).toEqual(['date.desc,created_at.desc,id.desc'])
    expect(params(q, 'limit')).toEqual(['50'])
  })

  it('open: my open posts', async () => {
    const { sb, calls } = fakeSupabase(() => json([]))
    await listMyTrades(sb, { scope: 'open', userId: ME })
    expect(params(calls[0], 'poster_id')).toEqual([`eq.${ME}`])
    expect(params(calls[0], 'status')).toEqual(['eq.open'])
  })
})

describe('getTrade', () => {
  it('resolves a return leg to its original, both legs and the requests', async () => {
    const original = shiftRow({ id: SHIFT, status: 'covered', coverer_id: ME, return_leg_id: LEG })
    const leg = shiftRow({ id: LEG, poster_id: ME, coverer_id: OTHER, status: 'covered', return_leg_of: SHIFT, date: '2026-10-05' })
    const { sb, calls } = fakeSupabase((call) => {
      if (call.path === '/rest/v1/shift_requests') return json([{ id: 'r1', shift_id: SHIFT, status: 'accepted' }])
      if (params(call, 'id')[0] === `eq.${LEG}`) return json([leg])
      return json([original, leg])
    })
    const trade = await getTrade(sb, LEG)
    expect(trade).not.toBeNull()
    expect(trade!.shift.id).toBe(SHIFT)
    expect(trade!.returnLeg?.id).toBe(LEG)
    expect(trade!.requestedId).toBe(LEG)
    expect(trade!.requests.map((r) => r.id)).toEqual(['r1'])
    const legsQuery = calls.find((c) => c.path === '/rest/v1/shifts' && params(c, 'or').length)
    expect(params(legsQuery!, 'or')).toEqual([`(id.eq.${SHIFT},return_leg_of.eq.${SHIFT})`])
  })

  it('null when the shift is missing', async () => {
    const { sb } = fakeSupabase(() => json([]))
    await expect(getTrade(sb, SHIFT)).resolves.toBeNull()
  })
})

describe('messages', () => {
  it('listMessages returns the thread oldest first', async () => {
    const newestFirst = [
      { id: 'm3', created_at: '2026-09-23T10:03:00+00:00' },
      { id: 'm2', created_at: '2026-09-23T10:02:00+00:00' },
      { id: 'm1', created_at: '2026-09-23T10:01:00+00:00' },
    ]
    const { sb, calls } = fakeSupabase(() => json(newestFirst))
    const rows = await listMessages(sb, SHIFT, OTHER)
    expect(rows.map((m) => m.id)).toEqual(['m1', 'm2', 'm3'])
    const q = calls[0]
    expect(params(q, 'shift_id')).toEqual([`eq.${SHIFT}`])
    expect(params(q, 'or')).toEqual([`(sender_id.eq.${OTHER},recipient_id.eq.${OTHER})`])
    expect(params(q, 'order')).toEqual(['created_at.desc,id.desc'])
  })

  it('rejects malformed ids', async () => {
    const { sb } = fakeSupabase(() => json([]))
    await expect(listMessages(sb, SHIFT, 'x,or(1.eq.1)')).rejects.toMatchObject({ code: 'INVALID_INPUT' })
  })
})

describe('notifications', () => {
  it('lists newest first and pages with a cursor', async () => {
    const rows = [
      { id: '00000000-0000-4000-8000-00000000000a', created_at: '2026-09-23T10:03:00.5+00:00' },
      { id: '00000000-0000-4000-8000-00000000000b', created_at: '2026-09-23T10:02:00+00:00' },
    ]
    const { sb, calls } = fakeSupabase(() => json(rows))
    const page = await listNotifications(sb, { limit: 1, unreadOnly: true })
    expect(page.items).toHaveLength(1)
    expect(page.nextCursor).toEqual({ created_at: rows[0].created_at, id: rows[0].id })
    expect(params(calls[0], 'read_at')).toEqual(['is.null'])
    expect(params(calls[0], 'limit')).toEqual(['2'])

    await listNotifications(sb, { limit: 1, before: page.nextCursor })
    expect(params(calls[1], 'or')).toEqual([
      `(created_at.lt."2026-09-23T10:03:00.5+00:00",and(created_at.eq."2026-09-23T10:03:00.5+00:00",id.lt.${rows[0].id}))`,
    ])
  })

  it('unreadCount is a head-only exact count', async () => {
    const { sb, calls } = fakeSupabase(() => new Response(null, { status: 200, headers: { 'content-range': '*/7' } }))
    await expect(unreadCount(sb)).resolves.toBe(7)
    expect(calls[0].method).toBe('HEAD')
    expect(calls[0].headers.get('prefer')).toContain('count=exact')
    expect(params(calls[0], 'read_at')).toEqual(['is.null'])
  })
})

describe('admin reads', () => {
  it('listMembers searches safely and returns the total', async () => {
    const { sb, calls } = fakeSupabase(() => json([{ id: ME }], 200, { 'content-range': '0-0/12' }))
    const page = await listMembers(sb, { search: ' o\'brien, (pat)* ', statuses: ['approved'], limit: 10, offset: 20 })
    expect(page).toEqual({ items: [{ id: ME }], total: 12 })
    const q = calls[0]
    expect(params(q, 'or')).toEqual([
      '(full_name.ilike."%o\'brien pat%",email.ilike."%o\'brien pat%",phone.ilike."%o\'brien pat%",employee_id.ilike."%o\'brien pat%")',
    ])
    expect(params(q, 'status')).toEqual(['in.(approved)'])
    expect(params(q, 'offset')).toEqual(['20'])
    expect(params(q, 'limit')).toEqual(['10'])
    expect(q.headers.get('prefer')).toContain('count=exact')
  })

  it('listPendingApprovals joins the latest roster note from the audit log', async () => {
    const member = { id: ME, full_name: 'Ana Diaz', status: 'pending' }
    const { sb, calls } = fakeSupabase((call) => {
      if (call.path === '/rest/v1/profiles') return json([member])
      return json([
        {
          target_id: ME,
          created_at: '2026-09-23T10:00:00+00:00',
          details: { roster_note: 'Roster: Ana Diaz, Station 19 — tour differs', roster_id: SHIFT, attempt: 2, auto_approve_blocked: false },
        },
        {
          target_id: ME,
          created_at: '2026-09-22T10:00:00+00:00',
          details: { roster_note: 'Roster: no entry found for Ana Diaz', roster_id: null, attempt: 1 },
        },
      ])
    })
    const rows = await listPendingApprovals(sb)
    expect(rows).toEqual([
      {
        member,
        rosterNote: 'Roster: Ana Diaz, Station 19 — tour differs',
        rosterId: SHIFT,
        attempts: 2,
        autoApproveBlocked: false,
        submittedAt: '2026-09-23T10:00:00+00:00',
      },
    ])
    const audit = calls[1]
    expect(audit.path).toBe('/rest/v1/audit_log')
    expect(params(audit, 'action')).toEqual(['eq.member.pending'])
    expect(params(audit, 'target_id')).toEqual([`in.(${ME})`])
  })

  it('listPendingApprovals with nobody pending makes one request', async () => {
    const { sb, calls } = fakeSupabase(() => json([]))
    await expect(listPendingApprovals(sb)).resolves.toEqual([])
    expect(calls).toHaveLength(1)
  })
})

describe('push subscriptions', () => {
  it('inserts the row without user_id (the database fills in auth.uid())', async () => {
    const { sb, calls } = fakeSupabase(() => new Response(null, { status: 201 }))
    await savePushSubscription(sb, {
      endpoint: 'https://fcm.googleapis.com/fcm/send/abc',
      p256dh: 'key',
      auth: 'secret',
      userAgent: 'x'.repeat(600),
    })
    expect(calls[0].method).toBe('POST')
    expect(calls[0].path).toBe('/rest/v1/push_subscriptions')
    const body = calls[0].body as Record<string, string>
    expect(Object.keys(body).sort()).toEqual(['auth', 'endpoint', 'p256dh', 'user_agent'])
    expect(body.user_agent).toHaveLength(512)
  })

  it('an endpoint the database rejects gets a push-specific message', async () => {
    const { sb } = fakeSupabase(() =>
      json(
        {
          code: '23514',
          message: 'new row for relation "push_subscriptions" violates check constraint "push_subscriptions_endpoint_push_service"',
          details: null,
          hint: null,
        },
        400,
      ),
    )
    await expect(
      savePushSubscription(sb, { endpoint: 'https://evil.example/x', p256dh: 'k', auth: 'a' }),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT', message: PUSH_UNSUPPORTED_MESSAGE })
    expect(PUSH_UNSUPPORTED_MESSAGE).toMatch(/^Alerts aren't supported in this browser/)
  })

  it('other rejected inserts keep their own message', async () => {
    const { sb } = fakeSupabase(() => json({ code: '22001', message: 'value too long', details: null, hint: null }, 400))
    const error = await savePushSubscription(sb, { endpoint: 'https://fcm.googleapis.com/x', p256dh: 'k', auth: 'a' }).catch(
      (e: unknown) => e,
    )
    expect(error).toMatchObject({ code: 'INVALID_INPUT' })
    expect((error as AppError).message).not.toBe(PUSH_UNSUPPORTED_MESSAGE)
  })

  it('checks and deletes my row for an endpoint', async () => {
    const { sb, calls } = fakeSupabase((call) => (call.method === 'DELETE' ? new Response(null, { status: 204 }) : json([{ id: 'x' }])))
    await expect(hasPushSubscription(sb, 'https://fcm.googleapis.com/x')).resolves.toBe(true)
    expect(params(calls[0], 'endpoint')).toEqual(['eq.https://fcm.googleapis.com/x'])
    await deletePushSubscription(sb, 'https://fcm.googleapis.com/x')
    expect(calls[1].method).toBe('DELETE')
    expect(params(calls[1], 'endpoint')).toEqual(['eq.https://fcm.googleapis.com/x'])
    await expect(hasPushSubscription(sb, '')).resolves.toBe(false)
    expect(calls).toHaveLength(2)
  })
})

// ---------------------------------------------------------------------------
// Session checks: an Auth outage is never "signed out" (NEXT-07)
// ---------------------------------------------------------------------------

describe('resolveUserId / sessionCheckError', () => {
  function withClaims(result: unknown): SupabaseClient {
    return { auth: { getClaims: async () => result } } as unknown as SupabaseClient
  }

  it('an Auth 5xx is a NETWORK error, not NOT_SIGNED_IN', async () => {
    const sb = withClaims({ data: null, error: new AuthApiError('Internal Server Error', 500, 'unexpected_failure') })
    await expect(resolveUserId(sb)).rejects.toMatchObject({ code: 'NETWORK', message: NETWORK_MESSAGE })
    expect(sessionCheckError(new AuthApiError('timeout', 504, undefined)).code).toBe('NETWORK')
    expect(sessionCheckError(new AuthApiError('request timeout', 500, 'request_timeout')).code).toBe('NETWORK')
  })

  it('a rejected or missing session is NOT_SIGNED_IN', async () => {
    await expect(resolveUserId(withClaims({ data: null, error: new AuthSessionMissingError() }))).rejects.toMatchObject({
      code: 'NOT_SIGNED_IN',
    })
    await expect(
      resolveUserId(withClaims({ data: null, error: new AuthApiError('invalid JWT', 403, 'bad_jwt') })),
    ).rejects.toMatchObject({ code: 'NOT_SIGNED_IN' })
    await expect(resolveUserId(withClaims({ data: null, error: new AuthApiError('gone', 404, undefined) }))).rejects.toMatchObject({
      code: 'NOT_SIGNED_IN',
    })
    await expect(resolveUserId(withClaims({ data: null, error: null }))).rejects.toMatchObject({ code: 'NOT_SIGNED_IN' })
  })

  it('rate limits and unexpected errors are not "signed out" either', async () => {
    expect(sessionCheckError(new AuthApiError('slow down', 429, 'over_request_rate_limit')).code).toBe('UNKNOWN')
    expect(sessionCheckError(new TypeError('x is not a function')).code).toBe('UNKNOWN')
    await expect(
      resolveUserId({ auth: { getClaims: async () => Promise.reject(new TypeError('fetch failed')) } } as unknown as SupabaseClient),
    ).rejects.toMatchObject({ code: 'NETWORK' })
  })

  it('returns the verified user id', async () => {
    await expect(resolveUserId(withClaims({ data: { claims: { sub: ME } }, error: null }))).resolves.toBe(ME)
  })
})

// ---------------------------------------------------------------------------
// Trade detail for an old SwapMatch return leg (TF-6)
// ---------------------------------------------------------------------------

describe('getTrade with an old return leg', () => {
  const NEW_LEG = '66666666-6666-4666-8666-666666666666'
  const THIRD = '77777777-7777-4777-8777-777777777777'

  it('describes the leg in the URL even after the post was traded again', async () => {
    // The original was re-confirmed with someone else, who has a new return leg.
    const original = shiftRow({ id: SHIFT, status: 'covered', coverer_id: THIRD, return_leg_id: NEW_LEG })
    const oldLeg = shiftRow({ id: LEG, poster_id: ME, status: 'cancelled', return_leg_of: SHIFT, date: '2026-10-20' })
    const newLeg = shiftRow({ id: NEW_LEG, status: 'covered', return_leg_of: SHIFT, date: '2026-10-25' })
    const { sb } = fakeSupabase((call) => {
      if (call.path === '/rest/v1/shift_requests') return json([])
      if (params(call, 'id')[0] === `eq.${LEG}`) return json([oldLeg])
      return json([original, oldLeg, newLeg])
    })
    const trade = await getTrade(sb, LEG)
    expect(trade!.returnLeg?.id).toBe(LEG)
    expect(trade!.returnLegIsCurrent).toBe(false)
    expect(trade!.requestedId).toBe(LEG)
  })

  it('the original shows its current leg, or none after an undo', async () => {
    const reopened = shiftRow({ id: SHIFT, status: 'open', return_leg_id: null })
    const oldLeg = shiftRow({ id: LEG, status: 'cancelled', return_leg_of: SHIFT })
    const { sb } = fakeSupabase((call) => {
      if (call.path === '/rest/v1/shift_requests') return json([])
      if (params(call, 'id')[0] === `eq.${SHIFT}`) return json([reopened])
      return json([reopened, oldLeg])
    })
    const trade = await getTrade(sb, SHIFT)
    expect(trade!.returnLeg).toBeNull()
    expect(trade!.returnLegIsCurrent).toBe(false)
  })

  it('a current leg is marked current', async () => {
    const original = shiftRow({ id: SHIFT, status: 'covered', coverer_id: ME, return_leg_id: LEG })
    const leg = shiftRow({ id: LEG, status: 'covered', return_leg_of: SHIFT })
    const { sb } = fakeSupabase((call) => {
      if (call.path === '/rest/v1/shift_requests') return json([])
      if (params(call, 'id')[0] === `eq.${SHIFT}`) return json([original])
      return json([original, leg])
    })
    const trade = await getTrade(sb, SHIFT)
    expect(trade!.returnLeg?.id).toBe(LEG)
    expect(trade!.returnLegIsCurrent).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Undone trades in History, for both members (TF-4)
// ---------------------------------------------------------------------------

describe('undone trades', () => {
  const T = '2026-09-22T18:00:00.123456+00:00'
  const LATER = '2026-09-23T18:00:00+00:00'
  const R = (i: number) => `aaaaaaaa-aaaa-4aaa-8aaa-${String(i).padStart(12, '0')}`

  function req(overrides: Partial<RequestWithShift> & { shift: Shift }): RequestWithShift {
    return {
      id: R(1),
      shift_id: overrides.shift.id,
      requester_id: ME,
      requester_name: 'Me Myself',
      requester_rank: 'Firefighter',
      requester_station: 19,
      return_date: null,
      message: null,
      status: 'cancelled',
      decided_at: T,
      created_at: '2026-09-20T10:00:00+00:00',
      ...overrides,
    }
  }

  it('an agreed cancel that reopened the post shows for the coverer and the poster', () => {
    const reopened = shiftRow({ status: 'open', updated_at: T })
    const r = req({ shift: reopened })
    expect(undoneTradesFrom([r], [], ME)).toEqual([
      expect.objectContaining({ role: 'coverer', partnerId: OTHER, partnerName: 'Pat Poster', undoneAt: T, how: null, returnLeg: null }),
    ])
    expect(undoneTradesFrom([r], [], OTHER)).toEqual([
      expect.objectContaining({ role: 'poster', partnerId: ME, partnerName: 'Me Myself' }),
    ])
    // The result doesn't carry the joined shift twice.
    expect(undoneTradesFrom([r], [], ME)[0].request).not.toHaveProperty('shift')
  })

  it('a SwapMatch undo is matched to its cancelled return leg (agreed or voided)', () => {
    const reopened = shiftRow({ status: 'open', updated_at: T, return_dates: ['2026-10-20'] })
    const leg = shiftRow({
      id: LEG,
      poster_id: ME,
      status: 'cancelled',
      return_leg_of: SHIFT,
      cancelled_at: T,
      cancel_note: 'Cancelled by agreement',
    })
    const r = req({ shift: reopened, return_date: '2026-10-20' })
    expect(undoneTradesFrom([r], [leg], OTHER)).toEqual([
      expect.objectContaining({ role: 'poster', how: 'agreed', note: null, returnLeg: leg }),
    ])
    const voided = { ...leg, cancel_note: 'Entered wrong in TeleStaff' }
    expect(undoneTradesFrom([r], [voided], ME)).toEqual([
      expect.objectContaining({ role: 'coverer', how: 'voided', note: 'Entered wrong in TeleStaff' }),
    ])
    // Without its leg a SwapMatch request was never confirmed.
    expect(undoneTradesFrom([r], [], ME)).toEqual([])
  })

  it('an admin void after the start keeps the coverer name on the cancelled post', () => {
    const voided = shiftRow({ status: 'cancelled', cancelled_at: T, coverer_name: 'Me Myself', cancel_note: 'Voided by an admin' })
    expect(undoneTradesFrom([req({ shift: voided })], [], ME)).toEqual([
      expect.objectContaining({ how: 'voided', note: null, role: 'coverer' }),
    ])
  })

  it('requests closed while still pending are not trades', () => {
    // The poster cancelled the post while the request was waiting.
    const cancelledPost = shiftRow({ status: 'cancelled', cancelled_at: T, coverer_name: null })
    expect(undoneTradesFrom([req({ shift: cancelledPost })], [], ME)).toEqual([])
    // The requester was suspended: their request closed, the post wasn't touched.
    const untouched = shiftRow({ status: 'open', updated_at: '2026-09-20T17:05:03+00:00' })
    expect(undoneTradesFrom([req({ shift: untouched })], [], OTHER)).toEqual([])
    // Other statuses are ignored.
    expect(undoneTradesFrom([req({ shift: untouched, status: 'declined' })], [], ME)).toEqual([])
  })

  it('a post reopened, traded again or cancelled later still shows the old undone trade', () => {
    const retraded = shiftRow({ status: 'covered', coverer_id: '77777777-7777-4777-8777-777777777777', updated_at: LATER })
    expect(undoneTradesFrom([req({ shift: retraded })], [], ME)).toHaveLength(1)
    const cancelledLater = shiftRow({ status: 'cancelled', cancelled_at: LATER, updated_at: LATER })
    expect(undoneTradesFrom([req({ shift: cancelledLater })], [], ME)).toHaveLength(1)
    // Reopened, traded again with me and undone again: both undos show, newest first.
    const reopenedAgain = shiftRow({ status: 'open', updated_at: LATER })
    const first = req({ id: R(1), shift: reopenedAgain })
    const second = req({ id: R(2), shift: reopenedAgain, decided_at: LATER })
    expect(undoneTradesFrom([first, second], [], ME).map((u) => u.request.id)).toEqual([R(2), R(1)])
  })

  it('listUndoneTrades loads both sides and the cancelled legs', async () => {
    const reopened = shiftRow({ status: 'open', updated_at: T })
    const { sb, calls } = fakeSupabase((call) => {
      if (call.path === '/rest/v1/shift_requests') {
        return params(call, 'requester_id').length ? json([req({ shift: reopened })]) : json([])
      }
      return json([])
    })
    const rows = await listUndoneTrades(sb, { userId: ME })
    expect(rows).toHaveLength(1)
    const posterSide = calls.find((c) => params(c, 'shift.poster_id').length)!
    const requesterSide = calls.find((c) => params(c, 'requester_id').length)!
    const legs = calls.find((c) => c.path === '/rest/v1/shifts')!
    expect(params(posterSide, 'shift.poster_id')).toEqual([`eq.${ME}`])
    expect(params(posterSide, 'status')).toEqual(['eq.cancelled'])
    expect(params(posterSide, 'decided_at')).toEqual(['not.is.null'])
    expect(params(requesterSide, 'requester_id')).toEqual([`eq.${ME}`])
    expect(params(legs, 'return_leg_of')).toEqual([`in.(${SHIFT})`])
    expect(params(legs, 'status')).toEqual(['eq.cancelled'])
  })

  it('makes no leg query when nothing was cancelled', async () => {
    const { sb, calls } = fakeSupabase(() => json([]))
    await expect(listUndoneTrades(sb, { userId: ME })).resolves.toEqual([])
    expect(calls).toHaveLength(2)
  })
})

// ---------------------------------------------------------------------------
// Admin filters (CC-5), member cards, removal
// ---------------------------------------------------------------------------

describe('admin lists with filters', () => {
  it('listAdminShifts: scope, dates, place, member name and paging', async () => {
    const leg = shiftRow({ id: LEG, return_leg_of: SHIFT, status: 'covered' })
    const { sb, calls } = fakeSupabase((call) => {
      if (params(call, 'id').length) return json([leg])
      return json([shiftRow({ status: 'covered', return_leg_id: LEG })], 200, { 'content-range': '25-25/40' })
    })
    const page = await listAdminShifts(sb, {
      scope: 'upcoming',
      from: '2026-10-01',
      to: '2026-10-31',
      battalion: 9,
      station: 19,
      member: 'Pat (P)',
      limit: 25,
      offset: 25,
      withReturnLegs: true,
      now: new Date('2026-09-23T19:00:00.000Z'),
    })
    expect(page.total).toBe(40)
    expect(page.returnLegs.get(LEG)).toEqual(leg)
    const q = calls[0]
    expect(params(q, 'status')).toEqual(['eq.covered'])
    expect(params(q, 'starts_at')).toEqual(['gt.2026-09-23T19:00:00.000Z'])
    expect(params(q, 'return_leg_of')).toEqual(['is.null'])
    expect(params(q, 'date')).toEqual(['gte.2026-10-01', 'lte.2026-10-31'])
    expect(params(q, 'battalion')).toEqual(['eq.9'])
    expect(params(q, 'station')).toEqual(['eq.19'])
    expect(params(q, 'or')).toEqual(['(poster_name.ilike."%Pat P%",coverer_name.ilike."%Pat P%")'])
    expect(params(q, 'offset')).toEqual(['25'])
    expect(params(q, 'limit')).toEqual(['25'])
    expect(params(calls[1], 'id')).toEqual([`in.(${LEG})`])
  })

  it('listAdminShifts: "all" has no status filter; blank dates are ignored; bad dates are refused', async () => {
    const { sb, calls } = fakeSupabase(() => json([], 200, { 'content-range': '*/0' }))
    const page = await listAdminShifts(sb, { scope: 'all', from: '', to: null })
    expect(page).toEqual({ items: [], total: 0, returnLegs: new Map() })
    expect(params(calls[0], 'status')).toEqual([])
    expect(params(calls[0], 'date')).toEqual([])
    await expect(listAdminShifts(sb, { from: '10/01/2026' })).rejects.toMatchObject({ code: 'INVALID_INPUT' })
  })

  it('listMembers: station, recently joined, approved order and removed filter', async () => {
    const { sb, calls } = fakeSupabase(() => json([], 200, { 'content-range': '*/0' }))
    await listMembers(sb, {
      station: 19,
      joinedWithinDays: 7,
      order: 'approved',
      removed: 'exclude',
      now: new Date('2026-09-23T19:00:00.000Z'),
    })
    const q = calls[0]
    expect(params(q, 'station')).toEqual(['eq.19'])
    expect(params(q, 'approved_at')).toEqual(['gte.2026-09-16T19:00:00.000Z'])
    expect(params(q, 'removed_at')).toEqual(['is.null'])
    expect(params(q, 'order')).toEqual(['approved_at.desc.nullslast,full_name.asc,id.asc'])

    await listMembers(sb, { removed: 'only' })
    expect(params(calls[1], 'removed_at')).toEqual(['not.is.null'])
    // Default: no removed filter (works before migration 0011).
    await listMembers(sb)
    expect(params(calls[2], 'removed_at')).toEqual([])
    await expect(listMembers(sb, { joinedWithinDays: 0 })).rejects.toMatchObject({ code: 'INVALID_INPUT' })
  })

  it('getMemberCards: one call for many ids, none for no valid ids', async () => {
    const { sb, calls } = fakeSupabase(() => json([{ user_id: ME, full_name: 'Me' }, null]))
    const cards = await getMemberCards(sb, [ME, ME, 'nope', OTHER])
    expect(cards).toEqual([{ user_id: ME, full_name: 'Me' }])
    expect(calls[0].path).toBe('/rest/v1/rpc/member_cards')
    expect(calls[0].body).toEqual({ p_user_ids: [ME, OTHER] })
    await expect(getMemberCards(sb, ['nope'])).resolves.toEqual([])
    expect(calls).toHaveLength(1)
  })

  it('getMemberCards asks 50 at a time (member_cards refuses more)', async () => {
    const ids = Array.from({ length: 60 }, (_, i) => `aaaaaaaa-aaaa-4aaa-8aaa-${String(i).padStart(12, '0')}`)
    const { sb, calls } = fakeSupabase((call) =>
      json((call.body as { p_user_ids: string[] }).p_user_ids.map((user_id) => ({ user_id }))),
    )
    const cards = await getMemberCards(sb, ids)
    expect(cards.map((c) => c.user_id)).toEqual(ids)
    expect(calls.map((c) => (c.body as { p_user_ids: string[] }).p_user_ids.length)).toEqual([50, 10])
  })

  it('adminRemoveMember sends the id and the trimmed reason and returns what came off the board', async () => {
    const { sb, calls } = fakeSupabase(() => json({ posts_cancelled: 2, requests_closed: 1, upcoming_trades: 3 }))
    await expect(adminRemoveMember(sb, ME, '  Left the department ')).resolves.toEqual({
      posts_cancelled: 2,
      requests_closed: 1,
      upcoming_trades: 3,
    })
    expect(calls[0].path).toBe('/rest/v1/rpc/admin_remove_member')
    expect(calls[0].body).toEqual({ p_user_id: ME, p_reason: 'Left the department' })
    await expect(adminRemoveMember(sb, 'x')).rejects.toMatchObject({ code: 'INVALID_INPUT' })
  })
})

describe('small reads', () => {
  it('unreadMessagesBySender counts per sender', async () => {
    const { sb, calls } = fakeSupabase(() => json([{ sender_id: OTHER }, { sender_id: OTHER }, { sender_id: LEG }]))
    await expect(unreadMessagesBySender(sb, SHIFT, { userId: ME })).resolves.toEqual({ [OTHER]: 2, [LEG]: 1 })
    expect(params(calls[0], 'recipient_id')).toEqual([`eq.${ME}`])
    expect(params(calls[0], 'read_at')).toEqual(['is.null'])
  })

  it('unreadCount can filter by my id', async () => {
    const { sb, calls } = fakeSupabase(() => new Response(null, { status: 200, headers: { 'content-range': '*/3' } }))
    await expect(unreadCount(sb, { userId: ME })).resolves.toBe(3)
    expect(params(calls[0], 'user_id')).toEqual([`eq.${ME}`])
  })

  it('getMySchedule always has pm_given_away', async () => {
    const { sb } = fakeSupabase(() =>
      json([
        { date: '2026-10-03', base: true, given_away: true, pm_given_away: true, working: true },
        { date: '2026-10-04', base: false, given_away: false, working: false },
      ]),
    )
    const rows = await getMySchedule(sb, '2026-10-03', '2026-10-04')
    expect(rows.map((r) => r.pm_given_away)).toEqual([true, false])
  })

  it('getMySchedule rejects ranges over 400 days without a request', async () => {
    const { sb, calls } = fakeSupabase(() => json([]))
    await expect(getMySchedule(sb, '2026-01-01', '2027-12-31')).rejects.toMatchObject({ code: 'INVALID_INPUT' })
    expect(calls).toHaveLength(0)
  })
})
