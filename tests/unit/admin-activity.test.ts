import { describe, expect, it } from 'vitest'
import {
  ACTIVITY_FILTER_VALUES,
  describeActivity,
  memberIdsIn,
  shiftIdIn,
  type ActivityContext,
} from '@/app/(app)/admin/activity/_lib/describe'
import type { AuditEntry } from '@/lib/types/database'

const BRIAN = '11111111-1111-4111-8111-111111111111'
const MIKE = '22222222-2222-4222-8222-222222222222'
const ANA = '33333333-3333-4333-8333-333333333333'
const SHIFT = '44444444-4444-4444-8444-444444444444'

const ctx: ActivityContext = {
  names: new Map([
    [BRIAN, 'Brian Machado'],
    [MIKE, 'Mike Lee'],
    [ANA, 'Ana Cruz'],
  ]),
  shifts: new Map([[SHIFT, { date: '2026-10-14', shift_type: '24-Hour', poster_name: 'Ana Cruz', coverer_name: 'Mike Lee' }]]),
}

let nextId = 1
function entry(partial: Partial<AuditEntry> & Pick<AuditEntry, 'action'>): AuditEntry {
  return {
    id: nextId++,
    actor_id: null,
    target_type: null,
    target_id: null,
    details: {},
    created_at: '2026-09-23T15:00:00Z',
    ...partial,
  }
}

describe('describeActivity', () => {
  it('describes approvals with both names and links to the member', () => {
    const line = describeActivity(
      entry({ action: 'admin.member_approved', actor_id: BRIAN, target_type: 'profile', target_id: MIKE, details: { roster_id: SHIFT } }),
      ctx,
    )
    expect(line).toEqual({
      text: 'Brian Machado approved Mike Lee',
      detail: 'Linked to their roster entry.',
      href: `/admin/members?member=${MIKE}`,
      kind: 'admin',
    })
  })

  it('describes a post with its date and shift type', () => {
    const line = describeActivity(
      entry({
        action: 'shift.posted',
        actor_id: ANA,
        target_type: 'shift',
        target_id: SHIFT,
        details: { date: '2026-10-14', shift_type: '24-Hour', return_dates: ['2026-10-20'] },
      }),
      ctx,
    )
    expect(line.text).toBe('Ana Cruz posted Oct 14 24-Hour')
    expect(line.detail).toBe('SwapMatch: Oct 20')
    expect(line.href).toBe(`/trades/${SHIFT}`)
  })

  it('falls back to the shift row for the date and type', () => {
    const line = describeActivity(
      entry({ action: 'trade.confirmed', actor_id: ANA, target_type: 'shift', target_id: SHIFT, details: { coverer_id: MIKE } }),
      ctx,
    )
    expect(line.text).toBe('Ana Cruz confirmed Mike Lee to cover Oct 14 24-Hour')
  })

  it('names both people on a voided trade and shows the reason', () => {
    const line = describeActivity(
      entry({
        action: 'admin.trade_voided',
        actor_id: BRIAN,
        target_type: 'shift',
        target_id: SHIFT,
        details: { poster_id: ANA, coverer_id: MIKE, reason: 'Entered by mistake' },
      }),
      ctx,
    )
    expect(line.text).toBe('Brian Machado voided the Oct 14 24-Hour trade between Ana Cruz and Mike Lee')
    expect(line.detail).toBe('“Entered by mistake”')
  })

  it('describes suspensions, reactivations and role changes', () => {
    const base = { actor_id: BRIAN, target_type: 'profile', target_id: MIKE } as const
    expect(
      describeActivity(entry({ ...base, action: 'admin.member_status', details: { to: 'suspended', reason: 'Left SFFD', posts_cancelled: 2 } }), ctx),
    ).toMatchObject({ text: 'Brian Machado suspended Mike Lee', detail: '“Left SFFD” 2 open posts taken down.' })
    expect(describeActivity(entry({ ...base, action: 'admin.member_status', details: { to: 'approved' } }), ctx).text).toBe(
      'Brian Machado reactivated Mike Lee',
    )
    expect(describeActivity(entry({ ...base, action: 'admin.member_role', details: { to: 'admin' } }), ctx).text).toBe(
      'Brian Machado made Mike Lee an admin',
    )
    expect(describeActivity(entry({ ...base, action: 'admin.member_role', details: { to: 'member' } }), ctx).text).toBe(
      'Brian Machado removed admin access from Mike Lee',
    )
  })

  it('lists which member details an admin edited', () => {
    const line = describeActivity(
      entry({
        action: 'admin.member_updated',
        actor_id: BRIAN,
        target_type: 'profile',
        target_id: MIKE,
        details: {
          before: { full_name: 'Mike Lee', rank: 'Firefighter', station: 19, tour: 7, phone: '1', employee_id: null },
          after: { full_name: 'Mike Lee', rank: 'Firefighter', station: 20, tour: null, phone: '1', employee_id: null },
        },
      }),
      ctx,
    )
    expect(line.detail).toBe('Changed: station, tour')
  })

  it('describes sign-ups with the roster note', () => {
    const line = describeActivity(
      entry({
        action: 'member.pending',
        actor_id: MIKE,
        target_type: 'profile',
        target_id: MIKE,
        details: { roster_note: 'Roster: Mike Lee, Station 19 — tour differs', attempt: 2 },
      }),
      ctx,
    )
    expect(line.text).toBe('Mike Lee signed up and is waiting for approval (try 2)')
    expect(line.detail).toBe('Roster: Mike Lee, Station 19 — tour differs')
  })

  it('summarises roster imports', () => {
    const line = describeActivity(
      entry({
        action: 'admin.roster_imported',
        actor_id: BRIAN,
        target_type: 'roster',
        details: { replace: true, inserted: 10, updated: 2, skipped: 1, deleted: 3, errors: 1 },
      }),
      ctx,
    )
    expect(line.text).toBe('Brian Machado imported the roster')
    expect(line.detail).toBe('10 added, 2 updated, 1 unchanged, 3 old unclaimed entries removed, 1 rows refused.')
  })

  it('copes with unknown names, missing actors and unknown actions', () => {
    const stranger = '55555555-5555-4555-8555-555555555555'
    expect(
      describeActivity(entry({ action: 'admin.member_rejected', actor_id: stranger, target_type: 'profile', target_id: stranger }), ctx)
        .text,
    ).toBe('Someone turned down a member')
    expect(describeActivity(entry({ action: 'system.something_new' }), ctx)).toMatchObject({
      text: 'ShiftSwap: something new',
      kind: 'other',
    })
  })
})

describe('memberIdsIn / shiftIdIn', () => {
  it('collects the actor, target member and trade partners', () => {
    const e = entry({
      action: 'admin.trade_voided',
      actor_id: BRIAN,
      target_type: 'shift',
      target_id: SHIFT,
      details: { poster_id: ANA, coverer_id: MIKE },
    })
    expect(memberIdsIn(e).sort()).toEqual([BRIAN, MIKE, ANA].sort())
    expect(shiftIdIn(e)).toBe(SHIFT)
    expect(shiftIdIn(entry({ action: 'x', target_type: 'profile', target_id: MIKE }))).toBeNull()
  })

  it('every filter option is a known value', () => {
    expect(ACTIVITY_FILTER_VALUES.has('')).toBe(true)
    expect(ACTIVITY_FILTER_VALUES.has('admin.')).toBe(true)
    expect(ACTIVITY_FILTER_VALUES.has('admin.trade_voided')).toBe(true)
  })
})
