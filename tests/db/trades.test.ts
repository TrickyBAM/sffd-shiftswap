// Confirmed trades: confirm_request (plain + SwapMatch), balances (my_stats,
// my_ledger, my_schedule), mutual cancel (request/respond/withdraw) and admin
// void (ARCHITECTURE §4, §6.1, §6.3).

import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  addDays,
  createTestDb,
  daysFromToday,
  expectRpcError,
  tourDay,
  tourWorks,
  type Member,
  type MemberOptions,
  type Row,
  type TestDb,
} from './harness'

let t: TestDb
let admin: Member

beforeAll(async () => {
  t = await createTestDb()
  admin = await t.createMember({ role: 'admin', tour: null })
})

afterAll(async () => {
  await t?.close()
})

const DAY = () => tourDay(1, 3)
const SWAP_DAY = () => tourDay(2, 3)
const member = (opts: MemberOptions = {}) => t.createMember(opts)

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

function request(m: Member, shiftId: string, returnDate: string | null = null) {
  return t.rpc<string>(m.id, 'request_shift', { p_shift_id: shiftId, p_return_date: returnDate, p_message: null })
}

function confirm(m: Member, requestId: string) {
  return t.rpc<{ shift_id: string; return_leg_id: string | null }>(m.id, 'confirm_request', { p_request_id: requestId })
}

async function shift(id: string): Promise<Row> {
  return t.one(`select * from public.shifts where id = $1`, [id])
}

interface Setup {
  poster: Member
  taker: Member
  id: string
  reqId: string
  rd: string | null
}

/** A tour-1 poster's post and a tour-2 member's pending request (SwapMatch when swap). */
async function requested(swap = false): Promise<Setup> {
  const poster = await member({ tour: 1, fullName: 'Pat Poster' })
  const taker = await member({ tour: 2, fullName: 'Tom Taker' })
  const rd = swap ? SWAP_DAY() : null
  const id = await post(poster, { p_return_dates: rd ? [rd] : null })
  const reqId = await request(taker, id, rd)
  return { poster, taker, id, reqId, rd }
}

async function confirmed(swap = false): Promise<Setup & { legId: string | null }> {
  const s = await requested(swap)
  const result = await confirm(s.poster, s.reqId)
  return { ...s, legId: result.return_leg_id }
}

type Stats = {
  posted: number
  covered: number
  given: number
  outstanding: number
  balance: number
  trust_score: number
  by_type: Record<'24-Hour' | 'PM', { covered: number; given: number; balance: number }>
}
const stats = (m: Member) => t.rpc<Stats>(m.id, 'my_stats')

