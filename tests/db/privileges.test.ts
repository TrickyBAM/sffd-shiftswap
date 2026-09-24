// Row level security and grants: every cell of ARCHITECTURE §6.2, allowed and
// denied, plus the exact function API surface per role (§6.3) and the
// default-privilege hardening that keeps future objects private.

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  createTestDb,
  daysFromToday,
  expectDenied,
  tourDay,
  unique,
  type Member,
  type TestDb,
} from './harness'

let t: TestDb

const TABLES = [
  'stations',
  'profiles',
  'roster',
  'shifts',
  'shift_requests',
  'messages',
  'notifications',
  'push_subscriptions',
  'audit_log',
] as const

beforeAll(async () => {
  t = await createTestDb()
})

afterAll(async () => {
  await t?.close()
})

/** Member-facing RPCs (authenticated only). */
const MEMBER_RPCS = [
  'acknowledge_telestaff',
  'admin_approve_member',
  'admin_cancel_post',
  'admin_delete_roster_entry',
  'admin_import_roster',
  'admin_mark_must_change_password',
  'admin_overview',
  'admin_reject_member',
  'admin_remove_member',
  'admin_set_member_status',
  'admin_set_role',
  'admin_update_member',
  'admin_void_trade',
  'cancel_post',
  'clear_must_change_password',
  'complete_onboarding',
  'confirm_request',
  'decline_request',
  'get_trade_contact',
  'mark_notifications_read',
  'mark_thread_read',
  'member_card',
  'member_cards',
  'my_ledger',
  'my_schedule',
  'my_stats',
  'post_shift',
  'regenerate_calendar_token',
  'request_shift',
  'request_trade_cancel',
  'respond_trade_cancel',
  'send_message',
  'shift_eligibility',
  'update_my_profile',
  'withdraw_request',
  'withdraw_trade_cancel',
]
const PURE_HELPERS = ['name_key', 'shift_starts_at', 'today_pt', 'tour_works']
const RLS_HELPERS = ['is_admin', 'is_approved']
const PUBLIC_ENDPOINTS = ['app_keepalive', 'calendar_feed']
const SERVICE_ONLY = ['claim_push_batch', 'signup_rate_check']

describe('function privileges (the API surface)', () => {
  async function executable(role: string): Promise<string[]> {
    const rows = await t.query<{ name: string }>(
      `select n.nspname || '.' || p.proname as name
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname in ('public', 'private')
          and has_function_privilege($1, p.oid, 'EXECUTE')
        order by 1`,
      [role],
    )
    return rows.map((r) => r.name)
  }

  it('lets anon execute only app_keepalive and calendar_feed', async () => {
    expect(await executable('anon')).toEqual(PUBLIC_ENDPOINTS.map((f) => `public.${f}`))
  })

  it('lets authenticated execute exactly the member RPCs, helpers and public endpoints', async () => {
    const expected = [...MEMBER_RPCS, ...PURE_HELPERS, ...RLS_HELPERS, ...PUBLIC_ENDPOINTS]
      .map((f) => `public.${f}`)
      .sort()
    expect(await executable('authenticated')).toEqual(expected)
  })

  it('lets service_role execute only the server helpers, public endpoints and pure helpers', async () => {
    const expected = [...SERVICE_ONLY, ...PURE_HELPERS, ...RLS_HELPERS, ...PUBLIC_ENDPOINTS]
      .map((f) => `public.${f}`)
      .sort()
    expect(await executable('service_role')).toEqual(expected)
  })

  it('makes every RPC SECURITY DEFINER and pins search_path on every function', async () => {
    const rows = await t.query<{ name: string; secdef: boolean; config: string[] | null }>(
      `select n.nspname || '.' || p.proname as name, p.prosecdef as secdef, p.proconfig as config
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname in ('public', 'private')`,
    )
    for (const row of rows) expect(row.config ?? [], row.name).toContain('search_path=""')
    const definer = new Set(rows.filter((r) => r.secdef).map((r) => r.name))
    for (const f of [...MEMBER_RPCS, ...PUBLIC_ENDPOINTS, ...SERVICE_ONLY, ...RLS_HELPERS]) {
      expect(definer.has(`public.${f}`), f).toBe(true)
    }
  })

  it('refuses anon calls to member RPCs and member calls to service RPCs', async () => {
    await expectDenied(t.rpc(null, 'my_stats'))
    const m = await t.createMember()
    await expectDenied(t.rpc(m.id, 'claim_push_batch', { p_limit: 10 }))
    await expectDenied(t.rpc(m.id, 'signup_rate_check', { p_ip_hash: 'x' }))
    await expectDenied(t.rpc('service', 'my_stats'))
  })
})

