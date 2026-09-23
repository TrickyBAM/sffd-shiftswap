// Anonymous endpoints and server-side plumbing: app_keepalive, calendar_feed
// (ICS by token), claim_push_batch, signup_rate_check and the pg_net push
// webhook trigger (ARCHITECTURE §6.3 "Public", §6.5).

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  addDays,
  createTestDb,
  daysFromToday,
  expectDenied,
  expectRpcError,
  todayPT,
  tourDay,
  tourWorks,
  type Member,
  type MemberOptions,
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

async function tokenOf(m: Member): Promise<string> {
  const row = await t.one<{ calendar_token: string }>(`select calendar_token from public.profiles where id = $1`, [m.id])
  return row.calendar_token
}

// ---------------------------------------------------------------------------
describe('app_keepalive', () => {
  it('answers {ok: true} for anon, members and the service role', async () => {
    const m = await member()
    for (const who of [null, m.id, 'service'] as const) {
      expect(await t.rpc(who, 'app_keepalive')).toEqual({ ok: true })
    }
  })
})

// ---------------------------------------------------------------------------
describe('calendar_feed', () => {
  type Event = { date: string; kind: string; title: string; details: string }
  const feed = (token: string, who: string | null = null) => t.rpc<Event[]>(who, 'calendar_feed', { p_token: token })

  it('lists tour days, covered-for-me days, pickups and SwapMatch legs for the token\'s owner', async () => {
    const me = await member({ tour: 1, fullName: 'Cal Endar' })
    const other = await member({ tour: 2, fullName: 'Otto Other' })
    const given = tourDay(1, 2, 0)
    const pastGiven = findPastTourDay(1)
    const picked = tourDay(2, 2, 0)
    await t.createShift({ poster: me, date: given, coverer: other })
    await t.createShift({ poster: me, date: pastGiven, coverer: other })
    await t.createShift({ poster: other, date: picked, coverer: me, shiftType: 'PM' })
    // a SwapMatch: I give a later tour day, and work other's day in return
    const swapGive = tourDay(1, 40)
    const swapBack = tourDay(2, 40)
    const orig = await t.createShift({ poster: me, date: swapGive, coverer: other })
    const leg = await t.createShift({ poster: other, date: swapBack, coverer: me, returnLegOf: orig })
    await t.query(`update public.shifts set return_leg_id = $2 where id = $1`, [orig, leg])
    // outside the window: ignored
    await t.createShift({ poster: other, date: addDays(todayPT(), 400), coverer: me })

    const events = await feed(await tokenOf(me))
    const byDate = (d: string) => events.filter((e) => e.date === d)

    expect(byDate(given)).toEqual([expect.objectContaining({ kind: 'covered_for_me', title: 'Off: Otto Other covering you (24-Hour)' })])
    expect(byDate(pastGiven).map((e) => e.kind)).toEqual(['covered_for_me'])
    expect(byDate(picked)).toEqual([expect.objectContaining({ kind: 'covering', title: 'Covering Otto Other (PM)' })])
    expect(byDate(swapGive).map((e) => e.kind)).toEqual(['covered_for_me'])
    expect(byDate(swapGive)[0].details).toContain('SwapMatch')
    expect(byDate(swapBack)).toEqual([expect.objectContaining({ kind: 'swap', title: 'SwapMatch: working for Otto Other (24-Hour)' })])

    // every other tour day in today−30 … today+365 is a work event
    const from = addDays(todayPT(), -30)
    const to = addDays(todayPT(), 365)
    const work = events.filter((e) => e.kind === 'work').map((e) => e.date)
    const expected: string[] = []
    for (let d = from; d <= to; d = addDays(d, 1)) {
      if (tourWorks(1, d) && ![given, pastGiven, swapGive].includes(d)) expected.push(d)
    }
    expect(work).toEqual(expected)
    expect(events.find((e) => e.kind === 'work')!.title).toBe('On duty (Tour 1)')
    expect(events.every((e) => e.date >= from && e.date <= to)).toBe(true)
    // sorted by date
    expect(events.map((e) => e.date)).toEqual([...events.map((e) => e.date)].sort())
  })

  it('has no work days for a member with no tour', async () => {
    const me = await member({ tour: null })
    expect(await feed(await tokenOf(me))).toEqual([])
  })

  it('returns nothing for unknown tokens, members who are not approved, or a replaced token', async () => {
    expect(await feed('00000000-0000-4000-8000-000000000000')).toEqual([])
    const pending = await member({ status: 'pending', tour: 1 })
    expect(await feed(await tokenOf(pending))).toEqual([])
    const me = await member({ tour: 1 })
    const old = await tokenOf(me)
    expect((await feed(old)).length).toBeGreaterThan(0)
    const fresh = await t.rpc<string>(me.id, 'regenerate_calendar_token')
    expect(await feed(old)).toEqual([])
    expect((await feed(fresh)).length).toBeGreaterThan(0)
  })

  it('is callable by signed-in members too', async () => {
    const me = await member({ tour: 3 })
    expect((await feed(await tokenOf(me), me.id)).length).toBeGreaterThan(0)
  })
})

