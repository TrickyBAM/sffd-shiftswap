// Posting and requesting shifts: post_shift (+ new-shift fan-out), cancel_post,
// shift_eligibility, request_shift, withdraw_request, decline_request
// (ARCHITECTURE §3, §6.3 "Shifts & trades", §6.5, §6.6).

import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  NO_SUB,
  createTestDb,
  daysFromToday,
  expectRpcError,
  findDate,
  offDay,
  tourDay,
  tourWorks,
  type Member,
  type MemberOptions,
  type Row,
  type TestDb,
} from './harness'

let t: TestDb

beforeAll(async () => {
  t = await createTestDb()
})

afterAll(async () => {
  await t?.close()
})

// Tour 1 and tour 2 never work the same day (tour 2 = tour 1 shifted one day).
const DAY = () => tourDay(1, 3) // a tour-1 day, ≥ 3 days out
const SWAP_DAY = () => tourDay(2, 3) // tour 2 works, tour 1 is off
const NEITHER_DAY = () => findDate((d) => !tourWorks(1, d) && !tourWorks(2, d), 3)

function post(poster: Member, over: Record<string, unknown> = {}) {
  return t.rpc<string>(poster.id, 'post_shift', {
    p_date: DAY(),
    p_shift_type: '24-Hour',
    p_station: null,
    p_return_dates: null,
    p_accept_limit: null,
    p_notes: null,
    ...over,
  })
}

function request(member: Member | string, shiftId: string, returnDate: string | null = null, message: string | null = null) {
  const id = typeof member === 'string' ? member : member.id
  return t.rpc<string>(id, 'request_shift', { p_shift_id: shiftId, p_return_date: returnDate, p_message: message })
}

function eligibility(member: Member, shiftId: string, returnDate: string | null = null) {
  return t.rpc<{ eligible: boolean; reasons: Array<{ code: string; message: string }>; valid_return_dates: string[] }>(
    member.id,
    'shift_eligibility',
    { p_shift_id: shiftId, p_return_date: returnDate },
  )
}

async function shift(id: string): Promise<Row> {
  return t.one(`select * from public.shifts where id = $1`, [id])
}

const member = (opts: MemberOptions = {}) => t.createMember(opts)