describe('table grants', () => {
  it('grants anon nothing on any table', async () => {
    const rows = await t.query(
      `select c.relname, a.privilege_type
         from pg_class c
         cross join lateral aclexplode(c.relacl) a
        where c.relnamespace in ('public'::regnamespace, 'private'::regnamespace)
          and a.grantee in ('anon'::regrole::oid, 0::oid)`,
    )
    expect(rows).toEqual([])
    const cols = await t.query(
      `select c.relname, at.attname
         from pg_attribute at join pg_class c on c.oid = at.attrelid
         cross join lateral aclexplode(at.attacl) a
        where c.relnamespace = 'public'::regnamespace and a.grantee in ('anon'::regrole::oid, 0::oid)`,
    )
    expect(cols).toEqual([])
  })

  it('grants authenticated exactly the §6.2 table and column privileges', async () => {
    const tables = await t.query<{ grant: string }>(
      `select c.relname || ':' || a.privilege_type as grant
         from pg_class c cross join lateral aclexplode(c.relacl) a
        where c.relnamespace in ('public'::regnamespace, 'private'::regnamespace)
          and a.grantee = 'authenticated'::regrole::oid
        order by 1`,
    )
    expect(tables.map((r) => r.grant)).toEqual([
      'audit_log:SELECT',
      'messages:SELECT',
      'notifications:DELETE',
      'notifications:SELECT',
      'profiles:SELECT',
      'push_subscriptions:DELETE',
      'push_subscriptions:SELECT',
      'roster:DELETE',
      'roster:SELECT',
      'shift_requests:SELECT',
      'shifts:SELECT',
      'stations:SELECT',
    ])
    const columns = await t.query<{ grant: string }>(
      `select c.relname || '.' || at.attname || ':' || a.privilege_type as grant
         from pg_attribute at join pg_class c on c.oid = at.attrelid
         cross join lateral aclexplode(at.attacl) a
        where c.relnamespace = 'public'::regnamespace and a.grantee = 'authenticated'::regrole::oid
        order by 1`,
    )
    expect(columns.map((r) => r.grant)).toEqual([
      'messages.read_at:UPDATE',
      'notifications.read_at:UPDATE',
      'push_subscriptions.auth:INSERT',
      'push_subscriptions.endpoint:INSERT',
      'push_subscriptions.p256dh:INSERT',
      'push_subscriptions.user_agent:INSERT',
      'push_subscriptions.user_id:INSERT',
    ])
  })

  it('enables row level security on every public table', async () => {
    const rows = await t.query<{ relname: string; rls: boolean }>(
      `select relname, relrowsecurity as rls from pg_class
        where relnamespace = 'public'::regnamespace and relkind = 'r' order by 1`,
    )
    expect(rows.map((r) => r.relname).sort()).toEqual([...TABLES].sort())
    for (const row of rows) expect(row.rls, row.relname).toBe(true)
  })

  it('does not auto-expose tables or functions created by later migrations', async () => {
    await t.query(`create table public.zz_future (id int)`)
    await t.query(`create function public.zz_future_fn() returns int language sql as 'select 1'`)
    try {
      const row = await t.one<Record<string, boolean>>(
        `select has_table_privilege('anon', 'public.zz_future', 'SELECT') as anon_t,
                has_table_privilege('authenticated', 'public.zz_future', 'SELECT') as auth_t,
                has_function_privilege('anon', 'public.zz_future_fn()', 'EXECUTE') as anon_f,
                has_function_privilege('authenticated', 'public.zz_future_fn()', 'EXECUTE') as auth_f`,
      )
      expect(row).toEqual({ anon_t: false, auth_t: false, anon_f: false, auth_f: false })
    } finally {
      await t.query(`drop function public.zz_future_fn()`)
      await t.query(`drop table public.zz_future`)
    }
  })
})