// ---------------------------------------------------------------------------
describe('confirm_request', () => {
  it('makes a trade: shift covered, request accepted, requester told', async () => {
    const { poster, taker, id, reqId } = await requested()
    const result = await confirm(poster, reqId)
    expect(result).toEqual({ shift_id: id, return_leg_id: null })
    const s = await shift(id)
    expect(s).toMatchObject({ status: 'covered', coverer_id: taker.id, coverer_name: 'Tom Taker', return_leg_id: null })
    expect(s.confirmed_at).not.toBeNull()
    const r = await t.one(`select status, decided_at from public.shift_requests where id = $1`, [reqId])
    expect(r.status).toBe('accepted')
    const [n] = await t.notificationsFor(taker.id, 'request_accepted')
    expect(n).toMatchObject({ shift_id: id, actor_id: poster.id })
    expect(n.body).toContain('TeleStaff')
    expect(await t.query(`select 1 from public.audit_log where target_id = $1 and action = 'trade.confirmed'`, [id])).toHaveLength(1)
  })

  it('auto-declines every other pending request with a polite notice', async () => {
    const { poster, id, reqId } = await requested()
    const others = [await member({ tour: 2 }), await member({ tour: 2 }), await member({ tour: 2 })]
    const otherReqs = [await request(others[0], id), await request(others[1], id), await request(others[2], id)]
    await t.rpc(others[2].id, 'withdraw_request', { p_request_id: otherReqs[2] })
    await confirm(poster, reqId)
    const rows = await t.query<{ id: string; status: string }>(`select id, status from public.shift_requests where shift_id = $1`, [id])
    const status = Object.fromEntries(rows.map((r) => [r.id, r.status]))
    expect(status).toEqual({ [reqId]: 'accepted', [otherReqs[0]]: 'declined', [otherReqs[1]]: 'declined', [otherReqs[2]]: 'withdrawn' })
    for (const m of others.slice(0, 2)) {
      const [n] = await t.notificationsFor(m.id, 'request_declined')
      expect(n.body).toContain('filled by another member')
    }
    expect(await t.notificationsFor(others[2].id, 'request_declined')).toEqual([])
  })

  it('can never confirm a shift twice', async () => {
    const { poster, id, reqId } = await requested()
    const second = await member({ tour: 2 })
    const secondReq = await request(second, id)
    await confirm(poster, reqId)
    await expectRpcError(confirm(poster, reqId), 'NOT_OPEN')
    await expectRpcError(confirm(poster, secondReq), 'NOT_OPEN')
    // even a pending request smuggled onto the covered shift can't be confirmed
    const third = await member({ tour: 2 })
    const smuggled = await t.one<{ id: string }>(
      `insert into public.shift_requests (shift_id, requester_id, requester_name, requester_rank, requester_station)
       values ($1, $2, 'x', 'Firefighter', 19) returning id`,
      [id, third.id],
    )
    await expectRpcError(confirm(poster, smuggled.id), 'NOT_OPEN')
    expect((await shift(id)).coverer_id).not.toBe(third.id)
  })

  it('only the poster can confirm; unknown requests are NOT_FOUND', async () => {
    const { taker, reqId } = await requested()
    await expectRpcError(confirm(taker, reqId), 'NOT_PARTICIPANT')
    await expectRpcError(confirm(taker, randomUUID()), 'NOT_FOUND')
  })

  describe('re-validates the request against current data', () => {
    it('YOU_WORK_THAT_DAY when the requester now works that day', async () => {
      const { poster, taker, reqId } = await requested()
      await t.query(`update public.profiles set tour = 1 where id = $1`, [taker.id])
      const e = await expectRpcError(confirm(poster, reqId), 'YOU_WORK_THAT_DAY')
      expect(e.message).toContain('Tom Taker')
    })

    it('ALREADY_COVERING when the requester picked up another shift that day', async () => {
      const { poster, taker, reqId } = await requested()
      await t.createShift({ poster: await member({ tour: 1 }), date: DAY(), coverer: taker })
      await expectRpcError(confirm(poster, reqId), 'ALREADY_COVERING')
    })

    it('NOT_APPROVED when the requester was suspended', async () => {
      const { poster, taker, reqId } = await requested()
      await t.query(`update public.profiles set status = 'suspended' where id = $1`, [taker.id])
      await expectRpcError(confirm(poster, reqId), 'NOT_APPROVED')
    })

    it('RANK_MISMATCH and OUTSIDE_LIMIT when the requester changed rank or station', async () => {
      const a = await requested()
      await t.query(`update public.profiles set rank = 'Captain' where id = $1`, [a.taker.id])
      await expectRpcError(confirm(a.poster, a.reqId), 'RANK_MISMATCH')

      const poster = await member({ tour: 1, station: 19 })
      const taker = await member({ tour: 2, station: 19 })
      const id = await post(poster, { p_accept_limit: 'station' })
      const reqId = await request(taker, id)
      await t.query(`update public.profiles set station = 2, battalion = 1, division = 2 where id = $1`, [taker.id])
      await expectRpcError(confirm(poster, reqId), 'OUTSIDE_LIMIT')
    })

    it('STARTED once the shift has started', async () => {
      const poster = await member({ tour: null })
      const taker = await member({ tour: null })
      const id = await t.createShift({ poster, date: daysFromToday(-1) })
      const req = await t.one<{ id: string }>(
        `insert into public.shift_requests (shift_id, requester_id, requester_name, requester_rank, requester_station)
         values ($1, $2, 'x', 'Firefighter', 19) returning id`,
        [id, taker.id],
      )
      await expectRpcError(confirm(poster, req.id), 'STARTED')
    })
  })
})

