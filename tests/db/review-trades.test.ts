// Adversarial review — trades and the effective schedule (ARCHITECTURE §4,
// §6.1, §6.3).
//
// Every test in this file demonstrates a defect found in review. They are
// expected to FAIL against the current migrations and to pass once fixed.
// Invariant used throughout (§4, §6.1 "can't cover two shifts the same day"):
// on any date a member is never both still responsible for their own shift
// (base day not given away, or an open post) and covering someone else.

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  createTestDb,
  tourDay,
  type DbError,
  type Member,
  type MemberOptions,
  type TestDb,
} from './harness'

let t: TestDb
let admin: Member

beforeAll(async () => {
  t = await createTestDb()
  admin = await t.createMember({ role: 'admin', tour: null, fullName: 'Admin Review' })
})

afterAll(async () => {
  await t?.close()
})

const member = (opts: MemberOptions = {}) => t.createMember(opts)

function post(poster: Member, date: string, returnDates: string[] | null = null) {
  return t.rpc<string>(poster.id, 'post_shift', {
    p_date: date,
    p_shift_type: '24-Hour',
    p_station: null,
    p_return_dates: returnDates,
    p_accept_limit: null,
    p_notes: null,
  })
}

function request(m: Member, shiftId: string, returnDate: string | null = null) {
  return t.rpc<string>(m.id, 'request_shift', { p_shift_id: shiftId, p_return_date: returnDate, p_message: null })
}

function confirm(m: Member, requestId: string) {
  return t.rpc(m.id, 'confirm_request', { p_request_id: requestId })
}

/** Runs the call and returns its error (or undefined); the invariant decides pass/fail. */
async function attempt(promise: Promise<unknown>): Promise<DbError | undefined> {
  try {
    await promise
    return undefined
  } catch (error) {
    return error as DbError
  }
}

interface Day {
  date: string
  base: boolean
  given_away: boolean
  picked_up: boolean
  working: boolean
  open_post_id: string | null
}

async function scheduleOn(m: Member, date: string): Promise<Day> {
  const [d] = await t.rpc<Day[]>(m.id, 'my_schedule', { p_from: date, p_to: date })
  return d
}

/** Own shift still mine (base day not given away, or an open post) AND covering someone that day. */
async function doubleBooked(m: Member, date: string): Promise<boolean> {
  const d = await scheduleOn(m, date)
  const ownStillMine = (d.base && !d.given_away) || d.open_post_id !== null
  return ownStillMine && d.picked_up
}

// Tour 1 and tour 2 never work the same day (tour 2 = tour 1 shifted one day).
const DAY = () => tourDay(1, 3)
const SWAP_DAY = () => tourDay(2, 3)

// ---------------------------------------------------------------------------
describe('review: undoing a trade must not double-book either member', () => {
  it('agreed cancel: the poster who has since picked up another shift that day is not left working both', async () => {
    const day = DAY()
    const poster = await member({ tour: 1, fullName: 'Pia Poster' })
    const taker = await member({ tour: 2, fullName: 'Tim Taker' })
    const colleague = await member({ tour: 1, fullName: 'Cal Colleague' })

    // Pia gives her tour day away to Tim …
    const mine = await post(poster, day)
    await confirm(poster, await request(taker, mine))
    // … and, now off that day, picks up Cal's shift on the same day.
    const cals = await post(colleague, day)
    await confirm(colleague, await request(poster, cals))
    expect(await doubleBooked(poster, day)).toBe(false) // sanity: fine so far

    // Tim asks to cancel; Pia agrees. Today her shift reopens and she is
    // back on her own (open) shift while still covering Cal's.
    await t.rpc(taker.id, 'request_trade_cancel', { p_shift_id: mine, p_reason: null })
    await attempt(t.rpc(poster.id, 'respond_trade_cancel', { p_shift_id: mine, p_agree: true }))

    expect(await doubleBooked(poster, day)).toBe(false)
  })

  it('agreed cancel of a SwapMatch: the requester who has since picked up a shift on the return date is not left working both', async () => {
    const day = DAY()
    const rd = SWAP_DAY()
    const poster = await member({ tour: 1, fullName: 'Sam Swapper' })
    const taker = await member({ tour: 2, fullName: 'Rae Returner' })
    const colleague = await member({ tour: 2, fullName: 'Yan Colleague' })

    // SwapMatch: Rae covers Sam's tour-1 day, Sam works Rae's tour-2 day (rd).
    const mine = await post(poster, day, [rd])
    await confirm(poster, await request(taker, mine, rd))
    // Rae is now off on rd and picks up Yan's shift that day.
    const yans = await post(colleague, rd)
    await confirm(colleague, await request(taker, yans))
    expect(await doubleBooked(taker, rd)).toBe(false) // sanity

    // Sam asks to cancel; Rae agrees. Today the return leg is cancelled, so
    // Rae works her own rd shift again while still covering Yan's.
    await t.rpc(poster.id, 'request_trade_cancel', { p_shift_id: mine, p_reason: null })
    await attempt(t.rpc(taker.id, 'respond_trade_cancel', { p_shift_id: mine, p_agree: true }))

    expect(await doubleBooked(taker, rd)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
describe('review: a no-tour member\'s open post is a day they work', () => {
  // post_shift and confirm_request already treat a no-tour poster's open post
  // as "working" for return dates (has_post → POSTER_WORKS_RETURN_DAY), but
  // request_shift / confirm_request do not for the requester.

  it('request_shift refuses a shift on a day the no-tour requester has an open post (YOU_WORK_THAT_DAY)', async () => {
    const day = DAY()
    const relief = await member({ tour: null, fullName: 'Rel Relief' })
    const poster = await member({ tour: 1 })
    await post(relief, day) // Rel is working that day and looking for cover
    const theirs = await post(poster, day)

    const error = await attempt(request(relief, theirs))
    expect({ code: error?.code, hint: error?.hint }).toEqual({ code: 'P0001', hint: 'YOU_WORK_THAT_DAY' })
  })

  it('confirm_request does not let a no-tour member who posted that day afterwards end up covering it too', async () => {
    const day = tourDay(1, 3, 1)
    const relief = await member({ tour: null, fullName: 'Ned Norotation' })
    const poster = await member({ tour: 1 })
    const theirs = await post(poster, day)
    const req = await request(relief, theirs) // asks first …
    await post(relief, day) // … then posts their own shift for the same day

    await attempt(confirm(poster, req))
    expect(await doubleBooked(relief, day)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
describe('review: suspending a member takes their posts off the table', () => {
  it('a suspended member\'s open post can no longer be requested (nor hand out their phone and email)', async () => {
    const poster = await member({ tour: 1, fullName: 'Sue Suspended', phone: '(415) 555-0777' })
    const taker = await member({ tour: 2 })
    const id = await post(poster, tourDay(1, 3, 2))
    await t.rpc(admin.id, 'admin_set_member_status', { p_user_id: poster.id, p_status: 'suspended', p_reason: 'Review' })

    // Today the request succeeds: the post stays open on the board, the
    // suspended member can never confirm it, and the requester can now read
    // the suspended member's phone and email through get_trade_contact.
    const error = await attempt(request(taker, id))
    const contacts = await t.rpc<Array<{ phone: string }>>(taker.id, 'get_trade_contact', { p_shift_id: id })
    expect({ refused: error?.code === 'P0001', contactPhones: contacts.map((c) => c.phone) }).toEqual({
      refused: true,
      contactPhones: [],
    })
  })
})