describe('anon', () => {
  it('cannot read any table', async () => {
    for (const table of TABLES) {
      await expectDenied(t.asAnon((q) => q(`select * from public.${table} limit 1`)))
    }
    await expectDenied(t.asAnon((q) => q(`select * from private.app_config`)))
  })

  it('cannot write any table', async () => {
    await expectDenied(t.asAnon((q) => q(`insert into public.stations values (999, 1, 1, 'x', 1)`)))
    await expectDenied(t.asAnon((q) => q(`delete from public.notifications`)))
  })

  it('can call app_keepalive', async () => {
    expect(await t.rpc(null, 'app_keepalive')).toEqual({ ok: true })
  })
})

describe('authenticated: stations', () => {
  it('any signed-in member can read; nobody can write', async () => {
    const pending = await t.createMember({ status: 'pending' })
    const rows = await t.asUser(pending.id, (q) => q(`select count(*)::int as n from public.stations`))
    expect(rows[0].n).toBe(47)
    await expectDenied(t.asUser(pending.id, (q) => q(`insert into public.stations values (999, 1, 1, 'x', 1)`)))
    await expectDenied(t.asUser(pending.id, (q) => q(`update public.stations set label = 'x' where station = 19`)))
    await expectDenied(t.asUser(pending.id, (q) => q(`delete from public.stations where station = 19`)))
  })
})

describe('authenticated: profiles', () => {
  it('a member reads only their own row — never other members\' phone or email', async () => {
    const a = await t.createMember()
    const b = await t.createMember()
    const rows = await t.asUser(a.id, (q) => q<{ id: string }>(`select id, phone, email from public.profiles`))
    expect(rows.map((r) => r.id)).toEqual([a.id])
    const other = await t.asUser(a.id, (q) => q(`select phone, email from public.profiles where id = $1`, [b.id]))
    expect(other).toEqual([])
  })

  it('pending members read their own row too', async () => {
    const p = await t.createMember({ status: 'pending' })
    const rows = await t.asUser(p.id, (q) => q<{ id: string }>(`select id from public.profiles`))
    expect(rows.map((r) => r.id)).toEqual([p.id])
  })

  it('admins read every row', async () => {
    const admin = await t.createMember({ role: 'admin' })
    const b = await t.createMember({ status: 'pending' })
    const rows = await t.asUser(admin.id, (q) => q<{ phone: string }>(`select phone from public.profiles where id = $1`, [b.id]))
    expect(rows).toHaveLength(1)
    const total = await t.one<{ n: number }>(`select count(*)::int as n from public.profiles`)
    const seen = await t.asUser(admin.id, (q) => q<{ n: number }>(`select count(*)::int as n from public.profiles`))
    expect(seen[0].n).toBe(total.n)
  })

  it('a suspended admin is not an admin', async () => {
    const admin = await t.createMember({ role: 'admin', status: 'suspended' })
    const rows = await t.asUser(admin.id, (q) => q(`select id from public.profiles`))
    expect(rows).toHaveLength(1)
  })

  it('nobody inserts, updates or deletes profiles directly', async () => {
    const a = await t.createMember()
    const admin = await t.createMember({ role: 'admin' })
    for (const who of [a, admin]) {
      await expectDenied(t.asUser(who.id, (q) => q(`update public.profiles set role = 'admin' where id = $1`, [who.id])))
      await expectDenied(t.asUser(who.id, (q) => q(`update public.profiles set status = 'approved' where id = $1`, [who.id])))
      await expectDenied(t.asUser(who.id, (q) => q(`delete from public.profiles where id = $1`, [who.id])))
      await expectDenied(
        t.asUser(who.id, (q) => q(`insert into public.profiles (id) values (gen_random_uuid())`)),
      )
    }
  })
})