// ---------------------------------------------------------------------------
describe('post_shift', () => {
  it('creates an open post with snapshots, derived location and sorted, distinct return dates', async () => {
    const poster = await member({ fullName: 'Poster One', station: 19, tour: 1 })
    const r1 = SWAP_DAY()
    const r2 = NEITHER_DAY()
    const id = await post(poster, {
      p_return_dates: [r2, r1, r2],
      p_accept_limit: 'battalion',
      p_notes: '  Happy to swap  ',
    })
    const s = await shift(id)
    expect(s).toMatchObject({
      poster_id: poster.id,
      poster_name: 'Poster One',
      rank: 'Firefighter',
      station: 19,
      battalion: 9,
      division: 3,
      date: DAY(),
      shift_type: '24-Hour',
      hours: 24,
      status: 'open',
      accept_limit: 'battalion',
      notes: 'Happy to swap',
      coverer_id: null,
    })
    expect(s.return_dates).toEqual([r1, r2].sort())
    const start = await t.one<{ ok: boolean }>(
      `select starts_at = public.shift_starts_at(date, shift_type) as ok from public.shifts where id = $1`,
      [id],
    )
    expect(start.ok).toBe(true)
    const audit = await t.query(`select * from public.audit_log where target_id = $1 and action = 'shift.posted'`, [id])
    expect(audit).toHaveLength(1)
  })

  it('treats the optional arguments as optional (PostgREST calls may omit them)', async () => {
    const poster = await member({ tour: 1, station: 4 })
    const taker = await member({ tour: 2 })
    const id = await t.rpc<string>(poster.id, 'post_shift', { p_date: DAY(), p_shift_type: '24-Hour' })
    expect(await shift(id)).toMatchObject({ station: 4, accept_limit: 'anyone', return_dates: [], notes: null })
    expect(await t.rpc<string>(taker.id, 'request_shift', { p_shift_id: id })).toBeTruthy()
  })

  it('posts PM shifts (16 h) at another station', async () => {
    const poster = await member()
    const id = await post(poster, { p_shift_type: 'PM', p_station: 101, p_accept_limit: 'anyone' })
    expect(await shift(id)).toMatchObject({ hours: 16, shift_type: 'PM', station: 101, battalion: 99, division: 4 })
  })

  it('requires a session, an approved member and the TeleStaff acknowledgment', async () => {
    await expectRpcError(t.rpc(NO_SUB, 'post_shift', { p_date: DAY(), p_shift_type: '24-Hour', p_station: null, p_return_dates: null, p_accept_limit: null, p_notes: null }), 'NOT_SIGNED_IN')
    await expectRpcError(post(await member({ status: 'pending' })), 'NOT_APPROVED')
    await expectRpcError(post(await member({ ack: false })), 'ACK_REQUIRED')
  })

  it('rejects bad input with INVALID_INPUT', async () => {
    const poster = await member()
    const eleven = Array.from({ length: 11 }, (_, i) => offDay(1, 3, i))
    for (const over of [
      { p_date: null },
      { p_shift_type: 'Night' },
      { p_station: 999 },
      { p_accept_limit: 'friends' },
      { p_notes: 'x'.repeat(501) },
      { p_return_dates: eleven },
      { p_return_dates: [SWAP_DAY(), null] },
    ]) {
      await expectRpcError(post(poster, over), 'INVALID_INPUT')
    }
  })

  it('refuses shifts that already started (STARTED) or are more than 180 days out (TOO_FAR_AHEAD)', async () => {
    const poster = await member({ tour: null })
    await expectRpcError(post(poster, { p_date: daysFromToday(-2) }), 'STARTED')
    await expectRpcError(post(poster, { p_date: daysFromToday(181) }), 'TOO_FAR_AHEAD')
    expect(await post(poster, { p_date: daysFromToday(180) })).toBeTruthy()
  })

  it('only lets a tour member post their own tour days (NOT_YOUR_SHIFT_DAY)', async () => {
    const poster = await member({ tour: 1 })
    await expectRpcError(post(poster, { p_date: offDay(1, 3) }), 'NOT_YOUR_SHIFT_DAY')
  })

  it('lets a member with no tour post any future day', async () => {
    const poster = await member({ tour: null })
    expect(await post(poster, { p_date: offDay(1, 3) })).toBeTruthy()
  })

  it('does not let a picked-up shift be traded again (NOT_YOUR_SHIFT_DAY)', async () => {
    const poster = await member({ tour: null })
    const other = await member({ tour: 1 })
    const day = DAY()
    await t.createShift({ poster: other, date: day, coverer: poster })
    await expectRpcError(post(poster, { p_date: day }), 'NOT_YOUR_SHIFT_DAY')
  })

  it('refuses a second post for the same day (ALREADY_POSTED), including a day already given away', async () => {
    const poster = await member()
    const taker = await member({ tour: 2 })
    await post(poster)
    await expectRpcError(post(poster), 'ALREADY_POSTED')

    const day2 = tourDay(1, 3, 1)
    await t.createShift({ poster, date: day2, coverer: taker })
    await expectRpcError(post(poster, { p_date: day2 }), 'ALREADY_POSTED')

    // a cancelled post doesn't count
    const day3 = tourDay(1, 3, 2)
    await t.createShift({ poster, date: day3, status: 'cancelled' })
    expect(await post(poster, { p_date: day3 })).toBeTruthy()
  })

  it('validates SwapMatch return dates', async () => {
    const poster = await member({ tour: 1 })
    const day = DAY()
    await expectRpcError(post(poster, { p_return_dates: [day] }), 'RETURN_DATE_INVALID')
    await expectRpcError(post(poster, { p_return_dates: [daysFromToday(-3)] }), 'RETURN_DATE_INVALID')
    await expectRpcError(post(poster, { p_return_dates: [daysFromToday(185)] }), 'TOO_FAR_AHEAD')
    // a tour day of the poster
    await expectRpcError(post(poster, { p_return_dates: [tourDay(1, 3, 1)] }), 'POSTER_WORKS_RETURN_DAY')
    // a day the poster picked up
    const busy = SWAP_DAY()
    const other = await member({ tour: 2 })
    await t.createShift({ poster: other, date: busy, coverer: poster })
    await expectRpcError(post(poster, { p_return_dates: [busy] }), 'POSTER_WORKS_RETURN_DAY')
  })

  it('refuses a return date on which a no-tour poster already has a post', async () => {
    const poster = await member({ tour: null })
    const other = daysFromToday(20)
    await post(poster, { p_date: other })
    await expectRpcError(post(poster, { p_date: daysFromToday(21), p_return_dates: [other] }), 'POSTER_WORKS_RETURN_DAY')
  })
})

