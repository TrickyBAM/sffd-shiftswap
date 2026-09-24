// Shared helpers for the live smoke scripts (scripts/smoke/*.mjs).
//
// Talks to the real Supabase project: a direct Postgres connection (setup and
// cleanup), the secret-key admin client (creating throwaway users) and
// per-member publishable-key clients (acting exactly like the browser app).
// Every member created here has an e2e-<letters>@example.com email so
// cleanup() can find and remove all of it.
import crypto from 'node:crypto'
import pg from 'pg'
import { createClient } from '@supabase/supabase-js'
import { loadEnv, connectionString, clientConfig } from '../db/_env.mjs'

loadEnv()
export const env = process.env
export const SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL
export const PUBLIC_KEY = env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const SECRET_KEY = env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY
if (!SUPABASE_URL || !PUBLIC_KEY || !SECRET_KEY) {
  throw new Error('Missing Supabase env vars — run `vercel env pull .env.local`.')
}

const conn = connectionString(env)
if (!conn) throw new Error('No POSTGRES_URL_NON_POOLING / DATABASE_URL configured.')
export const db = new pg.Client(clientConfig(conn.url))
export const admin = createClient(SUPABASE_URL, SECRET_KEY, { auth: { persistSession: false, autoRefreshToken: false } })

const E2E_EMAIL = /^e2e-[a-z]+@example\.com$/

export const letters = (n) => Array.from(crypto.randomBytes(n), (b) => String.fromCharCode(97 + (b % 26))).join('')
export const q = async (sql, params = []) => (await db.query(sql, params)).rows

/** Calls an RPC as the given client; throws an Error carrying the Postgres hint code. */
export async function rpc(sb, fn, args = {}) {
  const { data, error } = await sb.rpc(fn, args)
  if (error) {
    const e = new Error(`${fn}: ${error.message} [${error.hint ?? error.code}]`)
    e.hint = error.hint
    throw e
  }
  return data
}

/** Creates a confirmed throwaway user and a signed-in publishable-key client for them. */
export async function makeMember(label) {
  const email = `e2e-${letters(10)}@example.com`
  const password = `${letters(12)}A1!`
  const fullName = `${label} ${letters(1).toUpperCase()}${letters(6)}`
  const { data, error } = await admin.auth.admin.createUser({
    email, password, email_confirm: true, user_metadata: { full_name: fullName, phone: '415-555-0100' },
  })
  if (error) throw error
  const sb = createClient(SUPABASE_URL, PUBLIC_KEY, { auth: { persistSession: false, autoRefreshToken: false } })
  const { error: signInError } = await sb.auth.signInWithPassword({ email, password })
  if (signInError) throw signInError
  return { id: data.user.id, email, password, fullName, sb }
}

/** Deletes every row belonging to e2e members, then the members themselves. */
export async function cleanup() {
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
    await db.query(`delete from public.roster where claimed_by = any($1) or created_by = any($1)`, [ids])
    await db.query(`delete from auth.users where id = any($1)`, [ids])
    await db.query('commit')
  } catch (err) {
    await db.query('rollback')
    throw err
  }
  return ids.length
}

/** Tour-based dates: D = A works & B off, R = B works & A off (R after D), D2 = another A day. */
export async function pickDates(tourA, tourB) {
  const [{ d: today }] = await q(`select public.today_pt()::text as d`)
  const days = await q(
    `select d::date::text as d, public.tour_works($1::smallint, d::date) as a, public.tour_works($2::smallint, d::date) as b
       from generate_series($3::date + 3, $3::date + 60, interval '1 day') d`, [tourA, tourB, today])
  const D = days.find((r) => r.a && !r.b).d
  const R = days.find((r) => r.b && !r.a && r.d > D).d
  const D2 = days.find((r) => r.a && !r.b && r.d > R).d
  return { today, D, R, D2 }
}

/** Makes a member an approved, acknowledged admin directly in the database. */
export async function promoteToAdmin(member, { rank = 'Captain', station = 2, battalion = 1, division = 2, tour = 10 } = {}) {
  await q(`update public.profiles set role = 'admin', status = 'approved', approved_at = now(), rank = $2,
             station = $3, battalion = $4, division = $5, tour = $6, full_name = $7, phone = '415-555-0100'
           where id = $1`, [member.id, rank, station, battalion, division, tour, member.fullName])
  await rpc(member.sb, 'acknowledge_telestaff')
}