describe('authenticated: roster', () => {
  async function rosterRow(): Promise<string> {
    const tag = unique()
    const row = await t.one<{ id: string }>(
      `insert into public.roster (first_name, last_name, first_key, last_key)
       values ('Ros', $1, 'ros', public.name_key($1)) returning id`,
      [`Ter${tag.replace(/[^a-z]/g, '')}x`],
    )
    return row.id
  }

  it('members cannot see or delete the roster', async () => {
    const id = await rosterRow()
    const m = await t.createMember()
    expect(await t.asUser(m.id, (q) => q(`select * from public.roster`))).toEqual([])
    const deleted = await t.asUser(m.id, (q) => q(`delete from public.roster where id = $1 returning id`, [id]))
    expect(deleted).toEqual([])
    expect(await t.query(`select 1 from public.roster where id = $1`, [id])).toHaveLength(1)
  })

  it('admins read and delete roster rows but cannot insert or update directly', async () => {
    const id = await rosterRow()
    const admin = await t.createMember({ role: 'admin' })
    const rows = await t.asUser(admin.id, (q) => q(`select id from public.roster where id = $1`, [id]))
    expect(rows).toHaveLength(1)
    await expectDenied(
      t.asUser(admin.id, (q) =>
        q(`insert into public.roster (first_name, last_name, first_key, last_key) values ('a', 'b', 'a', 'b')`),
      ),
    )
    await expectDenied(t.asUser(admin.id, (q) => q(`update public.roster set rank = 'Captain' where id = $1`, [id])))
    const deleted = await t.asUser(admin.id, (q) => q(`delete from public.roster where id = $1 returning id`, [id]))
    expect(deleted).toHaveLength(1)
  })
})

describe('authenticated: shifts', () => {
  let poster: Member
  let shiftId: string

  beforeAll(async () => {
    poster = await t.createMember()
    shiftId = await t.createShift({ poster, date: tourDay(1) })
  })

  it('approved members (and admins) see shifts', async () => {
    const other = await t.createMember({ tour: 2 })
    const admin = await t.createMember({ role: 'admin' })
    for (const who of [poster, other, admin]) {
      const rows = await t.asUser(who.id, (q) => q(`select id from public.shifts where id = $1`, [shiftId]))
      expect(rows).toHaveLength(1)
    }
  })

  it('onboarding, pending, rejected and suspended members see no shifts', async () => {
    for (const status of ['onboarding', 'pending', 'rejected', 'suspended'] as const) {
      const m = await t.createMember({ status })
      const rows = await t.asUser(m.id, (q) => q(`select id from public.shifts`))
      expect(rows, status).toEqual([])
    }
  })

  it('nobody writes shifts directly', async () => {
    await expectDenied(t.asUser(poster.id, (q) => q(`update public.shifts set notes = 'x' where id = $1`, [shiftId])))
    await expectDenied(t.asUser(poster.id, (q) => q(`delete from public.shifts where id = $1`, [shiftId])))
    await expectDenied(
      t.asUser(poster.id, (q) =>
        q(
          `insert into public.shifts (poster_id, poster_name, rank, station, battalion, division, date, shift_type, hours, starts_at)
           values ($1, 'x', 'Firefighter', 19, 9, 3, $2, '24-Hour', 24, now() + interval '9 days')`,
          [poster.id, daysFromToday(9)],
        ),
      ),
    )
  })
})