function findPastTourDay(tour: number): string {
  for (let back = 3; back < 30; back++) {
    const d = daysFromToday(-back)
    if (tourWorks(tour, d)) return d
  }
  throw new Error('no past tour day')
}

// ---------------------------------------------------------------------------
describe('claim_push_batch', () => {
  type Claimed = { notification_id: string; user_id: string; title: string; body: string; url: string }
  const claim = (limit: number | null = 200) => t.rpc<Claimed[]>('service', 'claim_push_batch', { p_limit: limit })

  async function drain(): Promise<void> {
    while ((await claim(500)).length > 0) {
      /* keep claiming */
    }
  }

  async function note(userId: string, over: { read?: boolean; ago?: string } = {}): Promise<string> {
    const row = await t.one<{ id: string }>(
      `insert into public.notifications (user_id, type, title, body, url, read_at, created_at)
       values ($1, 'account_status', 'Title', 'Body', '/alerts', case when $2 then now() end, now() - $3::interval)
       returning id`,
      [userId, over.read ?? false, over.ago ?? '0 seconds'],
    )
    return row.id
  }

  it('is for the service role only', async () => {
    const m = await member()
    await expectDenied(t.rpc(m.id, 'claim_push_batch', { p_limit: 10 }))
    await expectDenied(t.rpc(null, 'claim_push_batch', { p_limit: 10 }))
  })

  it('claims each unpushed notification exactly once and marks it pushed', async () => {
    await drain()
    const m = await member()
    const id = await note(m.id)
    const first = await claim()
    expect(first).toEqual([{ notification_id: id, user_id: m.id, title: 'Title', body: 'Body', url: '/alerts' }])
    const row = await t.one(`select pushed_at from public.notifications where id = $1`, [id])
    expect(row.pushed_at).not.toBeNull()
    expect(await claim()).toEqual([])
  })

  it('skips read notifications and ones older than 2 days', async () => {
    await drain()
    const m = await member()
    await note(m.id, { read: true })
    await note(m.id, { ago: '3 days' })
    const fresh = await note(m.id, { ago: '1 day' })
    expect((await claim()).map((c) => c.notification_id)).toEqual([fresh])
  })

  it('honours the limit (oldest first)', async () => {
    await drain()
    const m = await member()
    const a = await note(m.id, { ago: '3 minutes' })
    const b = await note(m.id, { ago: '2 minutes' })
    const c = await note(m.id, { ago: '1 minute' })
    expect((await claim(2)).map((x) => x.notification_id).sort()).toEqual([a, b].sort())
    expect((await claim(2)).map((x) => x.notification_id)).toEqual([c])
    expect(await claim(null)).toEqual([])
  })
})