// ---------------------------------------------------------------------------
describe('new-shift fan-out (§6.5)', () => {
  async function notified(memberId: string, shiftId: string): Promise<Row[]> {
    return t.query(`select * from public.notifications where user_id = $1 and shift_id = $2 and type = 'new_shift'`, [
      memberId,
      shiftId,
    ])
  }

  it('notifies same-rank members whose alert scope covers the station and who are off that day', async () => {
    const day = tourDay(1, 40)
    const poster = await member({ station: 19, tour: 1, fullName: 'Fan Poster' })
    // station 19 = B9/D3, 15 = B9/D3, 4 = B3/D3, 2 = B1/D2
    const yes = {
      sameStation: await member({ station: 19, tour: 2, notifyScope: 'station' }),
      battalion: await member({ station: 15, tour: 2, notifyScope: 'battalion' }),
      division: await member({ station: 4, tour: 2, notifyScope: 'division' }),
      all: await member({ station: 2, tour: 2, notifyScope: 'all' }),
      noTour: await member({ station: 19, tour: null, notifyScope: 'all' }),
      gaveDayAway: await member({ station: 19, tour: 1, notifyScope: 'all' }),
      noTourGaveDayAway: await member({ station: 19, tour: null, notifyScope: 'all' }),
    }
    const no = {
      otherStation: await member({ station: 15, tour: 2, notifyScope: 'station' }),
      otherBattalion: await member({ station: 4, tour: 2, notifyScope: 'battalion' }),
      otherDivision: await member({ station: 2, tour: 2, notifyScope: 'division' }),
      off: await member({ station: 19, tour: 2, notifyScope: 'off' }),
      otherRank: await member({ station: 19, tour: 2, notifyScope: 'all', rank: 'Captain' }),
      working: await member({ station: 19, tour: 1, notifyScope: 'all' }),
      pending: await member({ station: 19, tour: 2, notifyScope: 'all', status: 'pending' }),
      suspended: await member({ station: 19, tour: 2, notifyScope: 'all', status: 'suspended' }),
      covering: await member({ station: 19, tour: 2, notifyScope: 'all' }),
      // no tour, but posted their own shift that day: they're working
      noTourPosted: await member({ station: 19, tour: null, notifyScope: 'all' }),
    }
    const someone = await member({ tour: 3 })
    await t.createShift({ poster: yes.gaveDayAway, date: day, coverer: someone })
    await t.createShift({ poster: yes.noTourGaveDayAway, date: day, coverer: await member({ tour: 5 }) })
    const third = await member({ tour: 4 })
    await t.createShift({ poster: third, date: day, coverer: no.covering })
    await t.createShift({ poster: no.noTourPosted, date: day })

    const id = await post(poster, { p_date: day })
    for (const [name, m] of Object.entries(yes)) expect(await notified(m.id, id), name).toHaveLength(1)
    for (const [name, m] of Object.entries(no)) expect(await notified(m.id, id), name).toHaveLength(0)
    expect(await notified(poster.id, id)).toHaveLength(0)

    const [n] = await notified(yes.sameStation.id, id)
    expect(n).toMatchObject({ url: `/board?shift=${id}`, actor_id: poster.id })
    expect(n.title).toContain('24-Hour')
    expect(n.body).toContain('Station 19')
    expect(n.body).toContain('Fan Poster')
  })

  it('respects the shift\'s accept limit', async () => {
    const day = tourDay(1, 50)
    const poster = await member({ station: 19, tour: 1 })
    const sameBattalion = await member({ station: 15, tour: 2, notifyScope: 'all' })
    const sameDivision = await member({ station: 4, tour: 2, notifyScope: 'all' })
    const otherDivision = await member({ station: 2, tour: 2, notifyScope: 'all' })
    const sameStation = await member({ station: 19, tour: 2, notifyScope: 'all' })

    const byBattalion = await post(poster, { p_date: day, p_accept_limit: 'battalion' })
    expect(await notified(sameBattalion.id, byBattalion)).toHaveLength(1)
    expect(await notified(sameStation.id, byBattalion)).toHaveLength(1)
    expect(await notified(sameDivision.id, byBattalion)).toHaveLength(0)
    expect(await notified(otherDivision.id, byBattalion)).toHaveLength(0)

    const poster2 = await member({ station: 19, tour: 1 })
    const byDivision = await post(poster2, { p_date: day, p_accept_limit: 'division' })
    expect(await notified(sameDivision.id, byDivision)).toHaveLength(1)
    expect(await notified(otherDivision.id, byDivision)).toHaveLength(0)

    const poster3 = await member({ station: 19, tour: 1 })
    const byStation = await post(poster3, { p_date: day, p_accept_limit: 'station' })
    expect(await notified(sameStation.id, byStation)).toHaveLength(1)
    expect(await notified(sameBattalion.id, byStation)).toHaveLength(0)
  })

  it('marks SwapMatch posts in the alert text', async () => {
    const poster = await member({ station: 19, tour: 1 })
    const watcher = await member({ station: 19, tour: 2, notifyScope: 'station' })
    const id = await post(poster, { p_date: tourDay(1, 60), p_return_dates: [tourDay(2, 60)] })
    const [n] = await notified(watcher.id, id)
    expect(n.body).toContain('SwapMatch')
  })
})

