// Schema-level behaviour: pure helpers, station seed, auth trigger, updated_at
// triggers and table constraints (ARCHITECTURE §3, §4, §5, §6.1).

import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createTestDb, daysFromToday, migrationFiles, todayPT, tourDay, tourWorks, type TestDb } from './harness'

let t: TestDb

beforeAll(async () => {
  t = await createTestDb()
})

afterAll(async () => {
  await t?.close()
})

describe('public.today_pt', () => {
  it('is today in America/Los_Angeles', async () => {
    const row = await t.one<{ d: string }>('select public.today_pt() as d')
    expect(row.d).toBe(todayPT())
  })
})

describe('public.shift_starts_at', () => {
  it('starts 24-Hour shifts at 08:00 and PM shifts at 16:00 Pacific (PDT)', async () => {
    const row = await t.one<{ a: Date; b: Date }>(
      `select public.shift_starts_at('2026-09-23', '24-Hour') as a, public.shift_starts_at('2026-09-23', 'PM') as b`,
    )
    expect(row.a.toISOString()).toBe('2026-09-23T15:00:00.000Z')
    expect(row.b.toISOString()).toBe('2026-09-23T23:00:00.000Z')
  })

  it('follows standard time in winter and the DST switch days', async () => {
    const row = await t.one<{ winter: Date; spring: Date; fall: Date }>(
      `select public.shift_starts_at('2026-12-01', '24-Hour') as winter,
              public.shift_starts_at('2026-03-08', '24-Hour') as spring,
              public.shift_starts_at('2026-11-01', 'PM') as fall`,
    )
    expect(row.winter.toISOString()).toBe('2026-12-01T16:00:00.000Z')
    expect(row.spring.toISOString()).toBe('2026-03-08T15:00:00.000Z')
    expect(row.fall.toISOString()).toBe('2026-11-02T00:00:00.000Z')
  })

  it('is null for an unknown shift type', async () => {
    const row = await t.one<{ x: Date | null }>(`select public.shift_starts_at('2026-09-23', 'Night') as x`)
    expect(row.x).toBeNull()
  })
})

describe('public.tour_works', () => {
  it('has tours {2,7,10,13,17,20,23,27,30} on duty on 2026-09-23 (Watch 2)', async () => {
    const rows = await t.query<{ tour: number }>(
      `select g.tour from generate_series(1, 31) as g(tour)
        where public.tour_works(g.tour::smallint, date '2026-09-23') order by 1`,
    )
    expect(rows.map((r) => r.tour)).toEqual([2, 7, 10, 13, 17, 20, 23, 27, 30])
  })

  it('puts exactly 9 tours on duty every day (2026–2027)', async () => {
    const rows = await t.query<{ n: number; days: number }>(
      `select n, count(*)::int as days from (
         select g.d, count(*) filter (where public.tour_works(tr.tour::smallint, g.d::date))::int as n
           from generate_series(date '2026-01-01', date '2027-12-31', interval '1 day') as g(d)
           cross join generate_series(1, 31) as tr(tour)
          group by g.d) x
        group by n`,
    )
    expect(rows).toEqual([{ n: 9, days: 730 }])
  })

  it('gives every tour exactly 9 shifts in any 31-day window', async () => {
    const rows = await t.query<{ tour: number; shifts: number }>(
      `select tr.tour, count(*)::int as shifts
         from generate_series(1, 31) as tr(tour)
         cross join generate_series(date '2026-09-10', date '2026-10-10', interval '1 day') as g(d)
        where public.tour_works(tr.tour::smallint, g.d::date)
        group by tr.tour`,
    )
    expect(rows).toHaveLength(31)
    for (const row of rows) expect(row.shifts, `tour ${row.tour}`).toBe(9)
  })

  it('agrees with the reference rule for every tour, 2019–2035 (every 5th day)', async () => {
    const rows = await t.query<{ d: string; tours: number[] }>(
      `select to_char(g.d, 'YYYY-MM-DD') as d,
              array(select tr from generate_series(1, 31) tr
                     where public.tour_works(tr::smallint, g.d::date) order by tr) as tours
         from generate_series(date '2019-01-01', date '2035-12-31', interval '5 days') as g(d)`,
    )
    expect(rows.length).toBeGreaterThan(1000)
    for (const row of rows) {
      const expected = Array.from({ length: 31 }, (_, i) => i + 1).filter((tour) => tourWorks(tour, row.d))
      expect(row.tours, row.d).toEqual(expected)
    }
  })

  it('matches the first cycle of the published tour calendars', async () => {
    const fixture = path.resolve(__dirname, '..', 'fixtures', 'tour-truth.json')
    if (!existsSync(fixture)) return
    const truth = JSON.parse(readFileSync(fixture, 'utf8')) as { tours: Record<string, string[]> }
    const rows = await t.query<{ tour: number; days: string[] }>(
      `select tr.tour, array_agg(to_char(g.d, 'YYYY-MM-DD') order by g.d) as days
         from generate_series(1, 31) as tr(tour)
         cross join generate_series(date '2019-01-01', date '2019-01-31', interval '1 day') as g(d)
        where public.tour_works(tr.tour::smallint, g.d::date)
        group by tr.tour order by tr.tour`,
    )
    for (const row of rows) {
      const firstCycle = truth.tours[String(row.tour)].filter((d) => d <= '2019-01-31')
      expect(row.days, `tour ${row.tour}`).toEqual(firstCycle)
    }
  })

  it('is false for no tour, out-of-range tours and null dates', async () => {
    const row = await t.one<Record<string, boolean>>(
      `select public.tour_works(null, date '2026-09-23') as a,
              public.tour_works(0::smallint, date '2026-09-23') as b,
              public.tour_works(32::smallint, date '2026-09-23') as c,
              public.tour_works(2::smallint, null) as d`,
    )
    expect(row).toEqual({ a: false, b: false, c: false, d: false })
  })
})

