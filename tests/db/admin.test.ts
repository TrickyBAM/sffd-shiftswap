// Admin RPCs (ARCHITECTURE §6.3 "Admin"): approvals, status and role changes
// (incl. the last-admin guard), member edits, password-reset flag, roster
// import/delete, post take-down and the overview counts. Every action is audited.

import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  createTestDb,
  daysFromToday,
  expectRpcError,
  tourDay,
  type Member,
  type MemberOptions,
  type Row,
  type TestDb,
} from './harness'

let t: TestDb
let admin: Member

beforeAll(async () => {
  t = await createTestDb()
  admin = await t.createMember({ role: 'admin', fullName: 'Ada Admin' })
})

afterAll(async () => {
  await t?.close()
})

const member = (opts: MemberOptions = {}) => t.createMember(opts)
const profile = (id: string) => t.one(`select * from public.profiles where id = $1`, [id])
const audited = (action: string, targetId: string) =>
  t.query(`select * from public.audit_log where action = $1 and target_id = $2`, [action, targetId])

function letters(n = 8): string {
  let out = ''
  for (let i = 0; i < n; i++) out += String.fromCharCode(97 + Math.floor(Math.random() * 26))
  return out
}

async function rosterRow(first = 'Roy', last = `Roster${letters()}`): Promise<string> {
  const row = await t.one<{ id: string }>(
    `insert into public.roster (first_name, last_name, first_key, last_key)
     values ($1, $2, public.name_key($1), public.name_key($2)) returning id`,
    [first, last],
  )
  return row.id
}

// ---------------------------------------------------------------------------
describe('admin guard', () => {
  const calls: Array<[string, Record<string, unknown>]> = [
    ['admin_approve_member', { p_user_id: randomUUID(), p_roster_id: null }],
    ['admin_reject_member', { p_user_id: randomUUID(), p_reason: null }],
    ['admin_set_member_status', { p_user_id: randomUUID(), p_status: 'suspended', p_reason: null }],
    ['admin_set_role', { p_user_id: randomUUID(), p_role: 'admin' }],
    [
      'admin_update_member',
      { p_user_id: randomUUID(), p_full_name: 'X Y', p_rank: 'Firefighter', p_station: 19, p_tour: 1, p_phone: '4155550000', p_employee_id: null },
    ],
    ['admin_mark_must_change_password', { p_user_id: randomUUID() }],
    ['admin_import_roster', { p_rows: [], p_replace: false }],
    ['admin_delete_roster_entry', { p_id: randomUUID() }],
    ['admin_cancel_post', { p_shift_id: randomUUID(), p_reason: null }],
    ['admin_void_trade', { p_shift_id: randomUUID(), p_reason: null }],
    ['admin_overview', {}],
    ['admin_remove_member', { p_user_id: randomUUID(), p_reason: null }],
  ]

  it('refuses every admin RPC to a regular member (NOT_ADMIN)', async () => {
    const m = await member()
    for (const [name, args] of calls) await expectRpcError(t.rpc(m.id, name, args), 'NOT_ADMIN')
  })

  it('a suspended admin has no admin rights', async () => {
    const suspended = await member({ role: 'admin', status: 'suspended' })
    await expectRpcError(t.rpc(suspended.id, 'admin_overview'), 'NOT_APPROVED')
  })
})