// ---------------------------------------------------------------------------
describe('SwapMatch confirm', () => {
  it('creates the return leg: requester\'s shift on the return date, covered by the poster', async () => {
    const { poster, taker, id, rd, legId } = await confirmed(true)
    expect(legId).toBeTruthy()
    const original = await shift(id)
    expect(original).toMatchObject({ status: 'covered', coverer_id: taker.id, return_leg_id: legId })
    const leg = await shift(legId!)
    expect(leg).toMatchObject({
      poster_id: taker.id,
      poster_name: 'Tom Taker',
      rank: 'Firefighter',
      station: taker.station,
      battalion: taker.battalion,
      division: taker.division,
      date: rd,
      shift_type: '24-Hour',
      hours: 24,
      status: 'covered',
      coverer_id: poster.id,
      coverer_name: 'Pat Poster',
      return_leg_of: id,
      return_leg_id: null,
      return_dates: [],
    })
    const [n] = await t.notificationsFor(taker.id, 'request_accepted')
    expect(n.body).toContain('In return')
  })

  it('nets both members\' balances and the ledger to zero', async () => {
    const { poster, taker } = await confirmed(true)
    const ps = await stats(poster)
    const ts = await stats(taker)
    expect(ps).toMatchObject({ posted: 1, covered: 1, given: 1, balance: 0, outstanding: 0 })
    expect(ts).toMatchObject({ posted: 0, covered: 1, given: 1, balance: 0 })
    expect(ps.by_type['24-Hour']).toEqual({ covered: 1, given: 1, balance: 0 })
    expect(ps.by_type.PM).toEqual({ covered: 0, given: 0, balance: 0 })

    const ledger = await t.rpc<Row[]>(poster.id, 'my_ledger')
    expect(ledger).toHaveLength(1)
    expect(ledger[0]).toMatchObject({
      partner_id: taker.id,
      partner_name: 'Tom Taker',
      i_covered_24: 1,
      they_covered_24: 1,
      net_24: 0,
      net_pm: 0,
      upcoming: 2,
    })
  })

  it('POSTER_WORKS_RETURN_DAY when the poster picked up a shift on the return date meanwhile', async () => {
    const { poster, reqId, rd } = await requested(true)
    await t.createShift({ poster: await member({ tour: 2 }), date: rd!, coverer: poster })
    const e = await expectRpcError(confirm(poster, reqId), 'POSTER_WORKS_RETURN_DAY')
    expect(e.message).toContain('You')
  })

  it('POSTER_WORKS_RETURN_DAY when a no-tour poster has a post on the return date', async () => {
    const poster = await member({ tour: null })
    const taker = await member({ tour: 2 })
    const rd = SWAP_DAY()
    const id = await post(poster, { p_date: tourDay(1, 3), p_return_dates: [rd] })
    const reqId = await request(taker, id, rd)
    await t.createShift({ poster, date: rd })
    await expectRpcError(confirm(poster, reqId), 'POSTER_WORKS_RETURN_DAY')
  })

  it('RETURN_NOT_YOUR_DAY when the requester has since posted their return-date shift', async () => {
    const { poster, taker, reqId, rd } = await requested(true)
    await post(taker, { p_date: rd })
    await expectRpcError(confirm(poster, reqId), 'RETURN_NOT_YOUR_DAY')
  })

  it('RETURN_DATE_INVALID once the return date has started', async () => {
    const poster = await member({ tour: null })
    const taker = await member({ tour: null })
    const past = daysFromToday(-2)
    const id = await t.createShift({ poster, date: daysFromToday(20), returnDates: [past] })
    const req = await t.one<{ id: string }>(
      `insert into public.shift_requests (shift_id, requester_id, requester_name, requester_rank, requester_station, return_date)
       values ($1, $2, 'x', 'Firefighter', 19, $3) returning id`,
      [id, taker.id, past],
    )
    await expectRpcError(confirm(poster, req.id), 'RETURN_DATE_INVALID')
  })
})