describe('authenticated: shift_requests', () => {
  it('the requester, the poster and admins see a request; other members do not', async () => {
    const poster = await t.createMember()
    const requester = await t.createMember({ tour: 2 })
    const other = await t.createMember({ tour: 2 })
    const admin = await t.createMember({ role: 'admin' })
    const shiftId = await t.createShift({ poster, date: tourDay(1) })
    const req = await t.one<{ id: string }>(
      `insert into public.shift_requests (shift_id, requester_id, requester_name, requester_rank, requester_station)
       values ($1, $2, 'R', 'Firefighter', 19) returning id`,
      [shiftId, requester.id],
    )
    for (const who of [requester, poster, admin]) {
      const rows = await t.asUser(who.id, (q) => q(`select id from public.shift_requests where id = $1`, [req.id]))
      expect(rows).toHaveLength(1)
    }
    expect(await t.asUser(other.id, (q) => q(`select id from public.shift_requests where id = $1`, [req.id]))).toEqual([])

    await expectDenied(
      t.asUser(requester.id, (q) => q(`update public.shift_requests set status = 'accepted' where id = $1`, [req.id])),
    )
    await expectDenied(t.asUser(poster.id, (q) => q(`delete from public.shift_requests where id = $1`, [req.id])))
    await expectDenied(
      t.asUser(requester.id, (q) =>
        q(
          `insert into public.shift_requests (shift_id, requester_id, requester_name, requester_rank, requester_station)
           values ($1, $2, 'R', 'Firefighter', 19)`,
          [shiftId, requester.id],
        ),
      ),
    )
  })
})

describe('authenticated: messages', () => {
  it('sender and recipient read; only the recipient may set read_at; no other writes', async () => {
    const poster = await t.createMember()
    const requester = await t.createMember({ tour: 2 })
    const other = await t.createMember({ tour: 2 })
    const shiftId = await t.createShift({ poster, date: tourDay(1) })
    const msg = await t.one<{ id: string }>(
      `insert into public.messages (shift_id, sender_id, recipient_id, body) values ($1, $2, $3, 'hi') returning id`,
      [shiftId, poster.id, requester.id],
    )
    for (const who of [poster, requester]) {
      expect(await t.asUser(who.id, (q) => q(`select id from public.messages where id = $1`, [msg.id]))).toHaveLength(1)
    }
    expect(await t.asUser(other.id, (q) => q(`select id from public.messages where id = $1`, [msg.id]))).toEqual([])

    // The sender can't mark it read (row not theirs to update) …
    const bySender = await t.asUser(poster.id, (q) =>
      q(`update public.messages set read_at = now() where id = $1 returning id`, [msg.id]),
    )
    expect(bySender).toEqual([])
    // … the recipient can …
    const byRecipient = await t.asUser(requester.id, (q) =>
      q(`update public.messages set read_at = now() where id = $1 returning id`, [msg.id]),
    )
    expect(byRecipient).toHaveLength(1)
    // … but only read_at.
    await expectDenied(t.asUser(requester.id, (q) => q(`update public.messages set body = 'edited' where id = $1`, [msg.id])))
    await expectDenied(t.asUser(requester.id, (q) => q(`delete from public.messages where id = $1`, [msg.id])))
    await expectDenied(
      t.asUser(requester.id, (q) =>
        q(`insert into public.messages (shift_id, sender_id, recipient_id, body) values ($1, $2, $3, 'x')`, [
          shiftId,
          requester.id,
          poster.id,
        ]),
      ),
    )
  })
})

describe('authenticated: notifications', () => {
  it('own rows only: read, set read_at, delete; never insert or edit content', async () => {
    const a = await t.createMember()
    const b = await t.createMember()
    const mine = await t.one<{ id: string }>(
      `insert into public.notifications (user_id, type, title, body) values ($1, 'account_status', 't', 'b') returning id`,
      [a.id],
    )
    const theirs = await t.one<{ id: string }>(
      `insert into public.notifications (user_id, type, title, body) values ($1, 'account_status', 't', 'b') returning id`,
      [b.id],
    )
    const seen = await t.asUser(a.id, (q) => q<{ id: string }>(`select id from public.notifications`))
    expect(seen.map((r) => r.id)).toEqual([mine.id])

    expect(
      await t.asUser(a.id, (q) => q(`update public.notifications set read_at = now() where id = $1 returning id`, [mine.id])),
    ).toHaveLength(1)
    expect(
      await t.asUser(a.id, (q) => q(`update public.notifications set read_at = now() where id = $1 returning id`, [theirs.id])),
    ).toEqual([])
    await expectDenied(t.asUser(a.id, (q) => q(`update public.notifications set title = 'x' where id = $1`, [mine.id])))
    await expectDenied(
      t.asUser(a.id, (q) =>
        q(`insert into public.notifications (user_id, type, title, body) values ($1, 'message', 't', 'b')`, [a.id]),
      ),
    )
    expect(await t.asUser(a.id, (q) => q(`delete from public.notifications where id = $1 returning id`, [theirs.id]))).toEqual([])
    expect(
      await t.asUser(a.id, (q) => q(`delete from public.notifications where id = $1 returning id`, [mine.id])),
    ).toHaveLength(1)
    expect(await t.query(`select 1 from public.notifications where id = $1`, [theirs.id])).toHaveLength(1)
  })
})