// ---------------------------------------------------------------------------
describe('admin_approve_member', () => {
  it('approves a pending member and tells them', async () => {
    const p = await member({ status: 'pending' })
    await t.query(`update public.profiles set status_reason = 'Roster: no entry' where id = $1`, [p.id])
    await t.rpc(admin.id, 'admin_approve_member', { p_user_id: p.id, p_roster_id: null })
    const row = await profile(p.id)
    expect(row).toMatchObject({ status: 'approved', status_reason: null, approved_by: admin.id })
    expect(row.approved_at).not.toBeNull()
    expect(await t.notificationsFor(p.id, 'member_approved')).toHaveLength(1)
    expect(await audited('admin.member_approved', p.id)).toHaveLength(1)
  })

  it('links a roster entry when given one', async () => {
    const p = await member({ status: 'pending' })
    const rosterId = await rosterRow()
    await t.rpc(admin.id, 'admin_approve_member', { p_user_id: p.id, p_roster_id: rosterId })
    expect((await profile(p.id)).roster_id).toBe(rosterId)
    expect((await t.one(`select claimed_by from public.roster where id = $1`, [rosterId])).claimed_by).toBe(p.id)
  })

  it('moves the link when re-approving with another roster entry', async () => {
    const m = await member({ status: 'suspended' })
    const oldRow = await rosterRow()
    await t.query(`update public.roster set claimed_by = $1 where id = $2`, [m.id, oldRow])
    await t.query(`update public.profiles set roster_id = $2 where id = $1`, [m.id, oldRow])
    const newRow = await rosterRow()
    await t.rpc(admin.id, 'admin_approve_member', { p_user_id: m.id, p_roster_id: newRow })
    expect((await profile(m.id)).roster_id).toBe(newRow)
    expect((await t.one(`select claimed_by from public.roster where id = $1`, [oldRow])).claimed_by).toBeNull()
  })

  it('refuses a roster entry that belongs to someone else, or does not exist', async () => {
    const p = await member({ status: 'pending' })
    const owner = await member()
    const rosterId = await rosterRow()
    await t.query(`update public.roster set claimed_by = $1 where id = $2`, [owner.id, rosterId])
    await expectRpcError(t.rpc(admin.id, 'admin_approve_member', { p_user_id: p.id, p_roster_id: rosterId }), 'INVALID_INPUT')
    await expectRpcError(t.rpc(admin.id, 'admin_approve_member', { p_user_id: p.id, p_roster_id: randomUUID() }), 'NOT_FOUND')
    expect((await profile(p.id)).status).toBe('pending')
  })

  it('approves rejected members too, but not onboarding or already-approved ones', async () => {
    const rejected = await member({ status: 'rejected' })
    await t.rpc(admin.id, 'admin_approve_member', { p_user_id: rejected.id, p_roster_id: null })
    expect((await profile(rejected.id)).status).toBe('approved')
    await expectRpcError(t.rpc(admin.id, 'admin_approve_member', { p_user_id: rejected.id, p_roster_id: null }), 'INVALID_INPUT')
    const onboarding = await member({ status: 'onboarding' })
    await expectRpcError(t.rpc(admin.id, 'admin_approve_member', { p_user_id: onboarding.id, p_roster_id: null }), 'INVALID_INPUT')
    await expectRpcError(t.rpc(admin.id, 'admin_approve_member', { p_user_id: randomUUID(), p_roster_id: null }), 'NOT_FOUND')
  })
})

// ---------------------------------------------------------------------------
describe('admin_reject_member', () => {
  it('rejects an applicant with a reason and tells them', async () => {
    const p = await member({ status: 'pending' })
    await t.rpc(admin.id, 'admin_reject_member', { p_user_id: p.id, p_reason: ' Not SFFD fire side ' })
    expect(await profile(p.id)).toMatchObject({ status: 'rejected', status_reason: 'Not SFFD fire side' })
    const [n] = await t.notificationsFor(p.id, 'member_rejected')
    expect(n.body).toContain('Not SFFD fire side')
    expect(await audited('admin.member_rejected', p.id)).toHaveLength(1)
  })

  it('only rejects applicants, and never yourself', async () => {
    await expectRpcError(t.rpc(admin.id, 'admin_reject_member', { p_user_id: (await member()).id, p_reason: null }), 'INVALID_INPUT')
    await expectRpcError(t.rpc(admin.id, 'admin_reject_member', { p_user_id: admin.id, p_reason: null }), 'INVALID_INPUT')
  })
})