// ---------------------------------------------------------------------------
describe('my_stats', () => {
  it('counts a plain trade for both sides', async () => {
    const { poster, taker } = await confirmed()
    expect(await stats(poster)).toMatchObject({ posted: 1, covered: 0, given: 1, balance: -1, outstanding: 0, trust_score: 100 })
    expect(await stats(taker)).toMatchObject({ posted: 0, covered: 1, given: 0, balance: 1 })
  })

  it('counts open posts as outstanding and ignores cancelled posts', async () => {
    const m = await member({ tour: null })
    await post(m, { p_date: daysFromToday(10) })
    await post(m, { p_date: daysFromToday(11), p_shift_type: 'PM' })
    const c = await post(m, { p_date: daysFromToday(12) })
    await t.rpc(m.id, 'cancel_post', { p_shift_id: c })
    await t.createShift({ poster: m, date: daysFromToday(-5) }) // stale, already started
    expect(await stats(m)).toMatchObject({ posted: 3, outstanding: 2, covered: 0, given: 0, balance: 0 })
  })

  it('computes the trust score: −5 per week-old unanswered post, +3 per shift covered in the last 30 days', async () => {
    const m = await member({ tour: null })
    for (const d of [30, 31, 32]) await t.createShift({ poster: m, date: daysFromToday(d), createdAgo: '8 days' })
    await t.createShift({ poster: m, date: daysFromToday(33), createdAgo: '6 days' }) // not stale yet
    await t.createShift({ poster: m, date: daysFromToday(-3), createdAgo: '20 days' }) // started: not counted
    const other = await member({ tour: null })
    await t.createShift({ poster: other, date: daysFromToday(-2), coverer: m })
    await t.createShift({ poster: other, date: daysFromToday(-10), coverer: m })
    await t.createShift({ poster: other, date: daysFromToday(-40), coverer: m }) // too long ago
    await t.createShift({ poster: other, date: daysFromToday(15), coverer: m }) // not worked yet
    // 100 − 5·3 + 3·2
    expect((await stats(m)).trust_score).toBe(91)
  })

  it('clamps the trust score to 0…100', async () => {
    const m = await member({ tour: null })
    for (let d = 30; d < 51; d++) await t.createShift({ poster: m, date: daysFromToday(d), createdAgo: '8 days' })
    expect((await stats(m)).trust_score).toBe(0)

    const busy = await member({ tour: null })
    const other = await member({ tour: null })
    for (const d of [-1, -2, -3]) await t.createShift({ poster: other, date: daysFromToday(d), coverer: busy })
    expect((await stats(busy)).trust_score).toBe(100)
  })

  it('requires an approved member', async () => {
    await expectRpcError(stats(await member({ status: 'pending' })), 'NOT_APPROVED')
  })
})

// ---------------------------------------------------------------------------
describe('my_ledger', () => {
  it('summarises per partner and shift type; net > 0 means they owe me', async () => {
    const me = await member({ tour: null, fullName: 'Lee Ledger' })
    const a = await member({ tour: null, fullName: 'Amy Alpha', rank: 'Firefighter' })
    const b = await member({ tour: null, fullName: 'Bob Beta' })
    // I covered Amy twice (24-Hour, one past, one upcoming); Amy covered me once (PM).
    await t.createShift({ poster: a, date: daysFromToday(-4), coverer: me })
    await t.createShift({ poster: a, date: daysFromToday(25), coverer: me })
    await t.createShift({ poster: me, date: daysFromToday(26), coverer: a, shiftType: 'PM' })
    // Bob covered me once (24-Hour) a while back; a cancelled trade doesn't count.
    await t.createShift({ poster: me, date: daysFromToday(-20), coverer: b })
    await t.createShift({ poster: b, date: daysFromToday(27), status: 'cancelled' })

    const rows = await t.rpc<Row[]>(me.id, 'my_ledger')
    expect(rows).toEqual([
      {
        partner_id: a.id,
        partner_name: 'Amy Alpha',
        partner_rank: 'Firefighter',
        i_covered_24: 2,
        i_covered_pm: 0,
        they_covered_24: 0,
        they_covered_pm: 1,
        net_24: 2,
        net_pm: -1,
        upcoming: 2,
        last_date: daysFromToday(26),
      },
      {
        partner_id: b.id,
        partner_name: 'Bob Beta',
        partner_rank: 'Firefighter',
        i_covered_24: 0,
        i_covered_pm: 0,
        they_covered_24: 1,
        they_covered_pm: 0,
        net_24: -1,
        net_pm: 0,
        upcoming: 0,
        last_date: daysFromToday(-20),
      },
    ])
    // Amy's view is the mirror image
    const amy = await t.rpc<Row[]>(a.id, 'my_ledger')
    expect(amy[0]).toMatchObject({ partner_id: me.id, net_24: -2, net_pm: 1 })
  })

  it('is empty for a member with no trades', async () => {
    expect(await t.rpc((await member()).id, 'my_ledger')).toEqual([])
  })
})

