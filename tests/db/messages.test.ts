// Chat, notifications housekeeping, trade-partner contact details and the
// member card (ARCHITECTURE §6.2, §6.3 "Messages & notifications").

import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  createTestDb,
  expectRpcError,
  tourDay,
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

const member = (opts: MemberOptions = {}) => t.createMember(opts)

function post(poster: Member, over: Record<string, unknown> = {}) {
  return t.rpc<string>(poster.id, 'post_shift', {
    p_date: tourDay(1, 3),
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

function send(from: Member, shiftId: string, to: Member | string, body: string) {
  return t.rpc<string>(from.id, 'send_message', {
    p_shift_id: shiftId,
    p_recipient_id: typeof to === 'string' ? to : to.id,
    p_body: body,
  })
}

/** Poster (tour 1) with an open post and one pending requester (tour 2). */
async function thread() {
  const poster = await member({ tour: 1, fullName: 'Poppy Poster' })
  const requester = await member({ tour: 2, fullName: 'Rae Requester' })
  const id = await post(poster)
  const reqId = await request(requester, id)
  return { poster, requester, id, reqId }
}

async function unreadMessageNotes(userId: string, shiftId: string): Promise<Row[]> {
  return t.query(
    `select * from public.notifications where user_id = $1 and shift_id = $2 and type = 'message' and read_at is null`,
    [userId, shiftId],
  )
}

// ---------------------------------------------------------------------------
describe('send_message', () => {
  it('lets the poster and a requester talk, and notifies the recipient', async () => {
    const { poster, requester, id } = await thread()
    const m1 = await send(poster, id, requester, '  Still need it?  ')
    const m2 = await send(requester, id, poster, 'Yes please')
    const rows = await t.query(`select id, sender_id, recipient_id, body from public.messages where shift_id = $1 order by created_at, id`, [id])
    expect(rows).toEqual(
      expect.arrayContaining([
        { id: m1, sender_id: poster.id, recipient_id: requester.id, body: 'Still need it?' },
        { id: m2, sender_id: requester.id, recipient_id: poster.id, body: 'Yes please' },
      ]),
    )
    const [n] = await unreadMessageNotes(requester.id, id)
    expect(n).toMatchObject({ title: 'Message from Poppy Poster', body: 'Still need it?', url: `/trades/${id}`, actor_id: poster.id })
  })

  it('lets the poster and the coverer talk after the trade', async () => {
    const { poster, requester, id, reqId } = await thread()
    await t.rpc(poster.id, 'confirm_request', { p_request_id: reqId })
    expect(await send(requester, id, poster, 'See you Tuesday')).toBeTruthy()
    // a requester whose request was declined can still reach the poster about it
    const late = await member({ tour: 2 })
    await t.query(
      `insert into public.shift_requests (shift_id, requester_id, requester_name, requester_rank, requester_station, status)
       values ($1, $2, 'Late', 'Firefighter', 19, 'declined')`,
      [id, late.id],
    )
    expect(await send(late, id, poster, 'No worries')).toBeTruthy()
  })

  it('refuses anyone outside the {poster, requester/coverer} pair (NOT_PARTICIPANT)', async () => {
    const { poster, requester, id } = await thread()
    const other = await member({ tour: 2 })
    const secondRequester = await member({ tour: 2 })
    await request(secondRequester, id)
    await expectRpcError(send(other, id, poster, 'hi'), 'NOT_PARTICIPANT')
    await expectRpcError(send(poster, id, other, 'hi'), 'NOT_PARTICIPANT')
    await expectRpcError(send(requester, id, secondRequester, 'hi'), 'NOT_PARTICIPANT')
    await expectRpcError(send(poster, id, poster, 'hi'), 'NOT_PARTICIPANT')
  })

  it('validates the body and the shift', async () => {
    const { poster, requester, id } = await thread()
    await expectRpcError(send(poster, id, requester, '   '), 'INVALID_INPUT')
    await expectRpcError(send(poster, id, requester, 'x'.repeat(1001)), 'INVALID_INPUT')
    expect(await send(poster, id, requester, 'x'.repeat(1000))).toBeTruthy()
    await expectRpcError(send(poster, randomUUID(), requester, 'hi'), 'NOT_FOUND')
  })

  it('requires an approved member', async () => {
    const { requester, id, poster } = await thread()
    await t.query(`update public.profiles set status = 'suspended' where id = $1`, [requester.id])
    await expectRpcError(send(requester, id, poster, 'hi'), 'NOT_APPROVED')
  })
})

// ---------------------------------------------------------------------------
describe('message notifications coalesce', () => {
  it('keeps one unread notification per (recipient, shift, sender) with the latest text', async () => {
    const { poster, requester, id } = await thread()
    await send(poster, id, requester, 'first')
    await send(poster, id, requester, 'second')
    await send(poster, id, requester, 'x'.repeat(200))
    const notes = await unreadMessageNotes(requester.id, id)
    expect(notes).toHaveLength(1)
    expect(notes[0].body).toBe('x'.repeat(139) + '…')

    // a different sender on the same shift gets its own notification
    const second = await member({ tour: 2 })
    await request(second, id)
    await send(second, id, poster, 'me too')
    await send(requester, id, poster, 'me first')
    expect(await unreadMessageNotes(poster.id, id)).toHaveLength(2)
  })

  it('re-queues the coalesced notification for push', async () => {
    const { poster, requester, id } = await thread()
    await send(poster, id, requester, 'one')
    await t.query(`update public.notifications set pushed_at = now() where user_id = $1 and type = 'message'`, [requester.id])
    await send(poster, id, requester, 'two')
    const [n] = await unreadMessageNotes(requester.id, id)
    expect(n.pushed_at).toBeNull()
    expect(n.body).toBe('two')
  })

  it('starts a new notification after the thread was read', async () => {
    const { poster, requester, id } = await thread()
    await send(poster, id, requester, 'one')
    await t.rpc(requester.id, 'mark_thread_read', { p_shift_id: id, p_other_id: poster.id })
    expect(await unreadMessageNotes(requester.id, id)).toHaveLength(0)
    await send(poster, id, requester, 'two')
    const all = await t.query(`select * from public.notifications where user_id = $1 and shift_id = $2 and type = 'message'`, [
      requester.id,
      id,
    ])
    expect(all).toHaveLength(2)
    expect(await unreadMessageNotes(requester.id, id)).toHaveLength(1)
  })
})

// ---------------------------------------------------------------------------
describe('mark_thread_read', () => {
  it('marks only the other member\'s messages to me', async () => {
    const { poster, requester, id } = await thread()
    await send(poster, id, requester, 'to requester')
    await send(requester, id, poster, 'to poster')
    await t.rpc(requester.id, 'mark_thread_read', { p_shift_id: id, p_other_id: poster.id })
    const rows = await t.query<{ body: string; read: boolean }>(
      `select body, read_at is not null as read from public.messages where shift_id = $1 order by body`,
      [id],
    )
    expect(rows).toEqual([
      { body: 'to poster', read: false },
      { body: 'to requester', read: true },
    ])
    // the poster's unread notification is untouched
    expect(await unreadMessageNotes(poster.id, id)).toHaveLength(1)
  })
})

// ---------------------------------------------------------------------------
describe('mark_notifications_read', () => {
  async function note(userId: string): Promise<string> {
    const row = await t.one<{ id: string }>(
      `insert into public.notifications (user_id, type, title, body) values ($1, 'account_status', 't', 'b') returning id`,
      [userId],
    )
    return row.id
  }

  it('marks the given ids of mine, or all of mine when null', async () => {
    const a = await member()
    const b = await member()
    const [a1, a2, a3] = [await note(a.id), await note(a.id), await note(a.id)]
    const b1 = await note(b.id)
    await t.rpc(a.id, 'mark_notifications_read', { p_ids: [a1, b1] })
    const read = async (id: string) =>
      (await t.one<{ r: boolean }>(`select read_at is not null as r from public.notifications where id = $1`, [id])).r
    expect([await read(a1), await read(a2), await read(a3), await read(b1)]).toEqual([true, false, false, false])
    await t.rpc(a.id, 'mark_notifications_read', { p_ids: null })
    expect([await read(a2), await read(a3), await read(b1)]).toEqual([true, true, false])
  })

  it('works for members who are not approved yet', async () => {
    const p = await member({ status: 'pending' })
    const id = await note(p.id)
    await t.rpc(p.id, 'mark_notifications_read', { p_ids: null })
    expect((await t.one(`select read_at from public.notifications where id = $1`, [id])).read_at).not.toBeNull()
  })
})

// ---------------------------------------------------------------------------
describe('get_trade_contact', () => {
  type Contact = { user_id: string; full_name: string; rank: string; station: number; phone: string; email: string }
  const contacts = (m: Member, shiftId: string) => t.rpc<Contact[]>(m.id, 'get_trade_contact', { p_shift_id: shiftId })

  it('gives the poster every pending/accepted requester, and each requester the poster', async () => {
    const poster = await member({ tour: 1, fullName: 'Cora Poster', phone: '415-555-0001' })
    const r1 = await member({ tour: 2, fullName: 'Ada One', phone: '415-555-0002' })
    const r2 = await member({ tour: 2, fullName: 'Bea Two' })
    const withdrawn = await member({ tour: 2, fullName: 'Zed Withdrawn' })
    const id = await post(poster)
    await request(r1, id)
    await request(r2, id)
    const w = await request(withdrawn, id)
    await t.rpc(withdrawn.id, 'withdraw_request', { p_request_id: w })

    const forPoster = await contacts(poster, id)
    expect(forPoster.map((c) => c.full_name)).toEqual(['Ada One', 'Bea Two'])
    expect(forPoster[0]).toEqual({
      user_id: r1.id,
      full_name: 'Ada One',
      rank: 'Firefighter',
      station: 19,
      phone: '415-555-0002',
      email: r1.email,
    })
    const forR1 = await contacts(r1, id)
    expect(forR1).toEqual([
      { user_id: poster.id, full_name: 'Cora Poster', rank: 'Firefighter', station: 19, phone: '415-555-0001', email: poster.email },
    ])
    // a withdrawn requester no longer gets the poster's details
    expect(await contacts(withdrawn, id)).toEqual([])
  })

  it('after the trade: poster ↔ coverer only; declined requesters lose access', async () => {
    const poster = await member({ tour: 1 })
    const coverer = await member({ tour: 2 })
    const loser = await member({ tour: 2 })
    const id = await post(poster)
    const req = await request(coverer, id)
    await request(loser, id)
    await t.rpc(poster.id, 'confirm_request', { p_request_id: req })
    expect((await contacts(poster, id)).map((c) => c.user_id)).toEqual([coverer.id])
    expect((await contacts(coverer, id)).map((c) => c.user_id)).toEqual([poster.id])
    expect(await contacts(loser, id)).toEqual([])
  })

  it('works on a SwapMatch return leg', async () => {
    const poster = await member({ tour: 1 })
    const taker = await member({ tour: 2 })
    const rd = tourDay(2, 3)
    const id = await post(poster, { p_return_dates: [rd] })
    const req = await request(taker, id, rd)
    const { return_leg_id: leg } = await t.rpc<{ return_leg_id: string }>(poster.id, 'confirm_request', { p_request_id: req })
    expect((await contacts(poster, leg)).map((c) => c.user_id)).toEqual([taker.id])
    expect((await contacts(taker, leg)).map((c) => c.user_id)).toEqual([poster.id])
  })

  it('returns nothing to anyone else, and NOT_FOUND for unknown shifts', async () => {
    const { id } = await thread()
    const stranger = await member({ tour: 2 })
    expect(await contacts(stranger, id)).toEqual([])
    await expectRpcError(contacts(stranger, randomUUID()), 'NOT_FOUND')
  })

  it('requires an approved member', async () => {
    const { id } = await thread()
    await expectRpcError(contacts(await member({ status: 'pending' }), id), 'NOT_APPROVED')
  })
})

// ---------------------------------------------------------------------------
describe('member_card', () => {
  it('shows an approved member\'s summary without contact details', async () => {
    const viewer = await member()
    const target = await member({ fullName: 'Card Holder', station: 4, rank: 'Lieutenant' })
    const card = await t.rpc<Row>(viewer.id, 'member_card', { p_user_id: target.id })
    expect(card).toEqual({
      full_name: 'Card Holder',
      rank: 'Lieutenant',
      station: 4,
      battalion: 3,
      trust_score: 100,
      covered: 0,
      given: 0,
    })
  })

  it('NOT_FOUND for members who are not approved or do not exist', async () => {
    const viewer = await member()
    await expectRpcError(t.rpc(viewer.id, 'member_card', { p_user_id: (await member({ status: 'pending' })).id }), 'NOT_FOUND')
    await expectRpcError(t.rpc(viewer.id, 'member_card', { p_user_id: randomUUID() }), 'NOT_FOUND')
  })

  it('requires an approved viewer', async () => {
    const target = await member()
    await expectRpcError(t.rpc((await member({ status: 'pending' })).id, 'member_card', { p_user_id: target.id }), 'NOT_APPROVED')
  })
})