// ---------------------------------------------------------------------------
describe('admin_set_member_status', () => {
  it('suspends and reinstates a member', async () => {
    const m = await member()
    const shiftOwner = await member({ tour: 1 })
    await t.createShift({ poster: shiftOwner, date: tourDay(1) })
    await t.rpc(admin.id, 'admin_set_member_status', { p_user_id: m.id, p_status: 'suspended', p_reason: 'Left SFFD' })
    expect(await profile(m.id)).toMatchObject({ status: 'suspended', status_reason: 'Left SFFD' })
    const [n] = await t.notificationsFor(m.id, 'account_status')
    expect(n.body).toContain('Left SFFD')
    // a suspended member sees no shifts and can't use member RPCs
    expect(await t.asUser(m.id, (q) => q(`select id from public.shifts`))).toEqual([])
    await expectRpcError(t.rpc(m.id, 'my_stats'), 'NOT_APPROVED')

    await t.rpc(admin.id, 'admin_set_member_status', { p_user_id: m.id, p_status: 'approved', p_reason: null })
    expect((await profile(m.id)).status).toBe('approved')
    expect(await t.asUser(m.id, (q) => q(`select id from public.shifts`))).not.toEqual([])
    expect(await audited('admin.member_status', m.id)).toHaveLength(2)
  })

  it('suspending takes the member\'s upcoming open posts down and closes their pending requests', async () => {
    const m = await member({ tour: 1, fullName: 'Sid Suspended' })
    const requester = await member({ tour: 2 })
    const otherPoster = await member({ tour: 2 })
    const postArgs = { p_shift_type: '24-Hour', p_station: null, p_return_dates: null, p_accept_limit: null, p_notes: null }

    // m's upcoming open post, with a pending request on it
    const open = await t.rpc<string>(m.id, 'post_shift', { ...postArgs, p_date: tourDay(1, 3, 3) })
    const onOpen = await t.rpc<string>(requester.id, 'request_shift', { p_shift_id: open, p_return_date: null, p_message: null })
    // history that stays as it is: a past open post and a confirmed trade
    const past = await t.createShift({ poster: m, date: daysFromToday(-2) })
    const covered = await t.createShift({ poster: m, date: tourDay(1, 3, 4), coverer: await member({ tour: 2 }) })
    // m's own pending request on someone else's post
    const theirs = await t.rpc<string>(otherPoster.id, 'post_shift', { ...postArgs, p_date: tourDay(2, 3, 3) })
    const mine = await t.rpc<string>(m.id, 'request_shift', { p_shift_id: theirs, p_return_date: null, p_message: null })

    await t.rpc(admin.id, 'admin_set_member_status', { p_user_id: m.id, p_status: 'suspended', p_reason: null })

    const shiftRow = (id: string) => t.one(`select * from public.shifts where id = $1`, [id])
    const requestStatus = async (id: string) =>
      (await t.one<{ status: string }>(`select status from public.shift_requests where id = $1`, [id])).status
    expect(await shiftRow(open)).toMatchObject({ status: 'cancelled', cancelled_by: admin.id })
    expect((await shiftRow(open)).cancel_note).toContain('suspended')
    expect(await requestStatus(onOpen)).toBe('cancelled')
    const [closed] = await t.notificationsFor(requester.id, 'post_cancelled')
    expect(closed).toMatchObject({ shift_id: open })
    expect(closed.body).toContain('Sid Suspended')
    expect((await shiftRow(past)).status).toBe('open')
    expect((await shiftRow(covered)).status).toBe('covered')

    expect(await requestStatus(mine)).toBe('cancelled')
    expect((await shiftRow(theirs)).status).toBe('open')
    const [told] = await t.notificationsFor(otherPoster.id, 'request_withdrawn')
    expect(told).toMatchObject({ shift_id: theirs })

    const [n] = await t.notificationsFor(m.id, 'account_status')
    expect(n.body).toContain('open posts were taken down')
    const [entry] = await audited('admin.member_status', m.id)
    expect(entry.details).toMatchObject({ to: 'suspended', posts_cancelled: 1, requests_closed: 1 })
  })

  it('suspending an admin removes their admin rights', async () => {
    const other = await member({ role: 'admin' })
    await t.rpc(admin.id, 'admin_set_member_status', { p_user_id: other.id, p_status: 'suspended', p_reason: null })
    await expectRpcError(t.rpc(other.id, 'admin_overview'), 'NOT_APPROVED')
  })

  it('validates status and target', async () => {
    const m = await member()
    await expectRpcError(t.rpc(admin.id, 'admin_set_member_status', { p_user_id: m.id, p_status: 'rejected', p_reason: null }), 'INVALID_INPUT')
    await expectRpcError(t.rpc(admin.id, 'admin_set_member_status', { p_user_id: admin.id, p_status: 'suspended', p_reason: null }), 'INVALID_INPUT')
    const onboarding = await member({ status: 'onboarding' })
    await expectRpcError(
      t.rpc(admin.id, 'admin_set_member_status', { p_user_id: onboarding.id, p_status: 'approved', p_reason: null }),
      'INVALID_INPUT',
    )
    await expectRpcError(
      t.rpc(admin.id, 'admin_set_member_status', { p_user_id: randomUUID(), p_status: 'approved', p_reason: null }),
      'NOT_FOUND',
    )
  })
})