// ---------------------------------------------------------------------------
describe('cancel_post', () => {
  it('cancels an open post and closes pending requests with a notice', async () => {
    const poster = await member({ tour: 1 })
    const r1 = await member({ tour: 2 })
    const r2 = await member({ tour: 2 })
    const r3 = await member({ tour: 2 })
    const id = await post(poster)
    const q1 = await request(r1, id)
    const q2 = await request(r2, id)
    const q3 = await request(r3, id)
    await t.rpc(r3.id, 'withdraw_request', { p_request_id: q3 })

    await t.rpc(poster.id, 'cancel_post', { p_shift_id: id })
    expect(await shift(id)).toMatchObject({ status: 'cancelled', cancelled_by: poster.id })
    const reqs = await t.query<{ id: string; status: string }>(`select id, status from public.shift_requests where shift_id = $1`, [id])
    const status = Object.fromEntries(reqs.map((r) => [r.id, r.status]))
    expect(status).toEqual({ [q1]: 'cancelled', [q2]: 'cancelled', [q3]: 'withdrawn' })
    expect(await t.notificationsFor(r1.id, 'post_cancelled')).toHaveLength(1)
    expect(await t.notificationsFor(r2.id, 'post_cancelled')).toHaveLength(1)
    expect(await t.notificationsFor(r3.id, 'post_cancelled')).toHaveLength(0)
    expect(await t.query(`select 1 from public.audit_log where target_id = $1 and action = 'shift.cancelled'`, [id])).toHaveLength(1)
  })

  it('is only for the poster (NOT_PARTICIPANT) and open posts (NOT_OPEN)', async () => {
    const poster = await member({ tour: 1 })
    const other = await member({ tour: 2 })
    const id = await post(poster)
    await expectRpcError(t.rpc(other.id, 'cancel_post', { p_shift_id: id }), 'NOT_PARTICIPANT')
    await t.rpc(poster.id, 'cancel_post', { p_shift_id: id })
    await expectRpcError(t.rpc(poster.id, 'cancel_post', { p_shift_id: id }), 'NOT_OPEN')

    const covered = await t.createShift({ poster, date: tourDay(1, 3, 1), coverer: other })
    await expectRpcError(t.rpc(poster.id, 'cancel_post', { p_shift_id: covered }), 'NOT_OPEN')
  })

  it('cannot cancel a post that already started (STARTED) or does not exist (NOT_FOUND)', async () => {
    const poster = await member({ tour: null })
    const past = await t.createShift({ poster, date: daysFromToday(-3) })
    await expectRpcError(t.rpc(poster.id, 'cancel_post', { p_shift_id: past }), 'STARTED')
    await expectRpcError(t.rpc(poster.id, 'cancel_post', { p_shift_id: randomUUID() }), 'NOT_FOUND')
  })
})

