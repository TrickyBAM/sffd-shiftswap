#!/usr/bin/env node
// Live end-to-end smoke test against the real Supabase project (PostgREST + RLS + RPCs).
//
// Creates throwaway members (emails e2e-<random>@example.com), walks the core trade
// flows exactly the way the app's browser client does (publishable key + member JWT),
// asserts the results, then deletes every row it created. Run before a release:
//
//   node scripts/smoke/live-smoke.mjs            # run and clean up
//   node scripts/smoke/live-smoke.mjs --keep     # leave the test data for inspection
//   node scripts/smoke/live-smoke.mjs --cleanup  # only delete leftover e2e data
//
// Needs .env.local from `vercel env pull` (Supabase URL/keys + POSTGRES_URL_NON_POOLING).
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import pg from 'pg'
import { createClient } from '@supabase/supabase-js'
import { loadEnv, connectionString, clientConfig } from '../db/_env.mjs'

loadEnv()
const env = process.env
const URL_ = env.NEXT_PUBLIC_SUPABASE_URL
const PUBLIC_KEY = env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const SECRET_KEY = env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY
if (!URL_ || !PUBLIC_KEY || !SECRET_KEY) throw new Error('Missing Supabase env vars — run `vercel env pull .env.local`.')

const KEEP = process.argv.includes('--keep')
const CLEANUP_ONLY = process.argv.includes('--cleanup')
const E2E_EMAIL = /^e2e-[a-z]+@example\.com$/

const conn = connectionString(env)
if (!conn) throw new Error('No POSTGRES_URL_NON_POOLING / DATABASE_URL configured.')
const db = new pg.Client(clientConfig(conn.url))
const admin = createClient(URL_, SECRET_KEY, { auth: { persistSession: false, autoRefreshToken: false } })

const letters = (n) => Array.from(crypto.randomBytes(n), (b) => String.fromCharCode(97 + (b % 26))).join('')
const q = async (sql, params = []) => (await db.query(sql, params)).rows

let passed = 0
async function step(name, fn) {
  try {
    await fn()
    passed++
    console.log(`  ok  ${name}`)
  } catch (err) {
    console.error(`  FAIL ${name}\n       ${err?.message ?? err}`)
    throw err
  }
}

async function rpc(sb, fn, args = {}) {
  const { data, error } = await sb.rpc(fn, args)
  if (error) {
    const e = new Error(`${fn}: ${error.message} [${error.hint ?? error.code}]`)
    e.hint = error.hint
    throw e
  }
  return data
}

async function expectHint(promise, hint) {
  try {
    await promise
  } catch (err) {
    assert.equal(err.hint, hint, `expected hint ${hint}, got ${err.hint} (${err.message})`)
    return
  }
  assert.fail(`expected error ${hint}, but the call succeeded`)
}

async function makeMember(label, { rank, station, tour }) {
  const email = `e2e-${letters(10)}@example.com`
  const password = `${letters(12)}A1!`
  const fullName = `E2E ${label} ${letters(6)}`.replace(/\b\w/g, (c) => c.toUpperCase())
  const { data, error } = await admin.auth.admin.createUser({
    email, password, email_confirm: true, user_metadata: { full_name: fullName, phone: '415-555-0100' },
  })
  if (error) throw error
  const sb = createClient(URL_, PUBLIC_KEY, { auth: { persistSession: false, autoRefreshToken: false } })
  const { error: signInError } = await sb.auth.signInWithPassword({ email, password })
  if (signInError) throw signInError
  return { id: data.user.id, email, fullName, sb, rank, station, tour }
}