// ---------------------------------------------------------------------------
describe('admin_set_role', () => {
  it('promotes and demotes members', async () => {
    const m = await member()
    await t.rpc(admin.id, 'admin_set_role', { p_user_id: m.id, p_role: 'admin' })
    expect((await profile(m.id)).role).toBe('admin')
    expect(await t.rpc(m.id, 'admin_overview')).toBeTruthy()
    const [n] = await t.notificationsFor(m.id, 'account_status')
    expect(n.url).toBe('/admin')

    await t.rpc(admin.id, 'admin_set_role', { p_user_id: m.id, p_role: 'member' })
    expect((await profile(m.id)).role).toBe('member')
    expect(await audited('admin.member_role', m.id)).toHaveLength(2)
  })

  it('validates role and target', async () => {
    const pending = await member({ status: 'pending' })
    await expectRpcError(t.rpc(admin.id, 'admin_set_role', { p_user_id: pending.id, p_role: 'admin' }), 'INVALID_INPUT')
    await expectRpcError(t.rpc(admin.id, 'admin_set_role', { p_user_id: pending.id, p_role: 'owner' }), 'INVALID_INPUT')
  })

  it('never removes the last admin (LAST_ADMIN)', async () => {
    // Make `admin` the only admin in this database.
    await t.query(`update public.profiles set role = 'member' where role = 'admin' and id <> $1`, [admin.id])
    await expectRpcError(t.rpc(admin.id, 'admin_set_role', { p_user_id: admin.id, p_role: 'member' }), 'LAST_ADMIN')
    expect((await profile(admin.id)).role).toBe('admin')

    // With a second admin, the first may step down; the second then can't.
    const second = await member()
    await t.rpc(admin.id, 'admin_set_role', { p_user_id: second.id, p_role: 'admin' })
    await t.rpc(second.id, 'admin_set_role', { p_user_id: admin.id, p_role: 'member' })
    await expectRpcError(t.rpc(second.id, 'admin_set_role', { p_user_id: second.id, p_role: 'member' }), 'LAST_ADMIN')

    // restore for the rest of the file
    await t.rpc(second.id, 'admin_set_role', { p_user_id: admin.id, p_role: 'admin' })
    expect((await profile(admin.id)).role).toBe('admin')
  })

  it('a suspended admin does not count as the remaining admin', async () => {
    await t.query(`update public.profiles set role = 'member' where role = 'admin' and id <> $1`, [admin.id])
    await member({ role: 'admin', status: 'suspended' })
    await expectRpcError(t.rpc(admin.id, 'admin_set_role', { p_user_id: admin.id, p_role: 'member' }), 'LAST_ADMIN')
  })
})

