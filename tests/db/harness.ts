// PGlite test harness for the database (ARCHITECTURE §2, §6).
//
// createTestDb() boots an in-memory Postgres (PGlite, Postgres 18 in WASM),
// applies tests/db/supabase-stub.sql and then every supabase/migrations/*.sql
// file in filename order — the same files scripts/db/migrate.mjs applies to
// Supabase. Use one instance per test file (beforeAll) and isolate tests by
// creating fresh members for each test.
//
// Role switching mirrors PostgREST: `SET ROLE anon|authenticated|service_role`
// plus the request.jwt.claims setting that auth.uid() reads. All statements go
// through one queue, so concurrent helper calls can never interleave roles.

import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { PGlite, types } from '@electric-sql/pglite'
import { expect } from 'vitest'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..', '..')
const MIGRATIONS_DIR = path.join(ROOT, 'supabase', 'migrations')
const STUB_FILE = path.join(HERE, 'supabase-stub.sql')

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type Row = Record<string, unknown>
/**
 * A user id (authenticated), null (anon), 'service' (service_role), or
 * NO_SUB — the authenticated role with a JWT that has no `sub` (auth.uid() is null).
 */
export type Actor = string | null | 'service'

export const NO_SUB = ''
export type QueryFn = <T extends Row = Row>(sql: string, params?: unknown[]) => Promise<T[]>

export const RANKS = [
  'Firefighter',
  'Paramedic',
  'Lieutenant',
  'Captain',
  'Battalion Chief',
  'Division Chief',
] as const
export type Rank = (typeof RANKS)[number]
export type MemberStatus = 'onboarding' | 'pending' | 'approved' | 'rejected' | 'suspended'
export type NotifyScope = 'off' | 'station' | 'battalion' | 'division' | 'all'
export type ShiftType = '24-Hour' | 'PM'
export type AcceptLimit = 'anyone' | 'division' | 'battalion' | 'station'

export interface MemberOptions {
  fullName?: string
  email?: string
  phone?: string
  rank?: Rank
  station?: number
  /** null = "No tour". Default 1. */
  tour?: number | null
  employeeId?: string | null
  role?: 'member' | 'admin'
  status?: MemberStatus
  /** TeleStaff acknowledged. Default true. */
  ack?: boolean
  notifyScope?: NotifyScope
}

export interface Member {
  id: string
  email: string
  fullName: string
  phone: string
  rank: Rank
  station: number
  battalion: number
  division: number
  tour: number | null
  role: 'member' | 'admin'
  status: MemberStatus
}

export interface ShiftOptions {
  poster: Member | string
  date: string
  shiftType?: ShiftType
  status?: 'open' | 'covered' | 'cancelled'
  coverer?: Member | string | null
  returnDates?: string[]
  acceptLimit?: AcceptLimit
  /** Defaults to the poster's station. */
  station?: number
  notes?: string | null
  returnLegOf?: string | null
  /** e.g. "8 days" — backdates created_at. */
  createdAgo?: string
}

/** Error thrown by PGlite for a failed statement. */
export interface DbError extends Error {
  code?: string
  hint?: string
  detail?: string
}

export interface TestDb {
  db: PGlite
  /** Superuser query (bypasses RLS and grants). */
  query: QueryFn
  /** First row of a superuser query (throws when there is none). */
  one<T extends Row = Row>(sql: string, params?: unknown[]): Promise<T>
  /** Run fn with the given actor's role and JWT claims; RESET afterwards. */
  as<T>(actor: Actor, fn: (q: QueryFn) => Promise<T>): Promise<T>
  asUser<T>(userId: string, fn: (q: QueryFn) => Promise<T>): Promise<T>
  asAnon<T>(fn: (q: QueryFn) => Promise<T>): Promise<T>
  asService<T>(fn: (q: QueryFn) => Promise<T>): Promise<T>
  /**
   * Call public.<name>(k => v, …) as the actor, like supabase.rpc(). Returns
   * the rows for set-returning functions, otherwise the scalar result.
   */
  rpc<T = unknown>(actor: Actor, name: string, args?: Record<string, unknown>): Promise<T>
  /**
   * Insert a confirmed account into auth.users, like the app's sign-up
   * (admin.createUser with email_confirm: true); the trigger creates the
   * profile. Returns the id.
   */
  createAuthUser(email: string, fullName: string): Promise<string>
  /** A member set up directly in SQL: approved + acknowledged by default. */
  createMember(opts?: MemberOptions): Promise<Member>
  /** Insert a shift directly (any date/status, e.g. past shifts); returns its id. */
  createShift(opts: ShiftOptions): Promise<string>
  /** A user's notifications, newest first, optionally of one type. */
  notificationsFor(userId: string, type?: string): Promise<Row[]>
  close(): Promise<void>
}