// ---------------------------------------------------------------------------
describe('shift_eligibility', () => {
  it('reports an eligible member', async () => {
    const poster = await member({ tour: 1 })
    const taker = await member({ tour: 2 })
    const id = await post(poster)
    expect(await eligibility(taker, id)).toEqual({ eligible: true, reasons: [], valid_return_dates: [] })
  })

  it('lists every failing rule without raising', async () => {
    const poster = await member({ tour: 1 })
    const captain = await member({ tour: 1, rank: 'Captain', ack: false })
    const id = await post(poster)
    const result = await eligibility(captain, id)
    expect(result.eligible).toBe(false)
    expect(result.reasons.map((r) => r.code)).toEqual(['ACK_REQUIRED', 'RANK_MISMATCH', 'YOU_WORK_THAT_DAY'])
    for (const r of result.reasons) expect(r.message.length).toBeGreaterThan(0)
    // the poster is also still working their own (untraded) day
    expect((await eligibility(poster, id)).reasons.map((r) => r.code)).toEqual(['OWN_SHIFT', 'YOU_WORK_THAT_DAY'])
  })

  it('reports NOT_FOUND and STARTED instead of raising', async () => {
    const m = await member({ tour: 2 })
    expect(await eligibility(m, randomUUID())).toMatchObject({ eligible: false, reasons: [{ code: 'NOT_FOUND' }] })
    const poster = await member({ tour: null })
    const past = await t.createShift({ poster, date: daysFromToday(-2) })
    expect((await eligibility(m, past)).reasons.map((r) => r.code)).toContain('STARTED')
  })

  it('for a SwapMatch without a chosen date, lists the offered return dates that would work', async () => {
    const poster = await member({ tour: 1 })
    const taker = await member({ tour: 2 })
    const good = SWAP_DAY()
    const bad = NEITHER_DAY()
    const id = await post(poster, { p_return_dates: [good, bad] })
    expect(await eligibility(taker, id)).toEqual({ eligible: true, reasons: [], valid_return_dates: [good] })
    // with a chosen date
    expect((await eligibility(taker, id, good)).eligible).toBe(true)
    expect((await eligibility(taker, id, bad)).reasons.map((r) => r.code)).toEqual(['RETURN_NOT_YOUR_DAY'])
    expect((await eligibility(taker, id, daysFromToday(90))).reasons.map((r) => r.code)).toEqual(['RETURN_DATE_INVALID'])
  })

  it('for a SwapMatch where no offered date works, says so', async () => {
    const poster = await member({ tour: 1 })
    const taker = await member({ tour: 2 })
    const id = await post(poster, { p_return_dates: [NEITHER_DAY()] })
    const result = await eligibility(taker, id)
    expect(result).toMatchObject({ eligible: false, valid_return_dates: [] })
    expect(result.reasons.map((r) => r.code)).toEqual(['RETURN_NOT_YOUR_DAY'])
  })

  it('requires an approved member', async () => {
    const poster = await member({ tour: 1 })
    const id = await post(poster)
    await expectRpcError(eligibility(await member({ status: 'pending' }), id), 'NOT_APPROVED')
  })
})