// ---------------------------------------------------------------------------
describe('admin_update_member', () => {
  const args = (userId: string, over: Record<string, unknown> = {}) => ({
    p_user_id: userId,
    p_full_name: 'Renamed Person',
    p_rank: 'Captain',
    p_station: 4,
    p_tour: 12,
    p_phone: '415 555 0177',
    p_employee_id: ' E-77 ',
    ...over,
  })

  it('updates name, rank, station (derived battalion/division), tour, phone and employee ID', async () => {
    const m = await member({ fullName: 'Old Name' })
    await t.rpc(admin.id, 'admin_update_member', args(m.id))
    expect(await profile(m.id)).toMatchObject({
      full_name: 'Renamed Person',
      rank: 'Captain',
      station: 4,
      battalion: 3,
      division: 3,
      tour: 12,
      phone: '415 555 0177',
      employee_id: 'E-77',
    })
    const [a] = await audited('admin.member_updated', m.id)
    expect((a.details as Row).before).toMatchObject({ full_name: 'Old Name' })
    expect((a.details as Row).after).toMatchObject({ full_name: 'Renamed Person', employee_id: 'E-77' })
  })

  it('validates its input', async () => {
    const m = await member()
    for (const over of [
      { p_full_name: 'X' },
      { p_rank: 'General' },
      { p_station: 998 },
      { p_tour: 0 },
      { p_phone: 'n/a' },
      { p_employee_id: 'E'.repeat(41) },
    ]) {
      await expectRpcError(t.rpc(admin.id, 'admin_update_member', args(m.id, over)), 'INVALID_INPUT')
    }
    await expectRpcError(t.rpc(admin.id, 'admin_update_member', args(randomUUID())), 'NOT_FOUND')
  })
})

// ---------------------------------------------------------------------------
describe('admin_mark_must_change_password', () => {
  it('forces a password change that the member can clear', async () => {
    const m = await member()
    await t.rpc(admin.id, 'admin_mark_must_change_password', { p_user_id: m.id })
    expect((await profile(m.id)).must_change_password).toBe(true)
    expect(await audited('admin.password_reset', m.id)).toHaveLength(1)
    await t.rpc(m.id, 'clear_must_change_password')
    expect((await profile(m.id)).must_change_password).toBe(false)
  })
})