// ---------------------------------------------------------------------------
describe('my_schedule', () => {
  interface Day {
    date: string
    base: boolean
    given_away: boolean
    picked_up: boolean
    working: boolean
    open_post_id: string | null
    given_shift_id: string | null
    picked_shift_id: string | null
    is_swap: boolean
  }
  const schedule = (m: Member, from: string, to: string) =>
    t.rpc<Day[]>(m.id, 'my_schedule', { p_from: from, p_to: to })

  it('returns one row per day with the effective schedule', async () => {
    const me = await member({ tour: 1 })
    const other = await member({ tour: 2 })
    const from = daysFromToday(2)
    const to = addDays(from, 30)
    const given = tourDay(1, 2, 0)
    const open = tourDay(1, 2, 1)
    const picked = tourDay(2, 2, 0)
    const givenId = await t.createShift({ poster: me, date: given, coverer: other })
    const openId = await t.createShift({ poster: me, date: open })
    const pickedId = await t.createShift({ poster: other, date: picked, coverer: me })

    const days = await schedule(me, from, to)
    expect(days).toHaveLength(31)
    expect(days[0].date).toBe(from)
    expect(days[30].date).toBe(to)
    for (const d of days) {
      expect(d.base, d.date).toBe(tourWorks(1, d.date))
      if (d.date === given) {
        expect(d).toMatchObject({ given_away: true, working: false, given_shift_id: givenId, is_swap: false })
      } else if (d.date === picked) {
        expect(d).toMatchObject({ picked_up: true, working: true, picked_shift_id: pickedId, base: false })
      } else if (d.date === open) {
        expect(d).toMatchObject({ working: true, open_post_id: openId, given_away: false })
      } else {
        expect(d.working, d.date).toBe(d.base)
        expect(d.open_post_id).toBeNull()
      }
    }
  })

  it('flags both SwapMatch legs', async () => {
    const { poster, id, rd, legId } = await confirmed(true)
    const days = await schedule(poster, DAY() < rd! ? DAY() : rd!, DAY() < rd! ? rd! : DAY())
    const original = days.find((d) => d.date === DAY())!
    const back = days.find((d) => d.date === rd)!
    expect(original).toMatchObject({ given_away: true, given_shift_id: id, is_swap: true, working: false })
    expect(back).toMatchObject({ picked_up: true, picked_shift_id: legId, is_swap: true, working: true })
  })

  it('has no base days for a member with no tour', async () => {
    const days = await schedule(await member({ tour: null }), daysFromToday(0), daysFromToday(30))
    expect(days.every((d) => !d.base && !d.working)).toBe(true)
  })

  it('accepts up to 400 days and rejects bad ranges', async () => {
    const m = await member()
    expect(await schedule(m, daysFromToday(0), daysFromToday(399))).toHaveLength(400)
    await expectRpcError(schedule(m, daysFromToday(0), daysFromToday(400)), 'INVALID_INPUT')
    await expectRpcError(schedule(m, daysFromToday(5), daysFromToday(4)), 'INVALID_INPUT')
  })
})

// ---------------------------------------------------------------------------
describe('request_trade_cancel', () => {
  it('lets either party ask; the other party is told', async () => {
    const { poster, taker, id } = await confirmed()
    await t.rpc(taker.id, 'request_trade_cancel', { p_shift_id: id, p_reason: '  Family thing ' })
    const s = await shift(id)
    expect(s).toMatchObject({ status: 'covered', cancel_requested_by: taker.id, cancel_reason: 'Family thing' })
    expect(s.cancel_requested_at).not.toBeNull()
    const [n] = await t.notificationsFor(poster.id, 'cancel_requested')
    expect(n).toMatchObject({ shift_id: id, actor_id: taker.id })
    expect(n.body).toContain('Family thing')
    expect(await t.query(`select 1 from public.audit_log where target_id = $1 and action = 'trade.cancel_requested'`, [id])).toHaveLength(1)
  })

  it('works from either leg of a SwapMatch (resolved to the original)', async () => {
    const { poster, id, legId, taker } = await confirmed(true)
    await t.rpc(poster.id, 'request_trade_cancel', { p_shift_id: legId, p_reason: null })
    expect((await shift(id)).cancel_requested_by).toBe(poster.id)
    expect((await shift(legId!)).cancel_requested_by).toBeNull()
    const [n] = await t.notificationsFor(taker.id, 'cancel_requested')
    expect(n.body).toContain('return shift')
  })

  it('NOT_PARTICIPANT, NOT_OPEN, ALREADY_REQUESTED, NOT_FOUND, INVALID_INPUT', async () => {
    const { poster, taker, id } = await confirmed()
    const stranger = await member({ tour: 2 })
    await expectRpcError(t.rpc(stranger.id, 'request_trade_cancel', { p_shift_id: id, p_reason: null }), 'NOT_PARTICIPANT')
    await expectRpcError(t.rpc(taker.id, 'request_trade_cancel', { p_shift_id: id, p_reason: 'x'.repeat(501) }), 'INVALID_INPUT')
    await t.rpc(taker.id, 'request_trade_cancel', { p_shift_id: id, p_reason: null })
    await expectRpcError(t.rpc(poster.id, 'request_trade_cancel', { p_shift_id: id, p_reason: null }), 'ALREADY_REQUESTED')
    const open = await post(await member({ tour: 1 }))
    await expectRpcError(t.rpc(poster.id, 'request_trade_cancel', { p_shift_id: open, p_reason: null }), 'NOT_OPEN')
    await expectRpcError(t.rpc(poster.id, 'request_trade_cancel', { p_shift_id: randomUUID(), p_reason: null }), 'NOT_FOUND')
  })

  it('STARTED once either leg has started', async () => {
    const poster = await member({ tour: null })
    const taker = await member({ tour: null })
    const past = await t.createShift({ poster, date: daysFromToday(-1), coverer: taker })
    await expectRpcError(t.rpc(taker.id, 'request_trade_cancel', { p_shift_id: past, p_reason: null }), 'STARTED')

    // original in the future, return leg already worked
    const original = await t.createShift({ poster, date: daysFromToday(20), coverer: taker })
    const leg = await t.createShift({ poster: taker, date: daysFromToday(-2), coverer: poster, returnLegOf: original })
    await t.query(`update public.shifts set return_leg_id = $2 where id = $1`, [original, leg])
    await expectRpcError(t.rpc(poster.id, 'request_trade_cancel', { p_shift_id: original, p_reason: null }), 'STARTED')
  })
})