// ---------------------------------------------------------------------------
describe('request_shift', () => {
  it('creates a pending request with snapshots and notifies the poster', async () => {
    const poster = await member({ tour: 1 })
    const taker = await member({ tour: 2, fullName: 'Taker Tess', station: 15 })
    const id = await post(poster)
    const reqId = await request(taker, id, null, '  I can do it  ')
    const r = await t.one(`select * from public.shift_requests where id = $1`, [reqId])
    expect(r).toMatchObject({
      shift_id: id,
      requester_id: taker.id,
      requester_name: 'Taker Tess',
      requester_rank: 'Firefighter',
      requester_station: 15,
      return_date: null,
      message: 'I can do it',
      status: 'pending',
      decided_at: null,
    })
    const [n] = await t.notificationsFor(poster.id, 'request_received')
    expect(n).toMatchObject({ shift_id: id, actor_id: taker.id, url: `/trades/${id}` })
    expect(n.title).toContain('Taker Tess')
    expect(n.body).toContain('Station 15')
    expect(n.body).toContain('I can do it')
  })

  it('records the SwapMatch return date and mentions it to the poster', async () => {
    const poster = await member({ tour: 1 })
    const taker = await member({ tour: 2 })
    const rd = SWAP_DAY()
    const id = await post(poster, { p_return_dates: [rd] })
    const reqId = await request(taker, id, rd)
    expect((await t.one(`select return_date from public.shift_requests where id = $1`, [reqId])).return_date).toBe(rd)
    const [n] = await t.notificationsFor(poster.id, 'request_received')
    expect(n.body).toContain('in return')
  })

  it('NOT_FOUND / OWN_SHIFT / NOT_OPEN / STARTED', async () => {
    const poster = await member({ tour: 1 })
    const taker = await member({ tour: 2 })
    await expectRpcError(request(taker, randomUUID()), 'NOT_FOUND')
    const id = await post(poster)
    await expectRpcError(request(poster, id), 'OWN_SHIFT')
    const cancelled = await t.createShift({ poster, date: tourDay(1, 3, 1), status: 'cancelled' })
    await expectRpcError(request(taker, cancelled), 'NOT_OPEN')
    const noTour = await member({ tour: null })
    const past = await t.createShift({ poster: noTour, date: daysFromToday(-2) })
    await expectRpcError(request(taker, past), 'STARTED')
  })

  it('RANK_MISMATCH: same rank only', async () => {
    const poster = await member({ tour: 1 })
    const id = await post(poster)
    await expectRpcError(request(await member({ tour: 2, rank: 'Captain' }), id), 'RANK_MISMATCH')
  })

  it('OUTSIDE_LIMIT: station, battalion and division limits (relative to the shift\'s station)', async () => {
    const day = tourDay(1, 3, 3)
    const p1 = await member({ tour: 1, station: 2 })
    // posted at Station 19 (B9/D3) although the poster is at Station 2
    const byStation = await post(p1, { p_date: day, p_station: 19, p_accept_limit: 'station' })
    await expectRpcError(request(await member({ tour: 2, station: 15 }), byStation), 'OUTSIDE_LIMIT')
    expect(await request(await member({ tour: 2, station: 19 }), byStation)).toBeTruthy()

    const p2 = await member({ tour: 1, station: 19 })
    const byBattalion = await post(p2, { p_date: day, p_accept_limit: 'battalion' })
    await expectRpcError(request(await member({ tour: 2, station: 4 }), byBattalion), 'OUTSIDE_LIMIT')
    expect(await request(await member({ tour: 2, station: 15 }), byBattalion)).toBeTruthy()

    const p3 = await member({ tour: 1, station: 19 })
    const byDivision = await post(p3, { p_date: day, p_accept_limit: 'division' })
    await expectRpcError(request(await member({ tour: 2, station: 2 }), byDivision), 'OUTSIDE_LIMIT')
    expect(await request(await member({ tour: 2, station: 4 }), byDivision)).toBeTruthy()
  })

  it('YOU_WORK_THAT_DAY unless the requester gave that day away', async () => {
    const poster = await member({ tour: 1 })
    const id = await post(poster)
    await expectRpcError(request(await member({ tour: 1 }), id), 'YOU_WORK_THAT_DAY')

    const gaveAway = await member({ tour: 1 })
    await t.createShift({ poster: gaveAway, date: DAY(), coverer: await member({ tour: 2 }) })
    expect(await request(gaveAway, id)).toBeTruthy()
  })

  it('YOU_WORK_THAT_DAY for a member with no tour who has an open post that day, not once it is given away', async () => {
    const poster = await member({ tour: 1 })
    const id = await post(poster, { p_date: tourDay(1, 3, 4) })
    const relief = await member({ tour: null })
    const own = await post(relief, { p_date: tourDay(1, 3, 4) })
    await expectRpcError(request(relief, id), 'YOU_WORK_THAT_DAY')
    expect((await eligibility(relief, id)).reasons.map((r) => r.code)).toEqual(['YOU_WORK_THAT_DAY'])

    await t.rpc(relief.id, 'confirm_request', { p_request_id: await request(await member({ tour: 2 }), own) })
    expect(await request(relief, id)).toBeTruthy()
  })

  it('NOT_OPEN when the poster is no longer an approved member (no contact details either)', async () => {
    const poster = await member({ tour: 1 })
    const taker = await member({ tour: 2 })
    const id = await post(poster, { p_date: tourDay(1, 3, 5) })
    // set directly, without the clean-up admin_set_member_status does
    await t.query(`update public.profiles set status = 'suspended' where id = $1`, [poster.id])
    await expectRpcError(request(taker, id), 'NOT_OPEN')
    expect((await eligibility(taker, id)).reasons.map((r) => r.code)).toEqual(['NOT_OPEN'])
    expect(await t.rpc(taker.id, 'get_trade_contact', { p_shift_id: id })).toEqual([])
  })

  it('ALREADY_COVERING: already covering another shift that day', async () => {
    const poster = await member({ tour: 1 })
    const taker = await member({ tour: 2 })
    const id = await post(poster)
    await t.createShift({ poster: await member({ tour: 1 }), date: DAY(), coverer: taker })
    await expectRpcError(request(taker, id), 'ALREADY_COVERING')
  })

  it('ALREADY_REQUESTED: one pending request per member per shift; allowed again after withdrawing', async () => {
    const poster = await member({ tour: 1 })
    const taker = await member({ tour: 2 })
    const id = await post(poster)
    const first = await request(taker, id)
    await expectRpcError(request(taker, id), 'ALREADY_REQUESTED')
    await t.rpc(taker.id, 'withdraw_request', { p_request_id: first })
    expect(await request(taker, id)).not.toBe(first)
  })

  it('SwapMatch rules: RETURN_DATE_REQUIRED, RETURN_DATE_INVALID, RETURN_NOT_YOUR_DAY', async () => {
    const poster = await member({ tour: 1 })
    const taker = await member({ tour: 2 })
    const good = SWAP_DAY()
    const neither = NEITHER_DAY()
    const id = await post(poster, { p_return_dates: [good, neither] })
    await expectRpcError(request(taker, id), 'RETURN_DATE_REQUIRED')
    await expectRpcError(request(taker, id, daysFromToday(100)), 'RETURN_DATE_INVALID')
    // not the requester's tour day
    await expectRpcError(request(taker, id, neither), 'RETURN_NOT_YOUR_DAY')

    // the requester already posted their return-date shift
    const busy = await member({ tour: 2 })
    await post(busy, { p_date: good })
    await expectRpcError(request(busy, id, good), 'RETURN_NOT_YOUR_DAY')

    // a no-tour requester can offer any day they haven't posted or picked up
    const noTour = await member({ tour: null })
    expect(await request(noTour, id, neither)).toBeTruthy()

    // a plain (non-SwapMatch) shift takes no return date
    const plain = await post(await member({ tour: 1 }))
    await expectRpcError(request(taker, plain, good), 'RETURN_DATE_INVALID')
  })

  it('RETURN_DATE_INVALID once the offered return date has started', async () => {
    const poster = await member({ tour: null })
    const taker = await member({ tour: null })
    const id = await t.createShift({ poster, date: daysFromToday(30), returnDates: [daysFromToday(-2)] })
    await expectRpcError(request(taker, id, daysFromToday(-2)), 'RETURN_DATE_INVALID')
  })

  it('POSTER_WORKS_RETURN_DAY: the poster picked up a shift on that return date since posting', async () => {
    const poster = await member({ tour: 1 })
    const taker = await member({ tour: 2 })
    const rd = SWAP_DAY()
    const id = await post(poster, { p_return_dates: [rd] })
    await t.createShift({ poster: await member({ tour: 2 }), date: rd, coverer: poster })
    await expectRpcError(request(taker, id, rd), 'POSTER_WORKS_RETURN_DAY')
  })

  it('INVALID_INPUT for a message over 300 characters; ACK_REQUIRED; NOT_APPROVED', async () => {
    const poster = await member({ tour: 1 })
    const id = await post(poster)
    await expectRpcError(request(await member({ tour: 2 }), id, null, 'x'.repeat(301)), 'INVALID_INPUT')
    await expectRpcError(request(await member({ tour: 2, ack: false }), id), 'ACK_REQUIRED')
    await expectRpcError(request(await member({ tour: 2, status: 'suspended' }), id), 'NOT_APPROVED')
    await expectRpcError(request(NO_SUB, id), 'NOT_SIGNED_IN')
  })
})