describe('authenticated: push_subscriptions', () => {
  const sub = (endpoint: string) => [endpoint, 'p256dh-key', 'auth-secret']

  it('members insert, read and delete only their own subscriptions', async () => {
    const a = await t.createMember()
    const b = await t.createMember()
    const endpoint = `https://fcm.googleapis.com/fcm/send/${unique()}`
    // user_id defaults to auth.uid()
    await t.asUser(a.id, (q) =>
      q(`insert into public.push_subscriptions (endpoint, p256dh, auth) values ($1, $2, $3)`, sub(endpoint)),
    )
    const own = await t.asUser(a.id, (q) => q<{ user_id: string }>(`select user_id from public.push_subscriptions`))
    expect(own.map((r) => r.user_id)).toEqual([a.id])
    expect(await t.asUser(b.id, (q) => q(`select * from public.push_subscriptions`))).toEqual([])

    // can't insert for someone else
    await expectDenied(
      t.asUser(b.id, (q) =>
        q(`insert into public.push_subscriptions (user_id, endpoint, p256dh, auth) values ($1, $2, $3, $4)`, [
          a.id,
          ...sub(`https://fcm.googleapis.com/fcm/send/${unique()}`),
        ]),
      ),
    )
    // no updates at all
    await expectDenied(t.asUser(a.id, (q) => q(`update public.push_subscriptions set auth = 'x'`)))
    // b can't delete a's row; a can
    expect(await t.asUser(b.id, (q) => q(`delete from public.push_subscriptions where endpoint = $1 returning id`, [endpoint]))).toEqual([])
    expect(
      await t.asUser(a.id, (q) => q(`delete from public.push_subscriptions where endpoint = $1 returning id`, [endpoint])),
    ).toHaveLength(1)
  })

  it('only accepts https endpoints on the browser push services, for everyone', async () => {
    const a = await t.createMember()
    const insert = async (endpoint: string, actor: string | 'service' = a.id) => {
      try {
        await t.as(actor, (q) =>
          q(`insert into public.push_subscriptions (user_id, endpoint, p256dh, auth) values ($1, $2, 'k', 'a')`, [a.id, endpoint]),
        )
        return true
      } catch {
        return false
      }
    }
    const good = [
      `https://fcm.googleapis.com/fcm/send/dQw4:APA91b-${unique()}`,
      `https://fcm.googleapis.com/wp/${unique()}`,
      `https://updates.push.services.mozilla.com/wpush/v2/gAAAAA${unique()}`,
      `https://web.push.apple.com/QGx${unique()}`,
      `https://wns2-bl2p.notify.windows.com/w/?token=BQYAAAB%2b${unique()}%3d`,
    ]
    for (const endpoint of good) expect(await insert(endpoint), endpoint).toBe(true)
    const bad = [
      `http://fcm.googleapis.com/fcm/send/${unique()}`, // not https
      `https://fcm.googleapis.com:8443/fcm/send/${unique()}`, // port
      `https://fcm.googleapis.com@evil.example.test/${unique()}`, // user info
      `https://fcm.googleapis.com.evil.example.test/${unique()}`, // look-alike host
      `https://evil.example.test/fcm.googleapis.com/${unique()}`,
      `https://notify.windows.com/${unique()}`,
      `https://fcm.googleapis.com/fcm/send/${unique()} extra`, // whitespace
      `https://localhost/${unique()}`,
      'https://[::1]/x',
      '',
    ]
    for (const endpoint of bad) {
      expect(await insert(endpoint), endpoint).toBe(false)
      expect(await insert(endpoint, 'service'), `${endpoint} (service role)`).toBe(false)
    }
  })

  it('re-subscribing the same browser endpoint as another member replaces the old row', async () => {
    const a = await t.createMember()
    const b = await t.createMember()
    const endpoint = `https://fcm.googleapis.com/fcm/send/${unique()}`
    await t.asUser(a.id, (q) => q(`insert into public.push_subscriptions (endpoint, p256dh, auth) values ($1, $2, $3)`, sub(endpoint)))
    await t.asUser(b.id, (q) => q(`insert into public.push_subscriptions (endpoint, p256dh, auth) values ($1, $2, $3)`, sub(endpoint)))
    const rows = await t.query<{ user_id: string }>(`select user_id from public.push_subscriptions where endpoint = $1`, [endpoint])
    expect(rows.map((r) => r.user_id)).toEqual([b.id])
    // and the same member re-subscribing is idempotent
    await t.asUser(b.id, (q) => q(`insert into public.push_subscriptions (endpoint, p256dh, auth) values ($1, $2, $3)`, sub(endpoint)))
    expect(await t.query(`select 1 from public.push_subscriptions where endpoint = $1`, [endpoint])).toHaveLength(1)
  })
})