// ---------------------------------------------------------------------------
describe('respond_trade_cancel', () => {
  it('agree: the original reopens, the return leg is cancelled, both are told', async () => {
    const { poster, taker, id, reqId, legId } = await confirmed(true)
    await t.rpc(taker.id, 'request_trade_cancel', { p_shift_id: id, p_reason: 'Sick kid' })
    await t.rpc(poster.id, 'respond_trade_cancel', { p_shift_id: legId, p_agree: true })

    expect(await shift(id)).toMatchObject({
      status: 'open',
      coverer_id: null,
      coverer_name: null,
      confirmed_at: null,
      return_leg_id: null,
      cancel_requested_by: null,
      cancel_reason: null,
    })
    expect(await shift(legId!)).toMatchObject({ status: 'cancelled', coverer_id: null, cancelled_by: poster.id, return_leg_of: id })
    expect((await t.one(`select status from public.shift_requests where id = $1`, [reqId])).status).toBe('cancelled')
    for (const m of [poster, taker]) {
      const [n] = await t.notificationsFor(m.id, 'trade_cancelled')
      expect(n.body).toContain('open on the board again')
    }
    expect(await t.query(`select 1 from public.audit_log where target_id = $1 and action = 'trade.cancelled'`, [id])).toHaveLength(1)

    // balances are back to zero and the shift can be taken again
    expect(await stats(poster)).toMatchObject({ covered: 0, given: 0, balance: 0, outstanding: 1 })
    expect(await stats(taker)).toMatchObject({ covered: 0, given: 0, balance: 0 })
    const again = await request(taker, id, SWAP_DAY())
    expect(await confirm(poster, again)).toMatchObject({ shift_id: id })
  })

  it('decline: the trade stays and the member who asked is told', async () => {
    const { poster, taker, id } = await confirmed()
    await t.rpc(poster.id, 'request_trade_cancel', { p_shift_id: id, p_reason: null })
    await t.rpc(taker.id, 'respond_trade_cancel', { p_shift_id: id, p_agree: false })
    expect(await shift(id)).toMatchObject({ status: 'covered', coverer_id: taker.id, cancel_requested_by: null, cancel_requested_at: null })
    expect(await t.notificationsFor(poster.id, 'cancel_declined')).toHaveLength(1)
    expect(await t.query(`select 1 from public.audit_log where target_id = $1 and action = 'trade.cancel_declined'`, [id])).toHaveLength(1)
  })

  it('only the other party can answer', async () => {
    const { poster, taker, id } = await confirmed()
    await expectRpcError(t.rpc(taker.id, 'respond_trade_cancel', { p_shift_id: id, p_agree: true }), 'NO_CANCEL_PENDING')
    await t.rpc(taker.id, 'request_trade_cancel', { p_shift_id: id, p_reason: null })
    await expectRpcError(t.rpc(taker.id, 'respond_trade_cancel', { p_shift_id: id, p_agree: true }), 'NOT_PARTICIPANT')
    const stranger = await member({ tour: 2 })
    await expectRpcError(t.rpc(stranger.id, 'respond_trade_cancel', { p_shift_id: id, p_agree: true }), 'NOT_PARTICIPANT')
    await expectRpcError(t.rpc(poster.id, 'respond_trade_cancel', { p_shift_id: id, p_agree: null }), 'INVALID_INPUT')
    expect((await shift(id)).status).toBe('covered')
  })

  it('cannot agree once the shift has started (an admin can void it instead)', async () => {
    const poster = await member({ tour: null })
    const taker = await member({ tour: null })
    const id = await t.createShift({ poster, date: daysFromToday(-1), coverer: taker })
    await t.query(`update public.shifts set cancel_requested_by = $2, cancel_requested_at = now() where id = $1`, [id, taker.id])
    await expectRpcError(t.rpc(poster.id, 'respond_trade_cancel', { p_shift_id: id, p_agree: true }), 'STARTED')
    // declining is still possible
    await t.rpc(poster.id, 'respond_trade_cancel', { p_shift_id: id, p_agree: false })
    expect((await shift(id)).cancel_requested_by).toBeNull()
  })
})