// ---------------------------------------------------------------------------
describe('admin_import_roster', () => {
  type Result = { inserted: number; updated: number; skipped: number; deleted: number; errors: Array<{ row: number; message: string }> }
  const importRows = (rows: unknown, replace = false) =>
    t.rpc<Result>(admin.id, 'admin_import_roster', { p_rows: rows, p_replace: replace })

  it('inserts rows with computed keys and normalized fields', async () => {
    const last = `Imp${letters()}`
    const result = await importRows([
      { first_name: '  José ', last_name: `O'${last}`, rank: 'firefighter', station: '19', tour: '5', email: ' JOSE@Example.Test ', phone: '415-555-0100', employee_id: ' A1 ' },
      { first_name: 'Ann', last_name: last, rank: 'Captain', station: 101, tour: 31 },
      { first_name: 'Bo', last_name: last },
    ])
    expect(result).toEqual({ inserted: 3, updated: 0, skipped: 0, deleted: 0, errors: [] })
    const row = await t.one(`select * from public.roster where first_name = 'José'`)
    expect(row).toMatchObject({
      first_key: 'jose',
      last_key: `o${last}`.toLowerCase(),
      rank: 'Firefighter',
      station: 19,
      tour: 5,
      email: 'jose@example.test',
      employee_id: 'A1',
      created_by: admin.id,
      claimed_by: null,
    })
    const [a] = await t.query(`select details from public.audit_log where action = 'admin.roster_imported' order by id desc limit 1`)
    expect(a.details).toMatchObject({ inserted: 3 })
  })

  it('upserts on (last name, first name, employee ID): updates changed rows, skips identical ones', async () => {
    const last = `Ups${letters()}`
    await importRows([
      { first_name: 'Cy', last_name: last, station: 19 },
      { first_name: 'Di', last_name: last, station: 19 },
    ])
    const result = await importRows([
      { first_name: 'Cy', last_name: last, station: 19 }, // unchanged
      { first_name: 'Di', last_name: last, station: 4 }, // changed
      { first_name: 'Di', last_name: last, station: 4, employee_id: 'D2' }, // a different Di
      { first_name: 'Ed', last_name: last }, // new
      { first_name: 'ED', last_name: last.toUpperCase() }, // same person again in this file
    ])
    expect(result).toEqual({ inserted: 2, updated: 1, skipped: 2, deleted: 0, errors: [] })
    const count = await t.one<{ n: number }>(`select count(*)::int as n from public.roster where last_key = $1`, [last.toLowerCase()])
    expect(count.n).toBe(4)
  })

  it('reports invalid rows by 1-based row number and imports the rest', async () => {
    const last = `Err${letters()}`
    const result = await importRows([
      { first_name: 'Ok', last_name: last },
      { first_name: '', last_name: last },
      { first_name: 'Bad', last_name: last, rank: 'Chief' },
      { first_name: 'Bad', last_name: last, station: 999 },
      { first_name: 'Bad', last_name: last, station: 'nineteen' },
      { first_name: 'Bad', last_name: last, tour: 0 },
      { first_name: 'Bad', last_name: last, tour: 'x' },
      { first_name: '123', last_name: last },
      'not a record',
    ])
    expect(result.inserted).toBe(1)
    expect(result.errors.map((e) => e.row)).toEqual([2, 3, 4, 5, 6, 7, 8, 9])
    for (const e of result.errors) expect(e.message.length).toBeGreaterThan(0)
  })

  it('refuses something that is not a list', async () => {
    await expectRpcError(importRows({ first_name: 'x' }), 'INVALID_INPUT')
    await expectRpcError(importRows(null), 'INVALID_INPUT')
  })

  it('replace deletes unclaimed rows first but keeps claimed ones', async () => {
    const claimedId = await rosterRow('Keep', `Claimed${letters()}`)
    const owner = await member()
    await t.query(`update public.roster set claimed_by = $1 where id = $2`, [owner.id, claimedId])
    await rosterRow('Drop', `Unclaimed${letters()}`)
    const before = await t.one<{ n: number }>(`select count(*)::int as n from public.roster where claimed_by is null`)
    const result = await importRows([{ first_name: 'Fresh', last_name: `Start${letters()}` }], true)
    expect(result).toMatchObject({ inserted: 1, deleted: before.n })
    expect(await t.query(`select 1 from public.roster where id = $1`, [claimedId])).toHaveLength(1)
    const unclaimed = await t.one<{ n: number }>(`select count(*)::int as n from public.roster where claimed_by is null`)
    expect(unclaimed.n).toBe(1)
  })
})

// ---------------------------------------------------------------------------
describe('admin_delete_roster_entry', () => {
  it('deletes an entry and unlinks a claimed one from its member', async () => {
    const m = await member()
    const id = await rosterRow()
    await t.query(`update public.roster set claimed_by = $1 where id = $2`, [m.id, id])
    await t.query(`update public.profiles set roster_id = $2 where id = $1`, [m.id, id])
    await t.rpc(admin.id, 'admin_delete_roster_entry', { p_id: id })
    expect(await t.query(`select 1 from public.roster where id = $1`, [id])).toEqual([])
    expect((await profile(m.id)).roster_id).toBeNull()
    expect(await audited('admin.roster_deleted', id)).toHaveLength(1)
    await expectRpcError(t.rpc(admin.id, 'admin_delete_roster_entry', { p_id: id }), 'NOT_FOUND')
  })
})