async function cleanup() {
  const users = (await q(`select id, email from auth.users`)).filter((u) => E2E_EMAIL.test(u.email ?? ''))
  if (!users.length) return 0
  const ids = users.map((u) => u.id)
  await db.query('begin')
  try {
    await db.query(`delete from public.messages where sender_id = any($1) or recipient_id = any($1)`, [ids])
    await db.query(`delete from public.notifications where user_id = any($1) or actor_id = any($1)`, [ids])
    await db.query(`delete from public.shift_requests where requester_id = any($1)
                      or shift_id in (select id from public.shifts where poster_id = any($1) or coverer_id = any($1))`, [ids])
    await db.query(`update public.shifts set return_leg_id = null, return_leg_of = null
                      where poster_id = any($1) or coverer_id = any($1)`, [ids])
    await db.query(`delete from public.shifts where poster_id = any($1) or coverer_id = any($1)`, [ids])
    await db.query(`delete from public.audit_log where actor_id = any($1) or target_id = any($1)`, [ids])
    await db.query(`delete from public.push_subscriptions where user_id = any($1)`, [ids])
    await db.query(`delete from public.roster where claimed_by = any($1) or last_name like 'E2e%'`, [ids])
    await db.query(`delete from auth.users where id = any($1)`, [ids])
    await db.query('commit')
  } catch (err) {
    await db.query('rollback')
    throw err
  }
  return ids.length
}