// ---------------------------------------------------------------------------
// Dates (America/Los_Angeles calendar days as YYYY-MM-DD; never new Date(ymd))
// ---------------------------------------------------------------------------

const PT_DATE = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Los_Angeles',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

function ymdToDayNumber(ymd: string): number {
  const [y, m, d] = ymd.split('-').map(Number)
  return Math.round(Date.UTC(y, m - 1, d) / 86_400_000)
}

function dayNumberToYmd(n: number): string {
  return new Date(n * 86_400_000).toISOString().slice(0, 10)
}

/** Today's date in San Francisco. */
export function todayPT(): string {
  return PT_DATE.format(new Date())
}

export function addDays(ymd: string, days: number): string {
  return dayNumberToYmd(ymdToDayNumber(ymd) + days)
}

export function diffDays(a: string, b: string): number {
  return ymdToDayNumber(a) - ymdToDayNumber(b)
}

/** today + n days (PT). */
export function daysFromToday(n: number): string {
  return addDays(todayPT(), n)
}

const TOUR1_OFFSETS = new Set([0, 3, 6, 10, 13, 16, 20, 23, 26])
const EPOCH = ymdToDayNumber('2019-01-01')

/** Independent JS copy of the tour rule (ARCHITECTURE §4) for building fixtures. */
export function tourWorks(tour: number | null | undefined, ymd: string): boolean {
  if (tour == null || tour < 1 || tour > 31) return false
  const i = (((ymdToDayNumber(ymd) - EPOCH - (tour - 1)) % 31) + 31) % 31
  return TOUR1_OFFSETS.has(i)
}

/**
 * The first date at or after today + fromOffset (skipping `skip` matches) that
 * satisfies the predicate. Throws if none is found within 170 days.
 */
export function findDate(predicate: (ymd: string) => boolean, fromOffset = 2, skip = 0): string {
  let remaining = skip
  for (let offset = fromOffset; offset <= 170; offset++) {
    const ymd = daysFromToday(offset)
    if (predicate(ymd)) {
      if (remaining === 0) return ymd
      remaining--
    }
  }
  throw new Error('findDate: no matching date within 170 days')
}

/** A future day the tour works (≥ today + fromOffset). */
export function tourDay(tour: number, fromOffset = 2, skip = 0): string {
  return findDate((d) => tourWorks(tour, d), fromOffset, skip)
}

/** A future day the tour is off (≥ today + fromOffset). */
export function offDay(tour: number, fromOffset = 2, skip = 0): string {
  return findDate((d) => !tourWorks(tour, d), fromOffset, skip)
}

// ---------------------------------------------------------------------------
// Assertions
// ---------------------------------------------------------------------------

async function captureError(promise: Promise<unknown>): Promise<DbError | undefined> {
  try {
    await promise
  } catch (error) {
    return error as DbError
  }
  return undefined
}

/** Asserts the RPC failed with a friendly error (P0001) carrying `hint`. */
export async function expectRpcError(promise: Promise<unknown>, hint: string): Promise<DbError> {
  const error = await captureError(promise)
  expect(error, `expected the call to fail with hint ${hint}`).toBeDefined()
  expect({ code: error!.code, hint: error!.hint, message: error!.message }).toMatchObject({
    code: 'P0001',
    hint,
  })
  expect(error!.message.length).toBeGreaterThan(0)
  return error!
}

/** Asserts the statement was refused by privileges/RLS (SQLSTATE 42501). */
export async function expectDenied(promise: Promise<unknown>): Promise<DbError> {
  const error = await captureError(promise)
  expect(error, 'expected permission to be denied').toBeDefined()
  expect({ code: error!.code, message: error!.message }).toMatchObject({ code: '42501' })
  return error!
}