// ---------------------------------------------------------------------------
describe('withdraw_request', () => {
  it('withdraws a pending request and tells the poster', async () => {
    const poster = await member({ tour: 1 })
    const taker = await member({ tour: 2, fullName: 'Wanda Withdraw' })
    const id = await post(poster)
    const reqId = await request(taker, id)
    await t.rpc(taker.id, 'withdraw_request', { p_request_id: reqId })
    const r = await t.one(`select status, decided_at from public.shift_requests where id = $1`, [reqId])
    expect(r.status).toBe('withdrawn')
    expect(r.decided_at).not.toBeNull()
    const [n] = await t.notificationsFor(poster.id, 'request_withdrawn')
    expect(n.title).toContain('Wanda Withdraw')
  })

  it('only the requester, only while pending', async () => {
    const poster = await member({ tour: 1 })
    const taker = await member({ tour: 2 })
    const id = await post(poster)
    const reqId = await request(taker, id)
    await expectRpcError(t.rpc(poster.id, 'withdraw_request', { p_request_id: reqId }), 'NOT_PARTICIPANT')
    await t.rpc(taker.id, 'withdraw_request', { p_request_id: reqId })
    await expectRpcError(t.rpc(taker.id, 'withdraw_request', { p_request_id: reqId }), 'NOT_OPEN')
    await expectRpcError(t.rpc(taker.id, 'withdraw_request', { p_request_id: randomUUID() }), 'NOT_FOUND')
  })
})