async function main() {
  await db.connect()
  if (CLEANUP_ONLY) {
    console.log(`Removed ${await cleanup()} e2e member(s).`)
    return
  }
  await cleanup() // leftovers from an aborted run

  const today = (await q(`select public.today_pt()::text as d`))[0].d
  // Pick two tours in Battalion 1 and dates that satisfy the SwapMatch rules:
  // D = a day A (tour 1) works and B (tour 5) is off; R = a day B works and A is off.
  const TA = 1, TB = 5
  const days = await q(
    `select d::date::text as d, public.tour_works($1::smallint, d::date) as a, public.tour_works($2::smallint, d::date) as b
       from generate_series($3::date + 3, $3::date + 60, interval '1 day') d`, [TA, TB, today])
  const D = days.find((r) => r.a && !r.b).d
  const R = days.find((r) => r.b && !r.a && r.d > D).d
  const D2 = days.find((r) => r.a && !r.b && r.d > R).d
  console.log(`today ${today}; A (Tour ${TA}) posts ${D}, B (Tour ${TB}) returns ${R}`)

  const boss = await makeMember('Admin', { rank: 'Captain', station: 2, tour: 10 })
  await q(`update public.profiles set role = 'admin', status = 'approved', approved_at = now(), rank = 'Captain',
             station = 2, battalion = 1, division = 2, tour = 10, full_name = $2, phone = '415-555-0100'
           where id = $1`, [boss.id, boss.fullName])
  await rpc(boss.sb, 'acknowledge_telestaff')

  const A = await makeMember('Alpha', { rank: 'Firefighter', station: 2, tour: TA })
  const B = await makeMember('Bravo', { rank: 'Firefighter', station: 13, tour: TB })
  const C = await makeMember('Charlie', { rank: 'Lieutenant', station: 28, tour: 20 })
  const [aFirst, ...aRest] = A.fullName.split(' ')

  await step('admin imports a roster row for Alpha', async () => {
    const res = await rpc(boss.sb, 'admin_import_roster', {
      p_rows: [{ first_name: aFirst, last_name: aRest.join(' '), rank: 'Firefighter', station: 2, tour: TA }],
      p_replace: false,
    })
    assert.equal(res.errors.length, 0, JSON.stringify(res.errors))
  })

  await step('Alpha matches the roster and is auto-approved', async () => {
    const res = await rpc(A.sb, 'complete_onboarding', {
      p_full_name: A.fullName, p_phone: '415-555-0101', p_rank: 'Firefighter', p_station: 2, p_tour: TA,
    })
    assert.equal(res.status, 'approved', JSON.stringify(res))
  })

  await step('Bravo does not match and waits for approval', async () => {
    const res = await rpc(B.sb, 'complete_onboarding', {
      p_full_name: B.fullName, p_phone: '415-555-0102', p_rank: 'Firefighter', p_station: 13, p_tour: TB,
    })
    assert.equal(res.status, 'pending')
  })

  await step('a pending member cannot see the board', async () => {
    const { data, error } = await B.sb.from('shifts').select('id').limit(1)
    assert.ok(!error, error?.message)
    assert.equal(data.length, 0)
  })

  await step('admin sees Bravo in the queue and approves', async () => {
    const pending = await q(`select id from public.profiles where status = 'pending' and id = $1`, [B.id])
    assert.equal(pending.length, 1)
    await rpc(boss.sb, 'admin_approve_member', { p_user_id: B.id })
  })

  await step('Charlie (Lieutenant) onboards and is approved', async () => {
    await rpc(C.sb, 'complete_onboarding', {
      p_full_name: C.fullName, p_phone: '415-555-0103', p_rank: 'Lieutenant', p_station: 28, p_tour: 20,
    })
    await rpc(boss.sb, 'admin_approve_member', { p_user_id: C.id })
  })

  await step('posting before the TeleStaff acknowledgment is refused', async () => {
    await expectHint(rpc(A.sb, 'post_shift', { p_date: D, p_shift_type: '24-Hour' }), 'ACK_REQUIRED')
  })
  for (const m of [A, B, C]) await rpc(m.sb, 'acknowledge_telestaff')

  await step('members cannot read each other\'s phone numbers', async () => {
    const { data } = await B.sb.from('profiles').select('id, phone').eq('id', A.id)
    assert.equal(data.length, 0)
  })

  await step('members cannot write tables directly', async () => {
    const { error } = await A.sb.from('shifts').insert({ poster_id: A.id, date: D, shift_type: '24-Hour' })
    assert.ok(error, 'direct insert should fail')
  })

  let shiftId
  await step('Alpha posts a SwapMatch on a tour day', async () => {
    shiftId = await rpc(A.sb, 'post_shift', {
      p_date: D, p_shift_type: '24-Hour', p_return_dates: [R], p_accept_limit: 'battalion', p_notes: 'e2e smoke test',
    })
    assert.ok(shiftId)
  })

  await step('posting a day Alpha does not work is refused', async () => {
    await expectHint(rpc(A.sb, 'post_shift', { p_date: R, p_shift_type: '24-Hour' }), 'NOT_YOUR_SHIFT_DAY')
  })

  await step('Bravo was alerted about the new shift', async () => {
    const { data } = await B.sb.from('notifications').select('type, shift_id').eq('shift_id', shiftId)
    assert.ok(data.some((n) => n.type === 'new_shift'), JSON.stringify(data))
  })

  await step('Charlie (different rank) is not eligible', async () => {
    const res = await rpc(C.sb, 'shift_eligibility', { p_shift_id: shiftId })
    assert.equal(res.eligible, false)
    assert.ok(res.reasons.some((r) => r.code === 'RANK_MISMATCH'), JSON.stringify(res.reasons))
  })

  let requestId
  await step('Bravo requests it, picking the return date', async () => {
    const elig = await rpc(B.sb, 'shift_eligibility', { p_shift_id: shiftId })
    assert.ok(elig.valid_return_dates.includes(R), JSON.stringify(elig))
    requestId = await rpc(B.sb, 'request_shift', { p_shift_id: shiftId, p_return_date: R, p_message: 'I can take it' })
  })

  await step('trade partners can see each other\'s contact info', async () => {
    const rows = await rpc(B.sb, 'get_trade_contact', { p_shift_id: shiftId })
    assert.equal(rows.length, 1)
    assert.equal(rows[0].phone, '415-555-0101')
    const none = await rpc(C.sb, 'get_trade_contact', { p_shift_id: shiftId })
    assert.equal(none.length, 0)
  })

  await step('chat works between poster and requester', async () => {
    await rpc(B.sb, 'send_message', { p_shift_id: shiftId, p_recipient_id: A.id, p_body: 'Relief at 0730 ok?' })
    const { data } = await A.sb.from('messages').select('body').eq('shift_id', shiftId)
    assert.equal(data.length, 1)
  })

  let returnLegId
  await step('Alpha confirms; a return leg is created', async () => {
    const res = await rpc(A.sb, 'confirm_request', { p_request_id: requestId })
    returnLegId = res.return_leg_id
    assert.ok(returnLegId)
    const [orig] = await q(`select status, coverer_id from public.shifts where id = $1`, [shiftId])
    assert.equal(orig.status, 'covered')
    assert.equal(orig.coverer_id, B.id)
    const [leg] = await q(`select status, poster_id, coverer_id, date::text from public.shifts where id = $1`, [returnLegId])
    assert.deepEqual([leg.status, leg.poster_id, leg.coverer_id, leg.date], ['covered', B.id, A.id, R])
  })

  await step('balances net to zero for a SwapMatch', async () => {
    const ledger = await rpc(A.sb, 'my_ledger')
    const row = ledger.find((l) => l.partner_id === B.id)
    assert.equal(row.net_24, 0)
    const stats = await rpc(A.sb, 'my_stats')
    assert.equal(stats.balance, 0)
  })

  await step('schedules reflect the trade', async () => {
    const sched = await rpc(A.sb, 'my_schedule', { p_from: D, p_to: R })
    const onD = sched.find((s) => s.date === D)
    const onR = sched.find((s) => s.date === R)
    assert.equal(onD.working, false)
    assert.equal(onR.working, true)
  })

  await step('mutual cancel: Alpha asks, Bravo agrees, post reopens', async () => {
    await rpc(A.sb, 'request_trade_cancel', { p_shift_id: shiftId, p_reason: 'e2e' })
    await rpc(B.sb, 'respond_trade_cancel', { p_shift_id: shiftId, p_agree: true })
    const [orig] = await q(`select status from public.shifts where id = $1`, [shiftId])
    const [leg] = await q(`select status from public.shifts where id = $1`, [returnLegId])
    assert.equal(orig.status, 'open')
    assert.equal(leg.status, 'cancelled')
  })

  await step('Alpha takes the post down', async () => {
    await rpc(A.sb, 'cancel_post', { p_shift_id: shiftId })
  })

  await step('admin can void a confirmed trade', async () => {
    const id2 = await rpc(A.sb, 'post_shift', { p_date: D2, p_shift_type: 'PM' })
    const req = await rpc(B.sb, 'request_shift', { p_shift_id: id2 })
    await rpc(A.sb, 'confirm_request', { p_request_id: req })
    await rpc(boss.sb, 'admin_void_trade', { p_shift_id: id2, p_reason: 'e2e' })
    const [s] = await q(`select status, coverer_id from public.shifts where id = $1`, [id2])
    assert.equal(s.status, 'open')
    assert.equal(s.coverer_id, null)
  })

  await step('members cannot call admin functions', async () => {
    const { error } = await A.sb.rpc('admin_overview')
    assert.ok(error)
  })

  await step('push queue is claimable by the server only', async () => {
    const { error } = await A.sb.rpc('claim_push_batch', { p_limit: 5 })
    assert.ok(error, 'members must not claim pushes')
    const { data, error: e2 } = await admin.rpc('claim_push_batch', { p_limit: 500 })
    assert.ok(!e2, e2?.message)
    assert.ok(Array.isArray(data))
  })

  await step('calendar feed works by secret token only', async () => {
    const [{ calendar_token }] = await q(`select calendar_token from public.profiles where id = $1`, [A.id])
    const anon = createClient(URL_, PUBLIC_KEY, { auth: { persistSession: false } })
    const { data, error } = await anon.rpc('calendar_feed', { p_token: calendar_token })
    assert.ok(!error, error?.message)
    assert.ok(data.length > 0)
    const { data: none } = await anon.rpc('calendar_feed', { p_token: crypto.randomUUID() })
    assert.equal(none.length, 0)
  })

  console.log(`\n${passed} checks passed.`)
}

try {
  await main()
} finally {
  if (!KEEP && !CLEANUP_ONLY) {
    const n = await cleanup().catch((e) => { console.error('cleanup failed:', e.message); return 0 })
    console.log(`Cleaned up ${n} e2e member(s).`)
  }
  await db.end()
}