// ---------------------------------------------------------------------------
describe('withdraw_trade_cancel', () => {
  it('the member who asked takes it back; their request notice is marked read', async () => {
    const { poster, taker, id } = await confirmed()
    await t.rpc(taker.id, 'request_trade_cancel', { p_shift_id: id, p_reason: null })
    await t.rpc(taker.id, 'withdraw_trade_cancel', { p_shift_id: id })
    expect((await shift(id)).cancel_requested_by).toBeNull()
    const [n] = await t.notificationsFor(poster.id, 'cancel_requested')
    expect(n.read_at).not.toBeNull()
    expect(await t.query(`select 1 from public.audit_log where target_id = $1 and action = 'trade.cancel_withdrawn'`, [id])).toHaveLength(1)
  })

  it('NOT_PARTICIPANT for anyone else; NO_CANCEL_PENDING without a request', async () => {
    const { poster, taker, id } = await confirmed()
    await expectRpcError(t.rpc(taker.id, 'withdraw_trade_cancel', { p_shift_id: id }), 'NO_CANCEL_PENDING')
    await t.rpc(taker.id, 'request_trade_cancel', { p_shift_id: id, p_reason: null })
    await expectRpcError(t.rpc(poster.id, 'withdraw_trade_cancel', { p_shift_id: id }), 'NOT_PARTICIPANT')
  })
})

// ---------------------------------------------------------------------------
describe('admin_void_trade', () => {
  it('voids an upcoming SwapMatch: original reopens, return leg cancelled, both told', async () => {
    const { poster, taker, id, legId } = await confirmed(true)
    await t.rpc(admin.id, 'admin_void_trade', { p_shift_id: id, p_reason: 'Entered by mistake' })
    expect(await shift(id)).toMatchObject({ status: 'open', coverer_id: null, return_leg_id: null })
    expect(await shift(legId!)).toMatchObject({ status: 'cancelled', cancelled_by: admin.id, cancel_note: 'Entered by mistake' })
    for (const m of [poster, taker]) {
      const [n] = await t.notificationsFor(m.id, 'trade_voided')
      expect(n.body).toContain('Entered by mistake')
    }
    expect(await t.query(`select 1 from public.audit_log where target_id = $1 and action = 'admin.trade_voided'`, [id])).toHaveLength(1)
    // the cancelled return leg can't be used to touch the trade any more
    await expectRpcError(t.rpc(admin.id, 'admin_void_trade', { p_shift_id: legId, p_reason: null }), 'NOT_OPEN')
  })

  it('voids a trade that already started: it becomes cancelled, history kept', async () => {
    const poster = await member({ tour: null })
    const taker = await member({ tour: null, fullName: 'Past Coverer' })
    const id = await t.createShift({ poster, date: daysFromToday(-2), coverer: taker })
    await t.rpc(admin.id, 'admin_void_trade', { p_shift_id: id, p_reason: null })
    expect(await shift(id)).toMatchObject({
      status: 'cancelled',
      coverer_id: null,
      coverer_name: 'Past Coverer',
      cancelled_by: admin.id,
      cancel_note: 'Voided by an admin',
    })
    expect(await t.notificationsFor(taker.id, 'trade_voided')).toHaveLength(1)
  })

  it('works on the return leg id and is admin-only', async () => {
    const { id, legId, poster } = await confirmed(true)
    await expectRpcError(t.rpc(poster.id, 'admin_void_trade', { p_shift_id: id, p_reason: null }), 'NOT_ADMIN')
    await t.rpc(admin.id, 'admin_void_trade', { p_shift_id: legId, p_reason: null })
    expect((await shift(id)).status).toBe('open')
    await expectRpcError(t.rpc(admin.id, 'admin_void_trade', { p_shift_id: id, p_reason: null }), 'NOT_OPEN')
  })
})