// ---------------------------------------------------------------------------
describe('decline_request', () => {
  it('declines a pending request and tells the requester', async () => {
    const poster = await member({ tour: 1 })
    const taker = await member({ tour: 2 })
    const id = await post(poster)
    const reqId = await request(taker, id)
    await t.rpc(poster.id, 'decline_request', { p_request_id: reqId })
    expect((await t.one(`select status from public.shift_requests where id = $1`, [reqId])).status).toBe('declined')
    expect(await t.notificationsFor(taker.id, 'request_declined')).toHaveLength(1)
    // the shift stays open
    expect((await shift(id)).status).toBe('open')
  })

  it('only the poster, only while pending', async () => {
    const poster = await member({ tour: 1 })
    const taker = await member({ tour: 2 })
    const id = await post(poster)
    const reqId = await request(taker, id)
    await expectRpcError(t.rpc(taker.id, 'decline_request', { p_request_id: reqId }), 'NOT_PARTICIPANT')
    await t.rpc(poster.id, 'decline_request', { p_request_id: reqId })
    await expectRpcError(t.rpc(poster.id, 'decline_request', { p_request_id: reqId }), 'NOT_OPEN')
    await expectRpcError(t.rpc(poster.id, 'decline_request', { p_request_id: randomUUID() }), 'NOT_FOUND')
  })
})