describe('public.name_key', () => {
  it('normalizes names like the TypeScript nameKey()', async () => {
    const cases: Array<[string | null, string]> = [
      ["O'Brien-Smith", 'obriensmith'],
      ['José', 'jose'],
      ['JOSÉ', 'jose'],
      ['Nuñez', 'nunez'],
      ['  Mary  Ann ', 'maryann'],
      ['Smith3', 'smith'],
      ['   ', ''],
      [null, ''],
    ]
    for (const [input, key] of cases) {
      const row = await t.one<{ k: string }>('select public.name_key($1) as k', [input])
      expect(row.k, String(input)).toBe(key)
    }
  })

  it('maps every accented letter in the canonical table (both cases)', async () => {
    const row = await t.one<{ lower: string; upper: string }>(
      `select public.name_key('áàâäãå éèêë íìîï óòôöõø úùûü ñ ç ý ÿ') as lower,
              public.name_key('ÁÀÂÄÃÅ ÉÈÊË ÍÌÎÏ ÓÒÔÖÕØ ÚÙÛÜ Ñ Ç Ý Ÿ') as upper`,
    )
    expect(row.lower).toBe('aaaaaaeeeeiiiioooooouuuuncyy')
    expect(row.upper).toBe('aaaaaaeeeeiiiioooooouuuuncyy')
  })

  it('agrees with every case in tests/fixtures/name-keys.json', async () => {
    const fixture = path.resolve(__dirname, '..', 'fixtures', 'name-keys.json')
    if (!existsSync(fixture)) return
    const shared = JSON.parse(readFileSync(fixture, 'utf8')) as { cases: Array<{ input: string; key: string }> }
    const rows = await t.query<{ input: string; key: string }>(
      'select u.input, public.name_key(u.input) as key from unnest($1::text[]) as u(input)',
      [shared.cases.map((c) => c.input)],
    )
    shared.cases.forEach((c, i) => expect(rows[i].key, JSON.stringify(c.input)).toBe(c.key))
  })
})

describe('stations seed', () => {
  it('has the 44 fire stations plus 3 airport stations', async () => {
    const row = await t.one<{ n: number; airport: number }>(
      `select count(*)::int as n, count(*) filter (where division = 4)::int as airport from public.stations`,
    )
    expect(row).toEqual({ n: 47, airport: 3 })
  })

  it('maps stations to battalions and divisions (ARCHITECTURE §5)', async () => {
    const rows = await t.query<{ station: number; battalion: number; division: number; label: string }>(
      `select station, battalion, division, label from public.stations where station in (2, 19, 44, 51, 101, 103) order by station`,
    )
    expect(rows).toEqual([
      { station: 2, battalion: 1, division: 2, label: 'Station 2' },
      { station: 19, battalion: 9, division: 3, label: 'Station 19' },
      { station: 44, battalion: 10, division: 3, label: 'Station 44' },
      { station: 51, battalion: 4, division: 2, label: 'Station 51' },
      { station: 101, battalion: 99, division: 4, label: 'Airport Station 1' },
      { station: 103, battalion: 99, division: 4, label: 'Airport Station 3' },
    ])
  })

  it('puts every battalion in exactly one division', async () => {
    const rows = await t.query<{ battalion: number; divisions: number }>(
      `select battalion, count(distinct division)::int as divisions from public.stations group by battalion order by battalion`,
    )
    expect(rows.map((r) => r.battalion)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 99])
    for (const row of rows) expect(row.divisions).toBe(1)
  })
})