// ---------------------------------------------------------------------------
describe('undoing a trade never double-books a member (ALREADY_COVERING)', () => {
  /**
   * Pia gives her tour day away to Tim, then — off that day — covers Cal's
   * shift on the same day. Undoing Pia↔Tim would hand Pia her own shift back
   * while she still covers Cal's.
   */
  async function pickedUpSameDay() {
    const day = DAY()
    const pia = await member({ tour: 1, fullName: 'Pia Poster' })
    const tim = await member({ tour: 2, fullName: 'Tim Taker' })
    const cal = await member({ tour: 1, fullName: 'Cal Colleague' })
    const mine = await post(pia, { p_date: day })
    await confirm(pia, await request(tim, mine))
    const cals = await post(cal, { p_date: day })
    await confirm(cal, await request(pia, cals))
    return { pia, tim, cal, mine, cals }
  }

  it('the other member may ask; agreeing is refused until the other trade is undone', async () => {
    const { pia, tim, cal, mine, cals } = await pickedUpSameDay()
    await t.rpc(tim.id, 'request_trade_cancel', { p_shift_id: mine, p_reason: null })

    const error = await expectRpcError(
      t.rpc(pia.id, 'respond_trade_cancel', { p_shift_id: mine, p_agree: true }),
      'ALREADY_COVERING',
    )
    expect(error.message).toMatch(/^You're covering another shift on /)
    expect(await shift(mine)).toMatchObject({ status: 'covered', coverer_id: tim.id, cancel_requested_by: tim.id })

    // Pia and Cal undo their trade first; then Pia can agree.
    await t.rpc(pia.id, 'request_trade_cancel', { p_shift_id: cals, p_reason: null })
    await t.rpc(cal.id, 'respond_trade_cancel', { p_shift_id: cals, p_agree: true })
    await t.rpc(pia.id, 'respond_trade_cancel', { p_shift_id: mine, p_agree: true })
    expect((await shift(mine)).status).toBe('open')
  })

  it('the member who would be double-booked is refused when they ask', async () => {
    const { pia, tim, mine } = await pickedUpSameDay()
    const error = await expectRpcError(
      t.rpc(pia.id, 'request_trade_cancel', { p_shift_id: mine, p_reason: null }),
      'ALREADY_COVERING',
    )
    expect(error.message).toMatch(/^You're covering another shift on /)
    expect((await shift(mine)).cancel_requested_by).toBeNull()
    expect(await t.notificationsFor(tim.id, 'cancel_requested')).toEqual([])
  })

  it('checks the requester\'s SwapMatch return date too', async () => {
    const day = DAY()
    const rd = SWAP_DAY()
    const sam = await member({ tour: 1, fullName: 'Sam Swapper' })
    const rae = await member({ tour: 2, fullName: 'Rae Returner' })
    const yan = await member({ tour: 2, fullName: 'Yan Colleague' })
    const mine = await post(sam, { p_date: day, p_return_dates: [rd] })
    await confirm(sam, await request(rae, mine, rd))
    const yans = await post(yan, { p_date: rd })
    await confirm(yan, await request(rae, yans))

    // Rae would get her rd shift back while covering Yan's: she can't ask …
    await expectRpcError(t.rpc(rae.id, 'request_trade_cancel', { p_shift_id: mine, p_reason: null }), 'ALREADY_COVERING')
    // … and Sam can ask, but Rae can't agree.
    await t.rpc(sam.id, 'request_trade_cancel', { p_shift_id: mine, p_reason: null })
    const error = await expectRpcError(
      t.rpc(rae.id, 'respond_trade_cancel', { p_shift_id: mine, p_agree: true }),
      'ALREADY_COVERING',
    )
    expect(error.message).toMatch(/^You're covering another shift on /)
    expect((await shift(mine)).status).toBe('covered')
  })

  it('admin void is refused too, naming who is double-booked; voiding the other trade first works', async () => {
    const { mine, cals } = await pickedUpSameDay()
    const error = await expectRpcError(
      t.rpc(admin.id, 'admin_void_trade', { p_shift_id: mine, p_reason: null }),
      'ALREADY_COVERING',
    )
    expect(error.message).toMatch(/^Pia Poster is covering another shift on /)
    expect((await shift(mine)).status).toBe('covered')

    await t.rpc(admin.id, 'admin_void_trade', { p_shift_id: cals, p_reason: null })
    await t.rpc(admin.id, 'admin_void_trade', { p_shift_id: mine, p_reason: null })
    expect((await shift(mine)).status).toBe('open')
  })
})
