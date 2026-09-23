// Onboarding, roster auto-approval and the member's own profile RPCs
// (ARCHITECTURE §6.3 "Onboarding & profile", §6.4).

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { NO_SUB, createTestDb, expectRpcError, type Member, type Rank, type TestDb } from './harness'

let t: TestDb
let admin: Member

beforeAll(async () => {
  t = await createTestDb()
  admin = await t.createMember({ role: 'admin', fullName: 'Admin Onboarding' })
})

afterAll(async () => {
  await t?.close()
})

/** Random letters, so every test gets its own surname (roster matching is global). */
function letters(n = 8): string {
  let out = ''
  for (let i = 0; i < n; i++) out += String.fromCharCode(97 + Math.floor(Math.random() * 26))
  return out
}
function surname(base = 'Smith'): string {
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

interface OnboardInput {
  fullName: string
  phone?: string
  rank?: Rank
  station?: number
  tour?: number | null
  employeeId?: string | null
}

async function newApplicant(fullName: string, email?: string): Promise<{ id: string; email: string }> {
  const e = email ?? `${letters()}@example.test`
  const id = await t.createAuthUser(e, fullName)
  return { id, email: e }
}

function onboard(userId: string, input: OnboardInput) {
  return t.rpc<{ status: string; matched: boolean; message: string }>(userId, 'complete_onboarding', {
    p_full_name: input.fullName,
    p_phone: input.phone ?? '415-555-0142',
    p_rank: input.rank ?? 'Firefighter',
    p_station: input.station ?? 19,
    p_tour: input.tour === undefined ? 5 : input.tour,
    p_employee_id: input.employeeId ?? null,
  })
}

async function profile(id: string) {
  return t.one(`select * from public.profiles where id = $1`, [id])
}

interface PendingAudit {
  roster_note: string | null
  roster_id: string | null
  attempt: number
  auto_approve_blocked: boolean
}

/** Details of the applicant's latest `member.pending` audit entry (what admins see). */
async function latestPendingAudit(id: string): Promise<PendingAudit | null> {
  const rows = await t.query<{ details: PendingAudit }>(
    `select details from public.audit_log
      where target_type = 'profile' and target_id = $1 and action = 'member.pending'
      order by id desc limit 1`,
    [id],
  )
  return rows[0]?.details ?? null
}

/** The roster note admins see for a pending applicant (never shown to the applicant). */
async function rosterNote(id: string): Promise<string | null> {
  return (await latestPendingAudit(id))?.roster_note ?? null
}

describe('complete_onboarding: access and validation', () => {
  it('requires a session', async () => {
    await expectRpcError(onboard(NO_SUB, { fullName: 'No Session' }), 'NOT_SIGNED_IN')
  })

  it('rejects bad input with INVALID_INPUT', async () => {
    const a = await newApplicant('Val Idate')
    const bad: OnboardInput[] = [
      { fullName: 'A' },
      { fullName: 'x'.repeat(81) },
      { fullName: 'Val Idate', phone: 'call me' },
      { fullName: 'Val Idate', phone: '12345' },
      { fullName: 'Val Idate', phone: '1'.repeat(21) },
      { fullName: 'Val Idate', rank: 'Chief' as Rank },
      { fullName: 'Val Idate', station: 999 },
      { fullName: 'Val Idate', tour: 0 },
      { fullName: 'Val Idate', tour: 32 },
      { fullName: 'Val Idate', employeeId: 'E'.repeat(41) },
    ]
    for (const input of bad) await expectRpcError(onboard(a.id, input), 'INVALID_INPUT')
    expect((await profile(a.id)).status).toBe('onboarding')
  })

  it('is refused once approved (INVALID_INPUT) and for rejected/suspended members (NOT_APPROVED)', async () => {
    const approved = await t.createMember()
    await expectRpcError(onboard(approved.id, { fullName: 'Already Here' }), 'INVALID_INPUT')
    for (const status of ['rejected', 'suspended'] as const) {
      const m = await t.createMember({ status })
      await expectRpcError(onboard(m.id, { fullName: 'Not Active' }), 'NOT_APPROVED')
    }
  })
})

describe('complete_onboarding: no roster match ⇒ pending', () => {
  it('saves the profile, derives battalion/division and goes pending', async () => {
    const last = surname('Nomatch')
    const a = await newApplicant(`  Pat   ${last} `)
    const result = await onboard(a.id, {
      fullName: `  Pat   ${last} `,
      phone: '(415) 555-0199',
      rank: 'Lieutenant',
      station: 101,
      tour: null,
      employeeId: '  ',
    })
    expect(result).toMatchObject({ status: 'pending', matched: false })
    expect(result.message).toMatch(/admin/)
    const p = await profile(a.id)
    expect(p).toMatchObject({
      full_name: `Pat ${last}`,
      phone: '(415) 555-0199',
      rank: 'Lieutenant',
      station: 101,
      battalion: 99,
      division: 4,
      tour: null,
      employee_id: null,
      status: 'pending',
      roster_id: null,
      // status_reason is shown to the member: no roster details in it (§6.2)
      status_reason: null,
    })
    expect(await rosterNote(a.id)).toBe(`Roster: no entry found for Pat ${last}`)
  })

  it('notifies admins with the applicant\'s name, rank, station, phone and email, once', async () => {
    const last = surname('Pending')
    const a = await newApplicant(`Chris ${last}`, `chris.${letters()}@example.test`)
    await onboard(a.id, { fullName: `Chris ${last}`, phone: '415 555 0123', rank: 'Captain', station: 2 })
    // editing while pending doesn't notify again
    await onboard(a.id, { fullName: `Chris ${last}`, phone: '415 555 0124', rank: 'Captain', station: 2 })
    const notes = (await t.notificationsFor(admin.id, 'member_pending')).filter((n) => n.actor_id === a.id)
    expect(notes).toHaveLength(1)
    expect(notes[0].body).toContain(`Chris ${last}`)
    expect(notes[0].body).toContain('Captain')
    expect(notes[0].body).toContain('Station 2')
    expect(notes[0].body).toContain('415 555 0123')
    expect(notes[0].body).toContain(a.email)
    // the roster note goes to admins (never to the applicant)
    expect(notes[0].body).toContain(`Roster: no entry found for Chris ${last}`)
    expect(notes[0].url).toBe('/admin')
    const audit = await t.query(`select * from public.audit_log where actor_id = $1 and action = 'member.pending'`, [a.id])
    expect(audit.length).toBe(2)
    expect((await profile(a.id)).phone).toBe('415 555 0124')
  })
})

describe('complete_onboarding: roster matching (§6.4)', () => {
  it('auto-approves a unique name match with ≥ 2 matching attributes and claims the row', async () => {
    const last = surname()
    const rosterId = await addRoster({ first: 'John', last, rank: 'Firefighter', station: 19 })
    const a = await newApplicant(`John ${last}`)
    const result = await onboard(a.id, { fullName: `John ${last}`, rank: 'Firefighter', station: 19 })
    expect(result).toMatchObject({ status: 'approved', matched: true })
    const p = await profile(a.id)
    expect(p).toMatchObject({ status: 'approved', roster_id: rosterId, status_reason: null, approved_by: null })
    expect(p.approved_at).not.toBeNull()
    const r = await t.one(`select claimed_by from public.roster where id = $1`, [rosterId])
    expect(r.claimed_by).toBe(a.id)

    const notes = (await t.notificationsFor(admin.id, 'member_auto_approved')).filter((n) => n.actor_id === a.id)
    expect(notes).toHaveLength(1)
    expect(notes[0].body).toContain(`John ${last}`)
    const audit = await t.query(`select details from public.audit_log where actor_id = $1 and action = 'member.auto_approved'`, [a.id])
    expect(audit).toHaveLength(1)
    // no member_pending for an auto-approved member
    expect((await t.notificationsFor(admin.id, 'member_pending')).filter((n) => n.actor_id === a.id)).toEqual([])
  })

  it('auto-approves on a matching employee ID alone (trimmed, case-insensitive)', async () => {
    const last = surname()
    await addRoster({ first: 'Ana', last, employeeId: 'e12345' })
    const a = await newApplicant(`Ana ${last}`)
    const result = await onboard(a.id, { fullName: `Ana ${last}`, employeeId: '  E12345 ' })
    expect(result.status).toBe('approved')
  })

  it('stays pending when only one attribute matches', async () => {
    const last = surname()
    await addRoster({ first: 'Ben', last, station: 19 })
    const a = await newApplicant(`Ben ${last}`)
    const result = await onboard(a.id, { fullName: `Ben ${last}`, station: 19 })
    expect(result.status).toBe('pending')
    expect(await rosterNote(a.id)).toBe(`Roster: Ben ${last}, Station 19 — only 1 detail matches`)
  })

  it('stays pending when the roster row has nothing to compare', async () => {
    const last = surname()
    await addRoster({ first: 'Cal', last })
    const a = await newApplicant(`Cal ${last}`)
    expect((await onboard(a.id, { fullName: `Cal ${last}` })).status).toBe('pending')
    expect(await rosterNote(a.id)).toBe(`Roster: Cal ${last} — no details to compare`)
  })

  it('any difference blocks auto-approval, even with a matching employee ID', async () => {
    const last = surname()
    await addRoster({ first: 'Dee', last, employeeId: 'X9', rank: 'Firefighter', station: 19, tour: 7 })
    const a = await newApplicant(`Dee ${last}`)
    const result = await onboard(a.id, { fullName: `Dee ${last}`, employeeId: 'x9', station: 19, tour: 5 })
    expect(result.status).toBe('pending')
    expect(await rosterNote(a.id)).toBe(`Roster: Dee ${last}, Station 19 — tour differs`)
  })

  it('lists every attribute that differs', async () => {
    const last = surname()
    await addRoster({ first: 'Eve', last, rank: 'Captain', station: 2, tour: 5 })
    const a = await newApplicant(`Eve ${last}`)
    await onboard(a.id, { fullName: `Eve ${last}`, rank: 'Firefighter', station: 19, tour: 5 })
    expect(await rosterNote(a.id)).toBe(`Roster: Eve ${last}, Station 2 — rank, station differ`)
  })

  it('treats "No tour" as different from a roster tour', async () => {
    const last = surname()
    await addRoster({ first: 'Fay', last, rank: 'Firefighter', station: 19, tour: 3 })
    const a = await newApplicant(`Fay ${last}`)
    const result = await onboard(a.id, { fullName: `Fay ${last}`, rank: 'Firefighter', station: 19, tour: null })
    expect(result.status).toBe('pending')
    expect(await rosterNote(a.id)).toContain('tour differs')
  })

  it('matches email case-insensitively and counts it', async () => {
    const last = surname()
    const email = `gus.${letters()}@example.test`
    await addRoster({ first: 'Gus', last, email: email.toUpperCase(), rank: 'Firefighter' })
    const a = await newApplicant(`Gus ${last}`, email)
    expect((await onboard(a.id, { fullName: `Gus ${last}` })).status).toBe('approved')
  })

  it('an email difference blocks auto-approval', async () => {
    const last = surname()
    await addRoster({ first: 'Hal', last, email: 'someone.else@example.test', rank: 'Firefighter', station: 19 })
    const a = await newApplicant(`Hal ${last}`)
    await onboard(a.id, { fullName: `Hal ${last}` })
    expect(await rosterNote(a.id)).toContain('email differs')
  })

  it('matches a single-initial roster first name', async () => {
    const last = surname()
    await addRoster({ first: 'J.', last, rank: 'Firefighter', station: 19 })
    const a = await newApplicant(`Jonathan ${last}`)
    expect((await onboard(a.id, { fullName: `Jonathan ${last}` })).status).toBe('approved')
  })

  it('does not match a different first name', async () => {
    const last = surname()
    await addRoster({ first: 'Jane', last, rank: 'Firefighter', station: 19 })
    const a = await newApplicant(`John ${last}`)
    expect((await onboard(a.id, { fullName: `John ${last}` })).status).toBe('pending')
    expect(await rosterNote(a.id)).toContain('no entry found')
  })

  it('understands "Last, First" names', async () => {
    const last = surname()
    await addRoster({ first: 'Ivy', last, rank: 'Firefighter', station: 19 })
    const a = await newApplicant(`${last}, Ivy`)
    expect((await onboard(a.id, { fullName: `${last}, Ivy M.` })).status).toBe('approved')
  })

  it('ignores middle names and generational suffixes', async () => {
    const last = surname()
    await addRoster({ first: 'Kurt', last, rank: 'Firefighter', station: 19 })
    const a = await newApplicant(`Kurt Q. ${last} Jr.`)
    expect((await onboard(a.id, { fullName: `Kurt Q. ${last} Jr.` })).status).toBe('approved')
  })

  it('matches compound last names', async () => {
    const tail = surname('Cruz')
    await addRoster({ first: 'Maria', last: `De La ${tail}`, rank: 'Firefighter', station: 19 })
    const a = await newApplicant(`Maria De La ${tail}`)
    expect((await onboard(a.id, { fullName: `Maria De La ${tail}` })).status).toBe('approved')
  })

  it('ignores accents, apostrophes and hyphens', async () => {
    const tail = letters()
    await addRoster({ first: 'José', last: `O'Brien-${tail}`, rank: 'Firefighter', station: 19 })
    const a = await newApplicant(`Jose OBrien ${tail}`)
    // "Jose OBrien<tail>" and "José O'Brien-<tail>" share keys
    expect((await onboard(a.id, { fullName: `Jose OBrien${tail}` })).status).toBe('approved')
  })

  it('stays pending when several roster rows match the name', async () => {
    const last = surname()
    await addRoster({ first: 'Lou', last, employeeId: '1', rank: 'Firefighter', station: 19 })
    await addRoster({ first: 'L', last, employeeId: '2', rank: 'Firefighter', station: 19 })
    const a = await newApplicant(`Lou ${last}`)
    expect((await onboard(a.id, { fullName: `Lou ${last}` })).status).toBe('pending')
    expect(await rosterNote(a.id)).toBe(`Roster: 2 entries match Lou ${last}. Pick the right one when approving`)
  })

  it('a roster row can be claimed only once', async () => {
    const last = surname()
    await addRoster({ first: 'Max', last, rank: 'Firefighter', station: 19 })
    const first = await newApplicant(`Max ${last}`)
    expect((await onboard(first.id, { fullName: `Max ${last}` })).status).toBe('approved')
    const second = await newApplicant(`Max ${last}`)
    expect((await onboard(second.id, { fullName: `Max ${last}` })).status).toBe('pending')
    expect(await rosterNote(second.id)).toBe(`Roster: Max ${last} is already linked to another account`)
  })

  it('a pending member who corrects their details is auto-approved', async () => {
    const last = surname()
    await addRoster({ first: 'Ned', last, rank: 'Firefighter', station: 19, tour: 5 })
    const a = await newApplicant(`Ned ${last}`)
    expect((await onboard(a.id, { fullName: `Ned ${last}`, station: 2 })).status).toBe('pending')
    expect((await onboard(a.id, { fullName: `Ned ${last}`, station: 19 })).status).toBe('approved')
    expect((await profile(a.id)).status_reason).toBeNull()
  })

  it('a blank employee ID counts as a difference when the roster row has one', async () => {
    const last = surname()
    await addRoster({ first: 'Oda', last, employeeId: 'E-4410', rank: 'Firefighter', station: 19, tour: 5 })
    const a = await newApplicant(`Oda ${last}`)
    expect((await onboard(a.id, { fullName: `Oda ${last}`, employeeId: null })).status).toBe('pending')
    expect(await rosterNote(a.id)).toBe(`Roster: Oda ${last}, Station 19 — employee ID (not entered) differs`)
    // entering it (a correction) approves
    expect((await onboard(a.id, { fullName: `Oda ${last}`, employeeId: 'e-4410' })).status).toBe('approved')
  })
})

describe('complete_onboarding: roster data stays with admins (§6.2)', () => {
  it('records the roster candidate and the try number for admins, not on the profile', async () => {
    const last = surname()
    const rosterId = await addRoster({ first: 'Pia', last, rank: 'Captain', station: 2, tour: 7 })
    const a = await newApplicant(`Pia ${last}`)
    await onboard(a.id, { fullName: `Pia ${last}`, rank: 'Firefighter', station: 19, tour: 5 })
    expect((await profile(a.id)).status_reason).toBeNull()
    expect(await latestPendingAudit(a.id)).toMatchObject({
      roster_note: `Roster: Pia ${last}, Station 2 — rank, station, tour differ`,
      roster_id: rosterId,
      attempt: 1,
      auto_approve_blocked: false,
    })
    // the applicant can't read audit_log at all
    expect(await t.asUser(a.id, (q) => q(`select * from public.audit_log`))).toEqual([])
  })

  it('stops auto-approving after 3 tries, so details can\'t be guessed one by one; an admin still can approve', async () => {
    const last = surname()
    const rosterId = await addRoster({ first: 'Rhea', last, rank: 'Firefighter', station: 19, tour: 7 })
    const a = await newApplicant(`Rhea ${last}`)
    for (const tour of [1, 2, 3]) {
      expect((await onboard(a.id, { fullName: `Rhea ${last}`, tour })).status).toBe('pending')
    }
    // 4th try with every detail right: still pending, admins are told why
    expect((await onboard(a.id, { fullName: `Rhea ${last}`, tour: 7 })).status).toBe('pending')
    const audit = await latestPendingAudit(a.id)
    expect(audit).toMatchObject({ attempt: 4, auto_approve_blocked: true, roster_id: rosterId })
    expect(audit?.roster_note).toBe(
      `Roster: Rhea ${last}, Station 19 — matched — but not auto-approved: this account already had 3 tries, so check it really is them`,
    )
    expect(await t.one(`select claimed_by from public.roster where id = $1`, [rosterId])).toEqual({ claimed_by: null })
    expect((await profile(a.id)).status_reason).toBeNull()

    await t.rpc(admin.id, 'admin_approve_member', { p_user_id: a.id, p_roster_id: rosterId })
    expect(await profile(a.id)).toMatchObject({ status: 'approved', roster_id: rosterId })
  })

  it('the third try can still auto-approve', async () => {
    const last = surname()
    await addRoster({ first: 'Sol', last, rank: 'Firefighter', station: 19, tour: 7 })
    const a = await newApplicant(`Sol ${last}`)
    for (const tour of [1, 2]) {
      expect((await onboard(a.id, { fullName: `Sol ${last}`, tour })).status).toBe('pending')
    }
    expect((await onboard(a.id, { fullName: `Sol ${last}`, tour: 7 })).status).toBe('approved')
  })

  it('notes a capped try that did not match for admins too', async () => {
    const last = surname()
    await addRoster({ first: 'Tia', last, rank: 'Firefighter', station: 19, tour: 7 })
    const a = await newApplicant(`Tia ${last}`)
    for (const tour of [1, 2, 3, 4]) await onboard(a.id, { fullName: `Tia ${last}`, tour })
    expect(await rosterNote(a.id)).toBe(`Roster: Tia ${last}, Station 19 — tour differs (auto-approval is off after 3 tries)`)
  })
})

describe('acknowledge_telestaff', () => {
  it('records the first acknowledgment only', async () => {
    const m = await t.createMember({ ack: false })
    await t.rpc(m.id, 'acknowledge_telestaff')
    const first = await t.one<{ at: Date }>(`select telestaff_ack_at as at from public.profiles where id = $1`, [m.id])
    expect(first.at).toBeInstanceOf(Date)
    await t.rpc(m.id, 'acknowledge_telestaff')
    const second = await t.one<{ at: Date }>(`select telestaff_ack_at as at from public.profiles where id = $1`, [m.id])
    expect(second.at.getTime()).toBe(first.at.getTime())
  })

  it('requires an approved member', async () => {
    const m = await t.createMember({ status: 'pending', ack: false })
    await expectRpcError(t.rpc(m.id, 'acknowledge_telestaff'), 'NOT_APPROVED')
    await expectRpcError(t.rpc(NO_SUB, 'acknowledge_telestaff'), 'NOT_SIGNED_IN')
  })
})

describe('update_my_profile', () => {
  const args = (over: Record<string, unknown> = {}) => ({
    p_phone: '415-555-0000',
    p_station: 19,
    p_tour: 5,
    p_notify_scope: 'battalion',
    ...over,
  })

  it('updates phone, station (with battalion/division), tour and alert scope', async () => {
    const m = await t.createMember({ station: 19, tour: 1 })
    await t.rpc(m.id, 'update_my_profile', args({ p_phone: '+1 415 555 0101', p_station: 3, p_tour: null, p_notify_scope: 'all' }))
    expect(await profile(m.id)).toMatchObject({
      phone: '+1 415 555 0101',
      station: 3,
      battalion: 4,
      division: 2,
      tour: null,
      notify_scope: 'all',
    })
  })

  it('audits station/tour changes only', async () => {
    const m = await t.createMember({ station: 19, tour: 5 })
    await t.rpc(m.id, 'update_my_profile', args({ p_phone: '415 555 0199' }))
    expect(await t.query(`select 1 from public.audit_log where actor_id = $1 and action = 'member.profile_updated'`, [m.id])).toEqual([])
    await t.rpc(m.id, 'update_my_profile', args({ p_tour: 6 }))
    const rows = await t.query<{ details: { tour: { from: number; to: number } } }>(
      `select details from public.audit_log where actor_id = $1 and action = 'member.profile_updated'`,
      [m.id],
    )
    expect(rows).toHaveLength(1)
    expect(rows[0].details.tour).toEqual({ from: 5, to: 6 })
  })

  it('validates its input', async () => {
    const m = await t.createMember()
    for (const over of [
      { p_phone: 'nope' },
      { p_phone: null },
      { p_station: 0 },
      { p_tour: 40 },
      { p_notify_scope: 'everyone' },
      { p_notify_scope: null },
    ]) {
      await expectRpcError(t.rpc(m.id, 'update_my_profile', args(over)), 'INVALID_INPUT')
    }
  })

  it('is for approved members only', async () => {
    const m = await t.createMember({ status: 'pending' })
    await expectRpcError(t.rpc(m.id, 'update_my_profile', args()), 'NOT_APPROVED')
  })
})

describe('clear_must_change_password', () => {
  it('clears the flag, even for a member who is not approved yet', async () => {
    const m = await t.createMember({ status: 'pending' })
    await t.query(`update public.profiles set must_change_password = true where id = $1`, [m.id])
    await t.rpc(m.id, 'clear_must_change_password')
    expect((await profile(m.id)).must_change_password).toBe(false)
  })

  it('requires a session', async () => {
    await expectRpcError(t.rpc(NO_SUB, 'clear_must_change_password'), 'NOT_SIGNED_IN')
  })
})

describe('regenerate_calendar_token', () => {
  it('replaces the token and returns it', async () => {
    const m = await t.createMember()
    const before = (await profile(m.id)).calendar_token
    const token = await t.rpc<string>(m.id, 'regenerate_calendar_token')
    expect(token).not.toBe(before)
    expect((await profile(m.id)).calendar_token).toBe(token)
  })

  it('requires an approved member', async () => {
    const m = await t.createMember({ status: 'suspended' })
    await expectRpcError(t.rpc(m.id, 'regenerate_calendar_token'), 'NOT_APPROVED')
  })
})