// ---------------------------------------------------------------------------
describe('admin_cancel_post', () => {
  it('takes down an open post, closing its requests and telling everyone', async () => {
    const poster = await member({ tour: 1 })
    const requester = await member({ tour: 2 })
    const id = await t.rpc<string>(poster.id, 'post_shift', {
      p_date: tourDay(1, 3),
      p_shift_type: '24-Hour',
      p_station: null,
      p_return_dates: null,
      p_accept_limit: null,
      p_notes: null,
    })
    const reqId = await t.rpc<string>(requester.id, 'request_shift', { p_shift_id: id, p_return_date: null, p_message: null })
    await t.rpc(admin.id, 'admin_cancel_post', { p_shift_id: id, p_reason: 'Duplicate post' })
    expect(await t.one(`select status, cancelled_by, cancel_note from public.shifts where id = $1`, [id])).toEqual({
      status: 'cancelled',
      cancelled_by: admin.id,
      cancel_note: 'Duplicate post',
    })
    expect((await t.one(`select status from public.shift_requests where id = $1`, [reqId])).status).toBe('cancelled')
    expect(await t.notificationsFor(requester.id, 'post_cancelled')).toHaveLength(1)
    const [n] = await t.notificationsFor(poster.id, 'post_cancelled')
    expect(n.body).toContain('Duplicate post')
    expect(await audited('admin.post_cancelled', id)).toHaveLength(1)
  })

  it('works on posts that already started; refuses covered shifts and unknown ids', async () => {
    const poster = await member({ tour: null })
    const past = await t.createShift({ poster, date: daysFromToday(-3) })
    await t.rpc(admin.id, 'admin_cancel_post', { p_shift_id: past, p_reason: null })
    expect((await t.one(`select status from public.shifts where id = $1`, [past])).status).toBe('cancelled')

    const covered = await t.createShift({ poster, date: daysFromToday(9), coverer: await member({ tour: null }) })
    await expectRpcError(t.rpc(admin.id, 'admin_cancel_post', { p_shift_id: covered, p_reason: null }), 'NOT_OPEN')
    await expectRpcError(t.rpc(admin.id, 'admin_cancel_post', { p_shift_id: randomUUID(), p_reason: null }), 'NOT_FOUND')
  })
})

// ---------------------------------------------------------------------------
describe('admin_overview', () => {
  it('reports the dashboard counts', async () => {
    const poster = await member({ tour: null })
    await member({ status: 'pending' })
    await t.createShift({ poster, date: daysFromToday(12) })
    await t.createShift({ poster, date: daysFromToday(13), coverer: await member({ tour: null }) })

    const o = await t.rpc<Record<string, number>>(admin.id, 'admin_overview')
    const expected = await t.one<Record<string, number>>(
      `select
         (select count(*)::int from public.profiles where status = 'pending') as pending_members,
         (select count(*)::int from public.profiles where status = 'approved') as approved_members,
         (select count(*)::int from public.profiles where status = 'suspended' and removed_at is null) as suspended_members,
         (select count(*)::int from public.profiles where removed_at is not null) as removed_members,
         (select count(*)::int from public.shifts where status = 'open' and starts_at > now()) as open_shifts,
         (select count(*)::int from public.shifts where status = 'covered' and return_leg_of is null
             and confirmed_at >= date_trunc('month', public.today_pt())::date::timestamp at time zone 'America/Los_Angeles') as trades_this_month,
         (select count(*)::int from public.roster) as roster_size,
         (select count(*)::int from public.roster where claimed_by is null) as roster_unclaimed`,
    )
    expect(o).toEqual(expected)
    expect(o.pending_members).toBeGreaterThan(0)
    expect(o.open_shifts).toBeGreaterThan(0)
    expect(o.trades_this_month).toBeGreaterThan(0)
  })
})