// ---------------------------------------------------------------------------
// createTestDb
// ---------------------------------------------------------------------------

/** Migration files in apply order. */
export function migrationFiles(): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((name) => /^\d{4}_.+\.sql$/.test(name))
    .sort()
}

let uniqueCounter = 0
/** A process-unique suffix for emails/names. */
export function unique(): string {
  uniqueCounter += 1
  return `${Date.now().toString(36)}${uniqueCounter}${Math.random().toString(36).slice(2, 6)}`
}

// Letters only, so generated names survive name_key() intact.
function letterTag(): string {
  const n = unique()
  let out = ''
  for (const ch of n) out += String.fromCharCode(97 + (ch.charCodeAt(0) % 26))
  return out.charAt(0).toUpperCase() + out.slice(1)
}

export async function createTestDb(): Promise<TestDb> {
  const db = new PGlite({
    // Keep DATE values as 'YYYY-MM-DD' strings (never JS Dates, see §3).
    parsers: { [types.DATE]: (value: string) => value },
  })

  await db.exec(readFileSync(STUB_FILE, 'utf8'))
  for (const file of migrationFiles()) {
    const sql = readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8')
    try {
      await db.transaction(async (tx) => {
        await tx.exec(sql)
      })
    } catch (error) {
      const e = error as DbError
      throw new Error(`Migration ${file} failed: ${e.message}`)
    }
  }

  // One queue for every statement: role switches must not interleave.
  let queue: Promise<unknown> = Promise.resolve()
  function exclusive<T>(fn: () => Promise<T>): Promise<T> {
    const run = queue.then(fn, fn)
    queue = run.catch(() => undefined)
    return run
  }

  const raw: QueryFn = async <T extends Row = Row>(sql: string, params: unknown[] = []) => {
    const result = await db.query<T>(sql, params)
    return result.rows
  }

  const query: QueryFn = <T extends Row = Row>(sql: string, params: unknown[] = []) =>
    exclusive(() => raw<T>(sql, params))

  async function one<T extends Row = Row>(sql: string, params: unknown[] = []): Promise<T> {
    const rows = await query<T>(sql, params)
    if (rows.length === 0) throw new Error(`Expected a row from: ${sql}`)
    return rows[0]
  }

  function as<T>(actor: Actor, fn: (q: QueryFn) => Promise<T>): Promise<T> {
    let role: string
    let claims: Record<string, unknown>
    if (actor === 'service') {
      role = 'service_role'
      claims = { role: 'service_role' }
    } else if (actor === null) {
      role = 'anon'
      claims = { role: 'anon' }
    } else if (actor === NO_SUB) {
      role = 'authenticated'
      claims = { role: 'authenticated' }
    } else {
      role = 'authenticated'
      claims = { sub: actor, role: 'authenticated', aud: 'authenticated' }
    }
    return exclusive(async () => {
      await db.query(`select set_config('request.jwt.claims', $1, false)`, [JSON.stringify(claims)])
      await db.exec(`set role ${role}`)
      try {
        return await fn(raw)
      } finally {
        await db.exec('reset role')
        await db.query(`select set_config('request.jwt.claims', '', false)`)
      }
    })
  }

  const retsetCache = new Map<string, boolean>()
  async function isSetReturning(name: string): Promise<boolean> {
    const cached = retsetCache.get(name)
    if (cached !== undefined) return cached
    const rows = await query<{ proretset: boolean }>(
      `select p.proretset from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = $1`,
      [name],
    )
    if (rows.length === 0) throw new Error(`No function public.${name}`)
    retsetCache.set(name, rows[0].proretset)
    return rows[0].proretset
  }

  async function rpc<T = unknown>(actor: Actor, name: string, args: Record<string, unknown> = {}): Promise<T> {
    if (!/^[a-z_][a-z0-9_]*$/.test(name)) throw new Error(`Bad function name ${name}`)
    const keys = Object.keys(args)
    for (const key of keys) if (!/^[a-z_][a-z0-9_]*$/.test(key)) throw new Error(`Bad argument ${key}`)
    const list = keys.map((key, i) => `${key} => $${i + 1}`).join(', ')
    const values = keys.map((key) => args[key])
    const retset = await isSetReturning(name)
    const sql = retset
      ? `select * from public.${name}(${list})`
      : `select public.${name}(${list}) as result`
    const rows = await as(actor, (q) => q(sql, values))
    return (retset ? rows : (rows[0] as Row).result) as T
  }

  async function createAuthUser(email: string, fullName: string): Promise<string> {
    const row = await one<{ id: string }>(
      `insert into auth.users (email, email_confirmed_at, raw_user_meta_data) values ($1, now(), $2) returning id`,
      [email, { full_name: fullName }],
    )
    return row.id
  }

  async function createMember(opts: MemberOptions = {}): Promise<Member> {
    const tag = letterTag()
    const fullName = opts.fullName ?? `Test ${tag}`
    const email = opts.email ?? `member.${unique()}@example.test`
    const rank = opts.rank ?? 'Firefighter'
    const station = opts.station ?? 19
    const tour = opts.tour === undefined ? 1 : opts.tour
    const role = opts.role ?? 'member'
    const status = opts.status ?? 'approved'
    const phone = opts.phone ?? '(415) 555-0100'
    const id = await createAuthUser(email, fullName)

    if (status === 'onboarding') {
      return { id, email, fullName, phone, rank, station, battalion: 0, division: 0, tour, role, status }
    }

    const row = await one<{ battalion: number; division: number }>(
      `update public.profiles p
          set full_name = $2, phone = $3, rank = $4, station = s.station, battalion = s.battalion,
              division = s.division, tour = $5, employee_id = $6, status = $7, role = $8,
              telestaff_ack_at = case when $9::boolean then now() end,
              approved_at = case when $7 = 'approved' then now() end,
              notify_scope = $10
         from public.stations s
        where p.id = $1 and s.station = $11
       returning p.battalion, p.division`,
      [
        id,
        fullName,
        phone,
        rank,
        tour,
        opts.employeeId ?? null,
        status,
        role,
        opts.ack ?? true,
        opts.notifyScope ?? 'battalion',
        station,
      ],
    )
    return { id, email, fullName, phone, rank, station, battalion: row.battalion, division: row.division, tour, role, status }
  }

  async function createShift(opts: ShiftOptions): Promise<string> {
    const posterId = typeof opts.poster === 'string' ? opts.poster : opts.poster.id
    const covererId = opts.coverer == null ? null : typeof opts.coverer === 'string' ? opts.coverer : opts.coverer.id
    const status = opts.status ?? (covererId ? 'covered' : 'open')
    const row = await one<{ id: string }>(
      `insert into public.shifts (
         poster_id, poster_name, rank, station, battalion, division, date, shift_type, hours, starts_at,
         status, return_dates, accept_limit, notes, coverer_id, coverer_name, confirmed_at, return_leg_of, created_at)
       select p.id, p.full_name, p.rank, s.station, s.battalion, s.division, $2::date, $3::text,
              case when $3::text = '24-Hour' then 24 else 16 end, public.shift_starts_at($2::date, $3::text),
              $4, $5::date[], $6, $7, c.id, c.full_name, case when c.id is not null then now() end, $9::uuid,
              now() - coalesce($10::interval, interval '0')
         from public.profiles p
         join public.stations s on s.station = coalesce($8::int, p.station)
         left join public.profiles c on c.id = $11::uuid
        where p.id = $1
       returning id`,
      [
        posterId,
        opts.date,
        opts.shiftType ?? '24-Hour',
        status,
        opts.returnDates ?? [],
        opts.acceptLimit ?? 'anyone',
        opts.notes ?? null,
        opts.station ?? null,
        opts.returnLegOf ?? null,
        opts.createdAgo ?? null,
        covererId,
      ],
    )
    return row.id
  }

  function notificationsFor(userId: string, type?: string): Promise<Row[]> {
    return query(
      `select * from public.notifications
        where user_id = $1 and ($2::text is null or type = $2)
        order by created_at desc, id`,
      [userId, type ?? null],
    )
  }

  return {
    db,
    query,
    one,
    as,
    asUser: (userId, fn) => as(userId, fn),
    asAnon: (fn) => as(null, fn),
    asService: (fn) => as('service', fn),
    rpc,
    createAuthUser,
    createMember,
    createShift,
    notificationsFor,
    close: () => exclusive(() => db.close()),
  }
}
