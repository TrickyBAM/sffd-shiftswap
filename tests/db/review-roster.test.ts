// Adversarial review — roster auto-approval (ARCHITECTURE §6.2, §6.4).
//
// Every test in this file demonstrates a defect found in review. They are
// expected to FAIL against the current migrations and to pass once fixed.

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { RANKS, createTestDb, type Rank, type TestDb } from './harness'

let t: TestDb

beforeAll(async () => {
  t = await createTestDb()
  // Admins exist in a real deployment; keep notify_admins realistic.
  await t.createMember({ role: 'admin', fullName: 'Admin Review' })
})

afterAll(async () => {
  await t?.close()
})

/** Random letters, so every test gets its own surname (roster matching is global). */
function letters(n = 10): string {
  let out = ''
  for (let i = 0; i < n; i++) out += String.fromCharCode(97 + Math.floor(Math.random() * 26))
  return out
}
function surname(base: string): string {
  return `${base}${letters()}`
}

interface RosterInput {
  first: string
  last: string
  employeeId?: string | null
  rank?: Rank | null
  station?: number | null
  tour?: number | null
  email?: string | null
}

async function addRoster(r: RosterInput): Promise<string> {
  const row = await t.one<{ id: string }>(
    `insert into public.roster (first_name, last_name, first_key, last_key, employee_id, rank, station, tour, email)
     values ($1, $2, public.name_key($1), public.name_key($2), $3, $4, $5, $6, $7) returning id`,
    [r.first, r.last, r.employeeId ?? null, r.rank ?? null, r.station ?? null, r.tour ?? null, r.email ?? null],
  )
  return row.id
}

interface Guess {
  fullName: string
  rank: Rank
  station: number
  tour: number | null
  employeeId?: string | null
}

function onboard(userId: string, g: Guess) {
  return t.rpc<{ status: string; matched: boolean }>(userId, 'complete_onboarding', {
    p_full_name: g.fullName,
    p_phone: '415-555-0142',
    p_rank: g.rank,
    p_station: g.station,
    p_tour: g.tour,
    p_employee_id: g.employeeId ?? null,
  })
}

/**
 * The applicant's own profile row exactly as the API lets them read it: only
 * the columns the `authenticated` role may SELECT, through RLS. Works whether
 * a fix hides a column (column grants) or moves the data elsewhere.
 */
async function readableOwnProfile(userId: string): Promise<Record<string, unknown>> {
  const cols = await t.query<{ attname: string }>(
    `select a.attname
       from pg_attribute a
      where a.attrelid = 'public.profiles'::regclass and a.attnum > 0 and not a.attisdropped
        and has_column_privilege('authenticated', a.attrelid, a.attnum, 'SELECT')
      order by a.attnum`,
  )
  if (cols.length === 0) return {}
  const list = cols.map((c) => `"${c.attname}"`).join(', ')
  const rows = await t.asUser(userId, (q) => q(`select ${list} from public.profiles where id = $1`, [userId]))
  return rows[0] ?? {}
}

describe('review: roster data must not reach applicants (§6.2 roster is admin-only)', () => {
  it('an applicant cannot read the roster candidate\'s station or which details differ from their own profile', async () => {
    const last = surname('Probe')
    // The real member is a Captain at Station 2 on Tour 7.
    await addRoster({ first: 'Olga', last, rank: 'Captain', station: 2, tour: 7 })

    // Someone who only knows the name signs up and guesses.
    const id = await t.createAuthUser(`${letters()}@example.test`, `Olga ${last}`)
    const result = await onboard(id, { fullName: `Olga ${last}`, rank: 'Firefighter', station: 19, tour: 5 })
    expect(result.status).toBe('pending')

    const visible = JSON.stringify(await readableOwnProfile(id))
    // Today status_reason is readable and says:
    //   "Roster: Olga <last>, Station 2 — rank, station, tour differ"
    expect(visible, 'roster station leaked to the applicant').not.toContain('Station 2')
    expect(visible, 'roster comparison result leaked to the applicant').not.toMatch(/\bdiffers?\b/)
  })

  it('an applicant who only knows a name cannot steer themselves to auto-approval using status_reason', async () => {
    const last = surname('Target')
    // Victim's roster row: no employee ID or email, so rank/station/tour decide.
    const rosterId = await addRoster({ first: 'Vera', last, rank: 'Lieutenant', station: 36, tour: 23 })

    const attacker = await t.createAuthUser(`${letters()}@example.test`, `Vera ${last}`)
    const guess: Guess = { fullName: `Vera ${last}`, rank: 'Firefighter', station: 19, tour: 1 }

    // What the attacker can see after each attempt (via GET /rest/v1/profiles).
    const reason = async () => String((await readableOwnProfile(attacker)).status_reason ?? '')
    const differing = async () => (await reason()).split('—')[1] ?? ''

    let calls = 0
    let status = (await onboard(attacker, guess)).status
    calls++

    // 1. The roster's station is printed in the reason.
    const station = /Station (\d+) —/.exec(await reason())
    if (station && status !== 'approved') {
      guess.station = Number(station[1])
      status = (await onboard(attacker, guess)).status
      calls++
    }
    // 2. Walk the ranks until "rank" drops out of the differences.
    for (const rank of RANKS) {
      if (status === 'approved' || !(await differing()).includes('rank')) break
      guess.rank = rank
      status = (await onboard(attacker, guess)).status
      calls++
    }
    // 3. Walk the tours until "tour" drops out.
    for (let tour = 1; tour <= 31; tour++) {
      if (status === 'approved' || !(await differing()).includes('tour')) break
      guess.tour = tour
      status = (await onboard(attacker, guess)).status
      calls++
    }

    const profile = await t.one(`select status, roster_id from public.profiles where id = $1`, [attacker])
    const roster = await t.one(`select claimed_by from public.roster where id = $1`, [rosterId])
    // Today: approved as "Vera <last>" after ~30 calls, and the real Vera's
    // roster row is claimed by the attacker.
    expect(
      { status: profile.status, claimedByAttacker: roster.claimed_by === attacker },
      `guided attempts: ${calls}`,
    ).toEqual({ status: 'pending', claimedByAttacker: false })
  })
})

describe('review: roster attributes the applicant leaves out (§6.4 step 3)', () => {
  it('a roster row with an employee ID is not auto-approved when the applicant leaves the employee ID blank', async () => {
    const last = surname('Blank')
    // Rank and station are easy to know about a colleague; the employee ID is not.
    await addRoster({ first: 'Quinn', last, employeeId: 'E-77810', rank: 'Firefighter', station: 19 })

    const id = await t.createAuthUser(`${letters()}@example.test`, `Quinn ${last}`)
    const result = await onboard(id, { fullName: `Quinn ${last}`, rank: 'Firefighter', station: 19, tour: 5, employeeId: null })

    // §6.4: "compare every attribute the roster row has … Any mismatch ⇒ no
    // auto-approve". Today the missing employee ID is skipped, so rank +
    // station (2 matches) auto-approve.
    expect(result.status).toBe('pending')
  })
})
