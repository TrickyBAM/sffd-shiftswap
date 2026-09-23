// Fixes from the v1 multi-lens review, all in 0011_v1_review_fixes.sql:
//   TF-1    giving away only the PM keeps the day a work day (0800–1600)
//   TF-3    SwapMatch alerts only go to members who could give a return date
//   TF-5    a cancel request can always be closed, even after a leg started
//   TF-8    my_ledger counts a SwapMatch as one upcoming trade
//   NEXT-09 member_cards: many member cards in one call
//   CC-4    admin_remove_member: account removal on request
//   SEC-6   accounts can only be created by the app (confirmed at commit)

import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  createTestDb,
  daysFromToday,
  expectDenied,
  expectRpcError,
  tourDay,
  tourWorks,
  unique,
  type Member,
  type MemberOptions,
  type Row,
  type TestDb,
} from './harness'

let t: TestDb
let admin: Member

beforeAll(async () => {
  t = await createTestDb()
  admin = await t.createMember({ role: 'admin', tour: null, fullName: 'Ada Admin' })
})

afterAll(async () => {
  await t?.close()
})

const member = (opts: MemberOptions = {}) => t.createMember(opts)

function post(poster: Member, date: string, over: Record<string, unknown> = {}) {
  return t.rpc<string>(poster.id, 'post_shift', {
    p_date: date,
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

/** poster posts `date`, taker requests it, poster confirms; returns the shift id. */
async function trade(
  poster: Member,
  date: string,
  taker: Member,
  over: Record<string, unknown> = {},
  returnDate: string | null = null,
): Promise<{ id: string; legId: string | null }> {
  const id = await post(poster, date, over)
  const result = await confirm(poster, await request(taker, id, returnDate))
  return { id, legId: result.return_leg_id }
}

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
  pm_given_away: boolean
}

async function dayOf(m: Member, date: string): Promise<Day> {
  const [d] = await t.rpc<Day[]>(m.id, 'my_schedule', { p_from: date, p_to: date })
  return d
}

interface Eligibility {
  eligible: boolean
  reasons: Array<{ code: string; message: string }>
  valid_return_dates: string[]
}

function eligibility(m: Member, shiftId: string) {
  return t.rpc<Eligibility>(m.id, 'shift_eligibility', { p_shift_id: shiftId, p_return_date: null })
}

function newShiftAlerts(memberId: string, shiftId: string): Promise<Row[]> {
  return t.query(`select * from public.notifications where user_id = $1 and shift_id = $2 and type = 'new_shift'`, [
    memberId,
    shiftId,
  ])
}

async function tokenOf(m: Member): Promise<string> {
  const row = await t.one<{ calendar_token: string }>(`select calendar_token from public.profiles where id = $1`, [m.id])
  return row.calendar_token
}

type FeedEvent = { date: string; kind: string; title: string; details: string }
const feed = (token: string) => t.rpc<FeedEvent[]>(null, 'calendar_feed', { p_token: token })

function letters(n = 8): string {
  let out = ''
  for (let i = 0; i < n; i++) out += String.fromCharCode(97 + Math.floor(Math.random() * 26))
  return out
}

// Tour 1 and tour 2 never work the same day (tour 2 = tour 1 shifted a day).

// ---------------------------------------------------------------------------
describe('TF-1: giving away only the PM keeps the day a work day', () => {
  it('my_schedule: still working, with pm_given_away; a 24-Hour give-away still frees the day', async () => {
    const ff = await member({ tour: 1, fullName: 'Pam Pmgiver' })
    const mike = await member({ tour: 2, fullName: 'Mike Lee' })
    const pmDay = tourDay(1, 5)
    const fullDay = tourDay(1, 5, 1)
    const pm = await trade(ff, pmDay, mike, { p_shift_type: 'PM' })
    const full = await trade(ff, fullDay, mike)

    expect(await dayOf(ff, pmDay)).toMatchObject({
      base: true,
      given_away: true,
      pm_given_away: true,
      working: true,
      picked_up: false,
      given_shift_id: pm.id,
    })
    expect(await dayOf(ff, fullDay)).toMatchObject({
      base: true,
      given_away: true,
      pm_given_away: false,
      working: false,
      given_shift_id: full.id,
    })
    // Mike covers both and works both.
    expect(await dayOf(mike, pmDay)).toMatchObject({ picked_up: true, working: true, pm_given_away: false })

    const helpers = await t.one<Record<string, boolean>>(
      `select public.effective_works($1, $2::date) as pm_works, public.gave_away($1, $2::date) as pm_frees,
              public.effective_works($1, $3::date) as full_works, public.gave_away($1, $3::date) as full_frees`,
      [ff.id, pmDay, fullDay],
    )
    expect(helpers).toEqual({ pm_works: true, pm_frees: false, full_works: false, full_frees: true })
  })

  it('a member who gave away only the PM cannot take another shift that day (YOU_WORK_THAT_DAY)', async () => {
    const day = tourDay(1, 8)
    const ff = await member({ tour: 1, fullName: 'Paul Pmonly' })
    await trade(ff, day, await member({ tour: 2 }), { p_shift_type: 'PM' })

    const other24 = await post(await member({ tour: 1 }), day)
    const otherPm = await post(await member({ tour: 1 }), day, { p_shift_type: 'PM' })
    for (const shiftId of [other24, otherPm]) {
      const e = await eligibility(ff, shiftId)
      expect(e.eligible).toBe(false)
      expect(e.reasons.map((r) => r.code)).toContain('YOU_WORK_THAT_DAY')
      await expectRpcError(request(ff, shiftId), 'YOU_WORK_THAT_DAY')
    }

    // Whereas a member who gave the whole day away is free to.
    const offAllDay = await member({ tour: 1 })
    await trade(offAllDay, day, await member({ tour: 2 }))
    expect(await eligibility(offAllDay, other24)).toMatchObject({ eligible: true, reasons: [] })
  })

  it('confirm_request re-checks it: a no-tour member who gave a PM away that day since asking is refused', async () => {
    const day = tourDay(1, 11)
    const poster = await member({ tour: 1 })
    const relief = await member({ tour: null, fullName: 'Rex Relief' })
    const theirs = await post(poster, day)
    const req = await request(relief, theirs) // free that day when asking …
    await trade(relief, day, await member({ tour: 2 }), { p_shift_type: 'PM' }) // … then trades away a PM that day

    expect(await dayOf(relief, day)).toMatchObject({ base: false, pm_given_away: true, working: true })
    const error = await expectRpcError(confirm(poster, req), 'YOU_WORK_THAT_DAY')
    expect(error.message).toContain('Rex Relief')
    expect(await dayOf(relief, day)).toMatchObject({ picked_up: false })
  })

  it('new-shift alerts skip a member who gave away only the PM that day', async () => {
    const day = tourDay(1, 45)
    const pmGiver = await member({ tour: 1, notifyScope: 'all' })
    const dayGiver = await member({ tour: 1, notifyScope: 'all' })
    await trade(pmGiver, day, await member({ tour: 2 }), { p_shift_type: 'PM' })
    await trade(dayGiver, day, await member({ tour: 2 }))

    const id = await post(await member({ tour: 1 }), day)
    expect(await newShiftAlerts(pmGiver.id, id)).toHaveLength(0)
    expect(await newShiftAlerts(dayGiver.id, id)).toHaveLength(1)
  })

  it('a day whose PM was given away is not a free return date for either side', async () => {
    const ff = await member({ tour: 1 })
    const pmDay = tourDay(1, 14)
    await trade(ff, pmDay, await member({ tour: 2 }), { p_shift_type: 'PM' })

    // As a SwapMatch requester: not their shift to give any more.
    const swapPoster = await member({ tour: 2 })
    const offer = await post(swapPoster, tourDay(2, 14), { p_return_dates: [pmDay] })
    await expectRpcError(request(ff, offer, pmDay), 'RETURN_NOT_YOUR_DAY')
    // As a poster: they work that day, so they can't be covering someone then.
    await expectRpcError(post(ff, tourDay(1, 14, 1), { p_return_dates: [pmDay] }), 'POSTER_WORKS_RETURN_DAY')
  })

  it('calendar_feed keeps a PM give-away day as on duty 0800–1600 and names who covers the PM', async () => {
    const me = await member({ tour: 1, fullName: 'Cal Pm' })
    const mike = await member({ tour: 2, fullName: 'Mike Lee' })
    const pmDay = tourDay(1, 10)
    const fullDay = tourDay(1, 10, 1)
    await t.createShift({ poster: me, date: pmDay, coverer: mike, shiftType: 'PM' })
    await t.createShift({ poster: me, date: fullDay, coverer: mike })

    const events = await feed(await tokenOf(me))
    const onDay = (d: string) => events.filter((e) => e.date === d)
    expect(onDay(pmDay)).toEqual([expect.objectContaining({ kind: 'work', title: 'On duty 0800–1600 (Tour 1)' })])
    expect(onDay(pmDay)[0].details).toContain('Mike Lee covers your PM (1600–0800)')
    expect(onDay(fullDay)).toEqual([
      expect.objectContaining({ kind: 'covered_for_me', title: 'Off: Mike Lee covering you (24-Hour)' }),
    ])

    // A member with no tour who gives a PM away also works that morning.
    const relief = await member({ tour: null })
    const day = daysFromToday(20)
    await t.createShift({ poster: relief, date: day, coverer: await member({ tour: null, fullName: 'Nia Night' }), shiftType: 'PM' })
    expect(await feed(await tokenOf(relief))).toEqual([
      expect.objectContaining({ date: day, kind: 'work', title: 'On duty 0800–1600' }),
    ])
    expect((await feed(await tokenOf(relief)))[0].details).toContain('Nia Night covers your PM')
  })
})

// ---------------------------------------------------------------------------
describe('TF-3: SwapMatch alerts only reach members who could give a return date', () => {
  it('alerts exactly the members request_shift would accept a return date from', async () => {
    const day = tourDay(1, 60) // the poster's tour day
    const rd = tourDay(2, 60) // the only return date offered: a tour-2 day
    const neither = Array.from({ length: 31 }, (_, i) => i + 1).find((n) => !tourWorks(n, day) && !tourWorks(n, rd))!
    expect(neither).toBeDefined()

    const poster = await member({ tour: 1, fullName: 'Swap Poster' })
    const canGive = await member({ tour: 2, notifyScope: 'all' })
    const notTheirDay = await member({ tour: neither, notifyScope: 'all' })
    const noTour = await member({ tour: null, notifyScope: 'all' })
    const noTourPostedRd = await member({ tour: null, notifyScope: 'all' })
    const alreadyPostedRd = await member({ tour: 2, notifyScope: 'all' })
    const coveringRd = await member({ tour: null, notifyScope: 'all' })
    await t.createShift({ poster: noTourPostedRd, date: rd })
    await t.createShift({ poster: alreadyPostedRd, date: rd })
    await t.createShift({ poster: await member({ tour: 2 }), date: rd, coverer: coveringRd })

    const id = await post(poster, day, { p_return_dates: [rd] })
    const expected: Array<[string, Member, number]> = [
      ['canGive', canGive, 1],
      ['noTour', noTour, 1],
      ['notTheirDay', notTheirDay, 0],
      ['noTourPostedRd', noTourPostedRd, 0],
      ['alreadyPostedRd', alreadyPostedRd, 0],
      ['coveringRd', coveringRd, 0],
    ]
    for (const [name, m, n] of expected) {
      expect(await newShiftAlerts(m.id, id), name).toHaveLength(n)
      // … and the alert agrees with what the member would be told on the board
      expect((await eligibility(m, id)).eligible, name).toBe(n === 1)
    }
    expect((await eligibility(notTheirDay, id)).reasons.map((r) => r.code)).toEqual(['RETURN_NOT_YOUR_DAY'])
    expect((await eligibility(canGive, id)).valid_return_dates).toEqual([rd])

    // A plain post (no return dates) still alerts the member who can't give rd.
    const plain = await post(await member({ tour: 1 }), day)
    expect(await newShiftAlerts(notTheirDay.id, plain)).toHaveLength(1)
  })

  it('counts a post as alert-worthy when at least one of several return dates works', async () => {
    const day = tourDay(1, 70)
    const rd2 = tourDay(2, 70)
    const rd3 = tourDay(3, 70)
    const poster = await member({ tour: 1 })
    const tour3 = await member({ tour: 3, notifyScope: 'all' })
    const id = await post(poster, day, { p_return_dates: [rd2, rd3] })
    expect(tourWorks(3, rd2)).toBe(false)
    expect(await newShiftAlerts(tour3.id, id)).toHaveLength(1)
  })
})

// ---------------------------------------------------------------------------
describe('TF-5: a cancel request can always be closed, even after a leg started', () => {
  async function startedSwapWithCancelRequest() {
    const poster = await member({ tour: 1, fullName: 'Early Poster' })
    const taker = await member({ tour: 2, fullName: 'Early Taker' })
    // original later, return leg sooner
    const { id, legId } = await trade(poster, tourDay(1, 40), taker, { p_return_dates: [tourDay(2, 3)] }, tourDay(2, 3))
    await t.rpc(taker.id, 'request_trade_cancel', { p_shift_id: id, p_reason: 'Changed plans' })
    // time passes: the return leg starts before anyone answers
    await t.query(`update public.shifts set starts_at = now() - interval '1 hour' where id = $1`, [legId])
    return { poster, taker, id, legId: legId! }
  }
  const cancelAsker = async (id: string) =>
    (await t.one<{ by: string | null }>(`select cancel_requested_by as by from public.shifts where id = $1`, [id])).by

  it('agreeing is refused (STARTED); the member who asked can still withdraw', async () => {
    const { poster, taker, id } = await startedSwapWithCancelRequest()
    await expectRpcError(t.rpc(poster.id, 'respond_trade_cancel', { p_shift_id: id, p_agree: true }), 'STARTED')
    expect(await cancelAsker(id)).toBe(taker.id)

    await t.rpc(taker.id, 'withdraw_trade_cancel', { p_shift_id: id })
    expect(await cancelAsker(id)).toBeNull()
    const [n] = await t.notificationsFor(poster.id, 'cancel_requested')
    expect(n.read_at).not.toBeNull()
    expect((await t.one(`select status from public.shifts where id = $1`, [id])).status).toBe('covered')
  })

  it('the other member can still decline, from either leg', async () => {
    const { poster, taker, id, legId } = await startedSwapWithCancelRequest()
    await t.rpc(poster.id, 'respond_trade_cancel', { p_shift_id: legId, p_agree: false })
    expect(await cancelAsker(id)).toBeNull()
    expect(await t.notificationsFor(taker.id, 'cancel_declined')).toHaveLength(1)

    // and a request made by the poster can be withdrawn through the return leg
    await t.query(`update public.shifts set cancel_requested_by = $2, cancel_requested_at = now() where id = $1`, [id, poster.id])
    await t.rpc(poster.id, 'withdraw_trade_cancel', { p_shift_id: legId })
    expect(await cancelAsker(id)).toBeNull()
  })

  it('asking again after a leg started is still refused', async () => {
    const { taker, id } = await startedSwapWithCancelRequest()
    await t.rpc(taker.id, 'withdraw_trade_cancel', { p_shift_id: id })
    await expectRpcError(t.rpc(taker.id, 'request_trade_cancel', { p_shift_id: id, p_reason: null }), 'STARTED')
  })
})

// ---------------------------------------------------------------------------
describe('TF-8: my_ledger counts a SwapMatch as one upcoming trade', () => {
  it('one SwapMatch = 1 upcoming for both members; a second trade makes 2; past legs never count', async () => {
    const poster = await member({ tour: 1, fullName: 'Lana Ledger' })
    const taker = await member({ tour: 2, fullName: 'Tod Taker' })
    const rd = tourDay(2, 25)
    await trade(poster, tourDay(1, 25), taker, { p_return_dates: [rd] }, rd)

    const upcoming = async (m: Member) => (await t.rpc<Row[]>(m.id, 'my_ledger'))[0].upcoming
    expect(await upcoming(poster)).toBe(1)
    expect(await upcoming(taker)).toBe(1)

    await trade(poster, tourDay(1, 25, 1), taker)
    expect(await upcoming(poster)).toBe(2)
    expect(await upcoming(taker)).toBe(2)

    await t.createShift({ poster: taker, date: daysFromToday(-3), coverer: poster })
    const [row] = await t.rpc<Row[]>(poster.id, 'my_ledger')
    expect(row).toMatchObject({ upcoming: 2, i_covered_24: 2, they_covered_24: 2 })
  })
})

// ---------------------------------------------------------------------------
describe('NEXT-09: member_cards', () => {
  it('returns member_card objects plus user_id, in the order asked, approved members only, each once', async () => {
    const viewer = await member()
    const a = await member({ fullName: 'Card Alpha', station: 4, rank: 'Lieutenant' })
    const b = await member({ fullName: 'Card Beta' })
    await t.createShift({ poster: await member({ tour: null }), date: daysFromToday(-5), coverer: b })
    const pending = await member({ status: 'pending' })
    const suspended = await member({ status: 'suspended' })

    const cards = await t.rpc<Row[]>(viewer.id, 'member_cards', {
      p_user_ids: [b.id, a.id, pending.id, suspended.id, randomUUID(), b.id],
    })
    expect(cards.map((c) => c.user_id)).toEqual([b.id, a.id])
    for (const [card, m] of [
      [cards[0], b],
      [cards[1], a],
    ] as const) {
      const single = await t.rpc<Row>(viewer.id, 'member_card', { p_user_id: m.id })
      expect(card).toEqual({ user_id: m.id, ...single })
    }
    expect(cards[0]).toMatchObject({ full_name: 'Card Beta', covered: 1 })
    expect(cards[1]).not.toHaveProperty('phone')
    expect(cards[1]).not.toHaveProperty('email')
  })

  it('answers [] for no ids, allows 50 and refuses more (INVALID_INPUT)', async () => {
    const viewer = await member()
    expect(await t.rpc(viewer.id, 'member_cards', { p_user_ids: [] })).toEqual([])
    expect(await t.rpc(viewer.id, 'member_cards', { p_user_ids: null })).toEqual([])
    const fifty = Array.from({ length: 50 }, () => randomUUID())
    expect(await t.rpc(viewer.id, 'member_cards', { p_user_ids: [...fifty, fifty[0]] })).toEqual([])
    await expectRpcError(t.rpc(viewer.id, 'member_cards', { p_user_ids: [...fifty, randomUUID()] }), 'INVALID_INPUT')
  })

  it('is for approved members only', async () => {
    const target = await member()
    await expectRpcError(
      t.rpc((await member({ status: 'pending' })).id, 'member_cards', { p_user_ids: [target.id] }),
      'NOT_APPROVED',
    )
    await expectDenied(t.rpc(null, 'member_cards', { p_user_ids: [target.id] }))
  })
})

// ---------------------------------------------------------------------------
describe('CC-4: admin_remove_member', () => {
  const profile = (id: string) => t.one(`select * from public.profiles where id = $1`, [id])
  const remove = (who: Member, target: string, reason: string | null = null) =>
    t.rpc<Row>(who.id, 'admin_remove_member', { p_user_id: target, p_reason: reason })

  it('closes the account, deletes personal details and takes the member off the board; trade history stays', async () => {
    const m = await member({ tour: 1, fullName: 'Rita Removed', phone: '(415) 555-0199', employeeId: 'E123', notifyScope: 'all' })
    // roster link
    const last = `Removed${letters()}`
    const roster = await t.one<{ id: string }>(
      `insert into public.roster (first_name, last_name, first_key, last_key, claimed_by)
       values ('Rita', $1, 'rita', public.name_key($1), $2) returning id`,
      [last, m.id],
    )
    await t.query(`update public.profiles set roster_id = $1 where id = $2`, [roster.id, m.id])
    // a push subscription and a notification of their own
    await t.query(`insert into public.push_subscriptions (user_id, endpoint, p256dh, auth) values ($1, $2, 'k', 'a')`, [
      m.id,
      `https://fcm.googleapis.com/fcm/send/${unique()}`,
    ])
    await t.query(`insert into public.notifications (user_id, type, title, body) values ($1, 'account_status', 't', 'b')`, [m.id])
    // the admins' "waiting for approval" notice carries their phone and email
    await t.query(
      `insert into public.notifications (user_id, type, title, body, actor_id)
       values ($1, 'member_pending', 'Member waiting for approval', 'Rita Removed · (415) 555-0199 · rita@example.test', $2)`,
      [admin.id, m.id],
    )
    // an earlier admin edit kept the phone and employee ID in the audit log
    await t.rpc(admin.id, 'admin_update_member', {
      p_user_id: m.id,
      p_full_name: 'Rita Removed',
      p_rank: 'Firefighter',
      p_station: 19,
      p_tour: 1,
      p_phone: '(415) 555-0199',
      p_employee_id: 'E123',
    })
    // an upcoming open post with a pending request …
    const requester = await member({ tour: 2 })
    const openPost = await post(m, tourDay(1, 20))
    const onOpen = await request(requester, openPost)
    // … their own pending request on someone else's post …
    const otherPoster = await member({ tour: 2 })
    const theirs = await post(otherPoster, tourDay(2, 20))
    const mine = await request(m, theirs)
    // … and a confirmed upcoming trade
    const taker = await member({ tour: 2, fullName: 'Tia Taker' })
    const { id: tradeId } = await trade(m, tourDay(1, 20, 1), taker)
    const oldToken = await tokenOf(m)
    expect((await feed(oldToken)).length).toBeGreaterThan(0)

    const result = await remove(admin, m.id, '  Left the department ')
    expect(result).toEqual({ posts_cancelled: 1, requests_closed: 1, upcoming_trades: 1 })

    const p = await profile(m.id)
    expect(p).toMatchObject({
      status: 'suspended',
      status_reason: 'Account removed: Left the department',
      full_name: 'Rita Removed',
      phone: null,
      employee_id: null,
      roster_id: null,
      notify_scope: 'off',
      role: 'member',
    })
    expect(p.removed_at).not.toBeNull()
    expect(p.calendar_token).not.toBe(oldToken)
    expect((await t.one(`select claimed_by from public.roster where id = $1`, [roster.id])).claimed_by).toBeNull()
    expect(await t.query(`select 1 from public.push_subscriptions where user_id = $1`, [m.id])).toEqual([])
    expect(await t.notificationsFor(m.id)).toEqual([])
    expect(await t.query(`select 1 from public.notifications where actor_id = $1 and type = 'member_pending'`, [m.id])).toEqual([])
    const edits = await t.query<{ details: Record<string, Record<string, unknown>> }>(
      `select details from public.audit_log where action = 'admin.member_updated' and target_id = $1`,
      [m.id],
    )
    expect(edits).toHaveLength(1)
    for (const side of ['before', 'after']) {
      expect(edits[0].details[side]).not.toHaveProperty('phone')
      expect(edits[0].details[side]).not.toHaveProperty('employee_id')
      expect(edits[0].details[side]).toMatchObject({ full_name: 'Rita Removed' })
    }

    // off the board exactly like a suspension
    const shiftRow = (id: string) => t.one(`select * from public.shifts where id = $1`, [id])
    expect(await shiftRow(openPost)).toMatchObject({ status: 'cancelled', cancelled_by: admin.id })
    expect((await shiftRow(openPost)).cancel_note).toContain('removed')
    expect((await t.one(`select status from public.shift_requests where id = $1`, [onOpen])).status).toBe('cancelled')
    expect(await t.notificationsFor(requester.id, 'post_cancelled')).toEqual([expect.objectContaining({ shift_id: openPost })])
    expect((await t.one(`select status from public.shift_requests where id = $1`, [mine])).status).toBe('cancelled')
    expect(await t.notificationsFor(otherPoster.id, 'request_withdrawn')).toEqual([expect.objectContaining({ shift_id: theirs })])
    // trade history stays, with the name snapshot
    expect(await shiftRow(tradeId)).toMatchObject({ status: 'covered', poster_name: 'Rita Removed', coverer_id: taker.id })

    const [entry] = await t.query<{ actor_id: string; details: Row }>(
      `select actor_id, details from public.audit_log where action = 'member.removed' and target_id = $1`,
      [m.id],
    )
    expect(entry).toMatchObject({
      actor_id: admin.id,
      details: { from_status: 'approved', reason: 'Left the department', posts_cancelled: 1, requests_closed: 1, upcoming_trades: 1 },
    })

    // the account can't be used and its calendar link is dead
    const error = await expectRpcError(t.rpc(m.id, 'my_stats'), 'NOT_APPROVED')
    expect(error.message).toContain('removed')
    expect(await feed(oldToken)).toEqual([])
    expect(await feed(await tokenOf(m))).toEqual([])
  })

  it('admins can list removed members; other members can\'t see them', async () => {
    const m = await member({ fullName: 'Listed Removed' })
    await remove(admin, m.id)
    const seen = await t.asUser(admin.id, (q) =>
      q<{ id: string }>(`select id from public.profiles where removed_at is not null`),
    )
    expect(seen.map((r) => r.id)).toContain(m.id)
    const other = await member()
    expect(await t.asUser(other.id, (q) => q(`select id from public.profiles where id = $1`, [m.id]))).toEqual([])

    const o = await t.rpc<Record<string, number>>(admin.id, 'admin_overview')
    const counts = await t.one<Record<string, number>>(
      `select (select count(*)::int from public.profiles where removed_at is not null) as removed_members,
              (select count(*)::int from public.profiles where status = 'suspended' and removed_at is null) as suspended_members`,
    )
    expect(o).toMatchObject(counts)
    expect(o.removed_members).toBeGreaterThan(0)
  })

  it('works for any account status, and removes another admin\'s admin rights', async () => {
    for (const status of ['onboarding', 'pending', 'rejected', 'suspended'] as const) {
      const m = await member({ status })
      await remove(admin, m.id)
      expect(await profile(m.id)).toMatchObject({ status: 'suspended', status_reason: 'Account removed' })
    }
    const otherAdmin = await member({ role: 'admin' })
    await remove(admin, otherAdmin.id)
    expect(await profile(otherAdmin.id)).toMatchObject({ role: 'member', status: 'suspended' })
    await expectRpcError(t.rpc(otherAdmin.id, 'admin_overview'), 'NOT_APPROVED')
    expect(await t.rpc(admin.id, 'admin_overview')).toBeTruthy()
  })

  it('is admin-only and refuses yourself, unknown ids, long reasons and a second removal', async () => {
    const m = await member()
    await expectRpcError(remove(await member(), m.id), 'NOT_ADMIN')
    await expectRpcError(remove(admin, admin.id), 'INVALID_INPUT')
    await expectRpcError(remove(admin, randomUUID()), 'NOT_FOUND')
    await expectRpcError(remove(admin, m.id, 'x'.repeat(501)), 'INVALID_INPUT')
    await remove(admin, m.id)
    await expectRpcError(remove(admin, m.id), 'INVALID_INPUT')
    await expectDenied(t.rpc(null, 'admin_remove_member', { p_user_id: m.id, p_reason: null }))
  })

  it('a removed account can\'t be edited, but can be reinstated (removed_at cleared)', async () => {
    const m = await member({ fullName: 'Back Again' })
    await remove(admin, m.id)
    await expectRpcError(
      t.rpc(admin.id, 'admin_update_member', {
        p_user_id: m.id,
        p_full_name: 'Back Again',
        p_rank: 'Firefighter',
        p_station: 19,
        p_tour: 1,
        p_phone: '415 555 0100',
        p_employee_id: null,
      }),
      'INVALID_INPUT',
    )
    await t.rpc(admin.id, 'admin_set_member_status', { p_user_id: m.id, p_status: 'approved', p_reason: null })
    expect(await profile(m.id)).toMatchObject({ status: 'approved', removed_at: null, status_reason: null })
    expect(await t.rpc(m.id, 'my_stats')).toMatchObject({ posted: 0 })

    const n = await member({ fullName: 'Back Twice' })
    await remove(admin, n.id)
    await t.rpc(admin.id, 'admin_approve_member', { p_user_id: n.id, p_roster_id: null })
    expect(await profile(n.id)).toMatchObject({ status: 'approved', removed_at: null })
  })

  it('a removed account is always suspended (check constraint)', async () => {
    const m = await member()
    await expect(t.query(`update public.profiles set removed_at = now() where id = $1`, [m.id])).rejects.toThrow(
      /profiles_removed_is_suspended/,
    )
  })
})

// ---------------------------------------------------------------------------
describe('SEC-6: accounts can only be created by the app', () => {
  const profileRows = (id: string) => t.query(`select full_name, status from public.profiles where id = $1`, [id])
  const authRows = (id: string) => t.query(`select 1 from auth.users where id = $1`, [id])

  it('refuses an account that is still unconfirmed at commit (a public sign-up) and stores nothing', async () => {
    const id = randomUUID()
    const error = await t
      .query(`insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, $3)`, [
        id,
        `bot.${unique()}@example.test`,
        { full_name: 'Bot Account' },
      ])
      .then(
        () => undefined,
        (e: { code?: string; message?: string }) => e,
      )
    expect(error).toMatchObject({ code: '42501' })
    expect(error?.message).toContain('sign-up page')
    expect(await authRows(id)).toEqual([])
    expect(await profileRows(id)).toEqual([])
  })

  it('accepts the app\'s sign-up: inserted unconfirmed, confirmed later in the same transaction', async () => {
    // What admin.createUser({ email_confirm: true }) does inside Supabase Auth.
    const id = randomUUID()
    await t.db.transaction(async (tx) => {
      await tx.query(`insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, $3)`, [
        id,
        `app.${unique()}@example.test`,
        { full_name: 'App Signup' },
      ])
      await tx.query(`update auth.users set email_confirmed_at = now() where id = $1`, [id])
    })
    expect(await profileRows(id)).toEqual([{ full_name: 'App Signup', status: 'onboarding' }])
  })

  it('accepts an account inserted already confirmed (dashboard "Create new user" with Auto Confirm)', async () => {
    const id = await t.createAuthUser(`confirmed.${unique()}@example.test`, 'Already Confirmed')
    expect(await profileRows(id)).toEqual([{ full_name: 'Already Confirmed', status: 'onboarding' }])
  })

  it('refuses when the transaction ends without the confirmation (e.g. a magic-link sign-up)', async () => {
    const id = randomUUID()
    await expect(
      t.db.transaction(async (tx) => {
        await tx.query(`insert into auth.users (id, email) values ($1, $2)`, [id, `otp.${unique()}@example.test`])
        await tx.query(`update auth.users set raw_user_meta_data = '{"full_name":"Otp User"}' where id = $1`, [id])
      }),
    ).rejects.toMatchObject({ code: '42501' })
    expect(await authRows(id)).toEqual([])
    expect(await profileRows(id)).toEqual([])
  })

  it('is a deferred constraint trigger on auth.users running a pinned-search_path function', async () => {
    const row = await t.one<Row>(
      `select tg.tgdeferrable as deferrable, tg.tginitdeferred as initially_deferred, p.prosecdef as secdef,
              p.proconfig as config, n.nspname as schema
         from pg_trigger tg
         join pg_proc p on p.oid = tg.tgfoid
         join pg_namespace n on n.oid = p.pronamespace
        where tg.tgname = 'on_auth_user_created_require_confirmed' and tg.tgrelid = 'auth.users'::regclass`,
    )
    expect(row).toMatchObject({ deferrable: true, initially_deferred: true, secdef: true, schema: 'private' })
    expect(row.config).toContain('search_path=""')
  })
})