describe('auth.users → profiles trigger', () => {
  it('creates an onboarding profile with a trimmed name and lower-cased email', async () => {
    const id = await t.createAuthUser('  Jane.DOE@Example.Test ', '   Jane    Q.   Doe  ')
    const p = await t.one(`select * from public.profiles where id = $1`, [id])
    expect(p).toMatchObject({
      email: 'jane.doe@example.test',
      full_name: 'Jane Q. Doe',
      status: 'onboarding',
      role: 'member',
      notify_scope: 'battalion',
      must_change_password: false,
      telestaff_ack_at: null,
      rank: null,
      station: null,
      tour: null,
    })
    expect(p.calendar_token).toMatch(/^[0-9a-f-]{36}$/)
  })

  it('truncates the name to 80 characters and tolerates missing metadata', async () => {
    const long = 'A'.repeat(50) + ' ' + 'B'.repeat(50)
    const id = await t.createAuthUser('long@example.test', long)
    const p = await t.one<{ full_name: string }>(`select full_name from public.profiles where id = $1`, [id])
    expect(p.full_name).toHaveLength(80)
    expect(p.full_name).toBe(long.slice(0, 80))

    const bare = await t.one<{ id: string }>(
      `insert into auth.users (email, email_confirmed_at) values (null, now()) returning id`,
    )
    const q = await t.one(`select email, full_name from public.profiles where id = $1`, [bare.id])
    expect(q).toEqual({ email: '', full_name: '' })
  })

  it('keeps profiles.email in step with auth.users.email', async () => {
    const id = await t.createAuthUser('old@example.test', 'Email Change')
    await t.query(`update auth.users set email = 'New@Example.Test' where id = $1`, [id])
    const p = await t.one<{ email: string }>(`select email from public.profiles where id = $1`, [id])
    expect(p.email).toBe('new@example.test')
  })

  it('deletes the profile with the auth user', async () => {
    const id = await t.createAuthUser('gone@example.test', 'Gone Soon')
    await t.query(`delete from auth.users where id = $1`, [id])
    const rows = await t.query(`select 1 from public.profiles where id = $1`, [id])
    expect(rows).toHaveLength(0)
  })

  it('pins search_path on the SECURITY DEFINER trigger function', async () => {
    const row = await t.one<{ secdef: boolean; config: string[] }>(
      `select prosecdef as secdef, proconfig as config from pg_proc where proname = 'handle_new_user'`,
    )
    expect(row.secdef).toBe(true)
    expect(row.config).toContain('search_path=""')
  })
})

describe('updated_at triggers', () => {
  it('bumps profiles.updated_at and shifts.updated_at on update', async () => {
    const m = await t.createMember()
    await t.query(`update public.profiles set updated_at = now() - interval '1 day' where id = $1`, [m.id])
    await t.query(`update public.profiles set phone = '415 555 0199' where id = $1`, [m.id])
    const p = await t.one<{ fresh: boolean }>(
      `select updated_at > now() - interval '1 minute' as fresh from public.profiles where id = $1`,
      [m.id],
    )
    expect(p.fresh).toBe(true)

    const shiftId = await t.createShift({ poster: m, date: tourDay(1) })
    await t.query(`update public.shifts set updated_at = now() - interval '1 day' where id = $1`, [shiftId])
    await t.query(`update public.shifts set notes = 'x' where id = $1`, [shiftId])
    const s = await t.one<{ fresh: boolean }>(
      `select updated_at > now() - interval '1 minute' as fresh from public.shifts where id = $1`,
      [shiftId],
    )
    expect(s.fresh).toBe(true)
  })
})