// ---------------------------------------------------------------------------
describe('signup_rate_check', () => {
  const check = (ip: string, max = 3, windowMinutes = 60) =>
    t.rpc<boolean>('service', 'signup_rate_check', { p_ip_hash: ip, p_max: max, p_window_minutes: windowMinutes })

  it('allows p_max attempts per window per IP hash', async () => {
    const ip = `ip-${Math.random()}`
    expect([await check(ip), await check(ip), await check(ip), await check(ip)]).toEqual([true, true, true, false])
    expect(await check(`other-${ip}`)).toBe(true)
    const rows = await t.query(`select 1 from private.signup_attempts where ip_hash = $1`, [ip])
    expect(rows).toHaveLength(3)
  })

  it('forgets attempts outside the window', async () => {
    const ip = `ip-${Math.random()}`
    await t.query(`insert into private.signup_attempts (ip_hash, created_at) values ($1, now() - interval '2 hours'), ($1, now() - interval '3 hours')`, [ip])
    expect(await check(ip, 2, 60)).toBe(true)
  })

  it('validates the key and is service-role only', async () => {
    await expectRpcError(check(''), 'INVALID_INPUT')
    const m = await member()
    await expectDenied(t.rpc(m.id, 'signup_rate_check', { p_ip_hash: 'x', p_max: 3, p_window_minutes: 60 }))
  })
})

// ---------------------------------------------------------------------------
describe('push webhook trigger', () => {
  beforeAll(async () => {
    // A stand-in for pg_net's net.http_post that records its calls.
    await t.query(`create schema net`)
    await t.query(`create table net.calls (id serial primary key, url text, body jsonb, headers jsonb)`)
    await t.query(
      `create function net.http_post(url text, body jsonb default '{}', params jsonb default '{}',
                                     headers jsonb default '{}', timeout_milliseconds integer default 5000)
       returns bigint language plpgsql as $$
       begin
         if url like '%fail%' then raise exception 'network down'; end if;
         insert into net.calls (url, body, headers) values (url, body, headers);
         return 1;
       end $$`,
    )
  })

  afterAll(async () => {
    await t.query(`delete from private.app_config`)
    await t.query(`drop schema net cascade`)
  })

  async function calls(): Promise<Array<{ url: string; headers: Record<string, string> }>> {
    return t.query(`select url, headers from net.calls order by id`)
  }

  async function setConfig(url: string | null, secret: string | null) {
    await t.query(`delete from private.app_config`)
    if (url) await t.query(`insert into private.app_config (key, value) values ('push_webhook_url', $1)`, [url])
    if (secret) await t.query(`insert into private.app_config (key, value) values ('push_webhook_secret', $1)`, [secret])
  }

  async function confirmWithOthers(): Promise<void> {
    // one RPC that inserts several notifications in several statements
    const poster = await member({ tour: 1 })
    const takers = [await member({ tour: 2 }), await member({ tour: 2 })]
    const id = await t.rpc<string>(poster.id, 'post_shift', {
      p_date: tourDay(1, 3),
      p_shift_type: '24-Hour',
      p_station: null,
      p_return_dates: null,
      p_accept_limit: null,
      p_notes: null,
    })
    const reqs = []
    for (const m of takers) reqs.push(await t.rpc<string>(m.id, 'request_shift', { p_shift_id: id, p_return_date: null, p_message: null }))
    await t.query(`delete from net.calls`)
    await t.rpc(poster.id, 'confirm_request', { p_request_id: reqs[0] })
  }

  it('does nothing until both config keys are set', async () => {
    await setConfig(null, null)
    await confirmWithOthers()
    expect(await calls()).toEqual([])
    await setConfig('https://app.example.test/api/push/flush', null)
    await confirmWithOthers()
    expect(await calls()).toEqual([])
  })

  it('calls the webhook once per transaction with the secret header', async () => {
    await setConfig('https://app.example.test/api/push/flush', 's3cret')
    await confirmWithOthers()
    const made = await calls()
    expect(made).toHaveLength(1)
    expect(made[0].url).toBe('https://app.example.test/api/push/flush')
    expect(made[0].headers).toMatchObject({ 'x-webhook-secret': 's3cret', 'Content-Type': 'application/json' })
  })

  it('never blocks the insert when the webhook call fails', async () => {
    await setConfig('https://fail.example.test/api/push/flush', 's3cret')
    const m = await member()
    await t.query(`insert into public.notifications (user_id, type, title, body) values ($1, 'account_status', 't', 'b')`, [m.id])
    expect(await t.notificationsFor(m.id)).toHaveLength(1)
  })
})