describe('authenticated: audit_log', () => {
  it('admins read; members see nothing; nobody writes', async () => {
    const admin = await t.createMember({ role: 'admin' })
    const m = await t.createMember()
    await t.query(`insert into public.audit_log (actor_id, action) values ($1, 'test.entry')`, [m.id])
    const adminRows = await t.asUser(admin.id, (q) => q(`select * from public.audit_log where action = 'test.entry'`))
    expect(adminRows.length).toBeGreaterThan(0)
    expect(await t.asUser(m.id, (q) => q(`select * from public.audit_log`))).toEqual([])
    for (const who of [admin, m]) {
      await expectDenied(t.asUser(who.id, (q) => q(`insert into public.audit_log (action) values ('x')`)))
      await expectDenied(t.asUser(who.id, (q) => q(`update public.audit_log set action = 'x'`)))
      await expectDenied(t.asUser(who.id, (q) => q(`delete from public.audit_log`)))
    }
  })
})

describe('private schema', () => {
  it('is out of reach for members and admins', async () => {
    const admin = await t.createMember({ role: 'admin' })
    await expectDenied(t.asUser(admin.id, (q) => q(`select * from private.app_config`)))
    await expectDenied(t.asUser(admin.id, (q) => q(`select * from private.signup_attempts`)))
    await expectDenied(t.asUser(admin.id, (q) => q(`select private.ranks()`)))
  })

  it('internal helpers in public are not executable by members', async () => {
    const m = await t.createMember()
    await expectDenied(t.asUser(m.id, (q) => q(`select public.effective_works($1, current_date)`, [m.id])))
    await expectDenied(t.asUser(m.id, (q) => q(`select public.base_works($1, current_date)`, [m.id])))
  })
})

describe('service_role', () => {
  it('bypasses RLS for server-side work', async () => {
    const a = await t.createMember()
    await t.query(`insert into public.notifications (user_id, type, title, body) values ($1, 'account_status', 't', 'b')`, [a.id])
    const rows = await t.asService((q) => q<{ n: number }>(`select count(*)::int as n from public.profiles`))
    const all = await t.one<{ n: number }>(`select count(*)::int as n from public.profiles`)
    expect(rows[0].n).toBe(all.n)
    const subs = await t.asService((q) =>
      q(`insert into public.push_subscriptions (user_id, endpoint, p256dh, auth) values ($1, $2, 'k', 'a') returning id`, [
        a.id,
        `https://fcm.googleapis.com/fcm/send/${unique()}`,
      ]),
    )
    expect(subs).toHaveLength(1)
  })
})

describe('realtime publication', () => {
  it('publishes shifts, shift_requests, notifications and messages', async () => {
    const rows = await t.query<{ tablename: string }>(
      `select tablename from pg_publication_tables where pubname = 'supabase_realtime' order by 1`,
    )
    expect(rows.map((r) => r.tablename)).toEqual(['messages', 'notifications', 'shift_requests', 'shifts'])
  })
})