describe('table constraints', () => {
  it('rejects a coverer who is the poster, and covered/coverer mismatches', async () => {
    const a = await t.createMember()
    const b = await t.createMember({ tour: 2 })
    const date = tourDay(1)
    await expect(t.createShift({ poster: a, date, status: 'covered', coverer: a })).rejects.toThrow(/shifts_coverer_not_poster/)
    await expect(t.createShift({ poster: a, date, status: 'open', coverer: b })).rejects.toThrow(/shifts_covered_has_coverer/)
    await expect(t.createShift({ poster: a, date, status: 'covered' })).rejects.toThrow(/shifts_covered_has_coverer/)
  })

  it('allows one open/covered post per member per day, and one cover per day', async () => {
    const a = await t.createMember()
    const b = await t.createMember({ tour: 2 })
    const c = await t.createMember({ tour: 3 })
    const date = tourDay(1)
    await t.createShift({ poster: a, date })
    await expect(t.createShift({ poster: a, date })).rejects.toThrow(/shifts_one_post_per_day/)
    // a cancelled post doesn't block
    const d2 = tourDay(1, 2, 1)
    await t.createShift({ poster: a, date: d2, status: 'cancelled' })
    await t.createShift({ poster: a, date: d2 })

    await t.createShift({ poster: c, date: daysFromToday(40), coverer: b })
    await expect(t.createShift({ poster: a, date: daysFromToday(40), coverer: b })).rejects.toThrow(/shifts_one_cover_per_day/)
  })

  it('limits return dates to 10 with no nulls, and ties hours to the shift type', async () => {
    const a = await t.createMember({ tour: null })
    const eleven = Array.from({ length: 11 }, (_, i) => daysFromToday(60 + i))
    await expect(t.createShift({ poster: a, date: daysFromToday(50), returnDates: eleven })).rejects.toThrow(/shifts_return_dates_max/)
    await expect(
      t.query(
        `insert into public.shifts (poster_id, poster_name, rank, station, battalion, division, date, shift_type, hours, starts_at)
         values ($1, 'x', 'Firefighter', 19, 9, 3, $2, 'PM', 24, now())`,
        [a.id, daysFromToday(51)],
      ),
    ).rejects.toThrow(/shifts_hours_match_type/)
  })

  it('checks notification types, message bodies and request statuses', async () => {
    const a = await t.createMember()
    await expect(
      t.query(`insert into public.notifications (user_id, type, title, body) values ($1, 'spam', 't', 'b')`, [a.id]),
    ).rejects.toThrow(/notifications_type_check/)
    const shiftId = await t.createShift({ poster: a, date: tourDay(1, 30) })
    const b = await t.createMember({ tour: 2 })
    await expect(
      t.query(`insert into public.messages (shift_id, sender_id, recipient_id, body) values ($1, $2, $3, '')`, [shiftId, a.id, b.id]),
    ).rejects.toThrow(/messages_body_check/)
    await expect(
      t.query(
        `insert into public.shift_requests (shift_id, requester_id, requester_name, requester_rank, requester_station, status)
         values ($1, $2, 'x', 'Firefighter', 19, 'maybe')`,
        [shiftId, b.id],
      ),
    ).rejects.toThrow(/shift_requests_status_check/)
  })
})

describe('error hint codes', () => {
  it('uses only the codes listed in ARCHITECTURE §6.6', () => {
    const allowed = new Set([
      'NOT_SIGNED_IN', 'NOT_APPROVED', 'NOT_ADMIN', 'ACK_REQUIRED', 'INVALID_INPUT', 'NOT_FOUND', 'OWN_SHIFT',
      'NOT_OPEN', 'STARTED', 'TOO_FAR_AHEAD', 'RANK_MISMATCH', 'OUTSIDE_LIMIT', 'YOU_WORK_THAT_DAY',
      'NOT_YOUR_SHIFT_DAY', 'ALREADY_POSTED', 'ALREADY_COVERING', 'ALREADY_REQUESTED', 'RETURN_DATE_REQUIRED',
      'RETURN_DATE_INVALID', 'RETURN_NOT_YOUR_DAY', 'POSTER_WORKS_RETURN_DAY', 'NOT_PARTICIPANT',
      'NO_CANCEL_PENDING', 'LAST_ADMIN',
    ])
    const dir = path.resolve(__dirname, '..', '..', 'supabase', 'migrations')
    const used = new Set<string>()
    for (const file of migrationFiles()) {
      const sql = readFileSync(path.join(dir, file), 'utf8')
      for (const m of sql.matchAll(/'([A-Z][A-Z_]{3,})'/g)) used.add(m[1])
    }
    expect([...used].filter((code) => !allowed.has(code))).toEqual([])
    expect([...allowed].filter((code) => !used.has(code))).toEqual([])
  })
})

describe('internal schema', () => {
  it('has private.app_config, private.signup_attempts and private.schema_migrations', async () => {
    const rows = await t.query<{ table_name: string }>(
      `select table_name from information_schema.tables where table_schema = 'private' order by 1`,
    )
    expect(rows.map((r) => r.table_name)).toEqual(['app_config', 'schema_migrations', 'signup_attempts'])
  })
})
