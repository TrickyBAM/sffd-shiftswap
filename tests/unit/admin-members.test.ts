import { describe, expect, it } from 'vitest'
import { stationText, stationWithBattalion, withinLastWeek } from '@/app/(app)/admin/_lib/format'
import { activeAdminHref } from '@/app/(app)/admin/_components/AdminTabs'
import {
  editValuesFrom,
  isDirty,
  toUpdateInput,
  validateMemberEdit,
  type MemberEditValues,
} from '@/app/(app)/admin/members/_lib/edit'
import {
  DEFAULT_MEMBER_FILTERS,
  MEMBER_PAGE_SIZE,
  STATUS_OPTIONS,
  isMemberStatusFilter,
  memberListOptions,
  memberStateLabel,
  statusLabel,
} from '@/app/(app)/admin/members/_lib/query'
import {
  isRemovedLoginEmail,
  loginClosureWarning,
  loginStillOnFile,
  removalSummary,
  removedLoginEmail,
} from '@/app/(app)/admin/members/_lib/remove'
import type { Profile } from '@/lib/types/database'

const member: Profile = {
  id: '22222222-2222-4222-8222-222222222222',
  email: 'mike@example.com',
  full_name: 'Mike Lee',
  phone: '(415) 555-0123',
  rank: 'Firefighter',
  station: 19,
  battalion: 9,
  division: 3,
  tour: 7,
  employee_id: null,
  status: 'approved',
  status_reason: null,
  role: 'member',
  roster_id: null,
  telestaff_ack_at: null,
  must_change_password: false,
  notify_scope: 'battalion',
  calendar_token: '66666666-6666-4666-8666-666666666666',
  approved_at: null,
  approved_by: null,
  created_at: '2026-09-01T00:00:00Z',
  updated_at: '2026-09-01T00:00:00Z',
}

describe('member edit form', () => {
  it('starts from the saved member and is not dirty', () => {
    const values = editValuesFrom(member)
    expect(values).toEqual({
      fullName: 'Mike Lee',
      rank: 'Firefighter',
      station: 19,
      tour: 7,
      phone: '(415) 555-0123',
      employeeId: '',
    })
    expect(isDirty(values, member)).toBe(false)
    expect(isDirty({ ...values, fullName: '  Mike   Lee ' }, member)).toBe(false)
    expect(isDirty({ ...values, tour: null }, member)).toBe(true)
  })

  it('validates like admin_update_member', () => {
    const ok = editValuesFrom(member)
    expect(validateMemberEdit(ok)).toEqual({})
    const bad: MemberEditValues = { fullName: 'M', rank: '', station: null, tour: 40, phone: 'call me', employeeId: 'x'.repeat(41) }
    expect(Object.keys(validateMemberEdit(bad)).sort()).toEqual(
      ['employeeId', 'fullName', 'phone', 'rank', 'station', 'tour'].sort(),
    )
    expect(validateMemberEdit({ ...ok, tour: null })).toEqual({})
  })

  it("uses the same phone rule as the member's own Profile form (at least 7 digits)", () => {
    const ok = editValuesFrom(member)
    // 8 characters but only 6 digits: the database would take it, but it can't be called or texted.
    expect(validateMemberEdit({ ...ok, phone: '555 12 3' }).phone).toMatch(/area code/)
    expect(validateMemberEdit({ ...ok, phone: '' }).phone).toBe('Enter a mobile number.')
    expect(validateMemberEdit({ ...ok, phone: ' 415-555-0123 ' })).toEqual({})
    expect(validateMemberEdit({ ...ok, phone: '+1 (415) 555-0123' })).toEqual({})
  })

  it('builds the update input with cleaned text', () => {
    expect(toUpdateInput({ ...editValuesFrom(member), fullName: ' Mike  Lee ', employeeId: '  ' })).toEqual({
      fullName: 'Mike Lee',
      rank: 'Firefighter',
      station: 19,
      tour: 7,
      phone: '(415) 555-0123',
      employeeId: null,
    })
  })

  it('labels statuses in plain English', () => {
    expect(statusLabel('approved')).toBe('Active')
    expect(statusLabel('pending')).toBe('Waiting for approval')
    expect(statusLabel('rejected')).toBe('Turned down')
  })
})

describe('admin format helpers', () => {
  it('formats stations', () => {
    expect(stationText(19)).toBe('Station 19')
    expect(stationText(null)).toBe('No station')
    expect(stationWithBattalion(19)).toBe('Station 19 · Battalion 9')
    expect(stationWithBattalion(undefined)).toBe('No station')
  })

  it('knows when a relative time still reads well (under a week)', () => {
    const now = Date.parse('2026-09-23T12:00:00Z')
    expect(withinLastWeek('2026-09-23T11:59:50Z', now)).toBe(true)
    expect(withinLastWeek('2026-09-17T12:00:01Z', now)).toBe(true)
    expect(withinLastWeek('2026-09-16T12:00:00Z', now)).toBe(false)
    expect(withinLastWeek('nope', now)).toBe(false)
    expect(withinLastWeek(null, now)).toBe(false)
  })

  it('picks the admin tab for a path', () => {
    expect(activeAdminHref('/admin')).toBe('/admin')
    expect(activeAdminHref('/admin/')).toBe('/admin')
    expect(activeAdminHref('/admin/members')).toBe('/admin/members')
    expect(activeAdminHref('/admin/trades/extra')).toBe('/admin/trades')
  })
})

describe('member list filters', () => {
  it('maps the default filters onto listMembers, leaving removed accounts out', () => {
    expect(memberListOptions(DEFAULT_MEMBER_FILTERS)).toEqual({
      statuses: null,
      role: null,
      station: null,
      search: '',
      removed: 'exclude',
      order: 'name',
      offset: 0,
      limit: MEMBER_PAGE_SIZE,
    })
  })

  it('passes status, role, station, search and paging', () => {
    expect(
      memberListOptions({ search: 'lee', status: 'suspended', role: 'admin', station: 19 }, { offset: 30, limit: 30 }),
    ).toEqual({
      statuses: ['suspended'],
      role: 'admin',
      station: 19,
      search: 'lee',
      removed: 'exclude',
      order: 'name',
      offset: 30,
      limit: 30,
    })
  })

  it('shows only removed accounts under Removed', () => {
    expect(memberListOptions({ ...DEFAULT_MEMBER_FILTERS, status: 'removed' })).toMatchObject({
      statuses: null,
      removed: 'only',
    })
  })

  it('offers every status plus Removed, and validates filter values', () => {
    expect(STATUS_OPTIONS.map((option) => option.value)).toEqual([
      'all',
      'approved',
      'pending',
      'suspended',
      'rejected',
      'onboarding',
      'removed',
    ])
    expect(isMemberStatusFilter('removed')).toBe(true)
    expect(isMemberStatusFilter('pending')).toBe(true)
    expect(isMemberStatusFilter('deleted')).toBe(false)
  })

  it('labels a removed account as Removed', () => {
    expect(memberStateLabel({ status: 'suspended', removed_at: null })).toBe('Suspended')
    expect(memberStateLabel({ status: 'suspended', removed_at: '2026-09-23T15:00:00Z' })).toBe('Removed')
    expect(memberStateLabel({ status: 'approved', removed_at: undefined })).toBe('Active')
  })
})

describe('account removal helpers', () => {
  const id = member.id

  it('builds a placeholder sign-in email that can never receive mail', () => {
    expect(removedLoginEmail(id)).toBe(`removed+${id}@shiftswap.invalid`)
    expect(isRemovedLoginEmail(removedLoginEmail(id))).toBe(true)
    expect(isRemovedLoginEmail('REMOVED+x@ShiftSwap.invalid')).toBe(true)
    expect(isRemovedLoginEmail('mike@example.com')).toBe(false)
    expect(isRemovedLoginEmail(null)).toBe(false)
  })

  it('spots a removed account whose login step did not finish', () => {
    const removedAt = '2026-09-23T15:00:00Z'
    expect(loginStillOnFile({ removed_at: removedAt, email: 'mike@example.com' })).toBe(true)
    expect(loginStillOnFile({ removed_at: removedAt, email: removedLoginEmail(id) })).toBe(false)
    expect(loginStillOnFile({ removed_at: null, email: 'mike@example.com' })).toBe(false)
  })

  it('summarises what came off the board and what is left to do', () => {
    expect(removalSummary({ posts_cancelled: 2, requests_closed: 1, upcoming_trades: 1 })).toBe(
      "2 open posts taken down, 1 request closed. They still have 1 confirmed trade coming up. Void it in Trades if it won't happen.",
    )
    expect(removalSummary({ posts_cancelled: 0, requests_closed: 0, upcoming_trades: 3 })).toBe(
      "They still have 3 confirmed trades coming up. Void them in Trades if they won't happen.",
    )
    expect(removalSummary({ posts_cancelled: 0, requests_closed: 0, upcoming_trades: 0 })).toBe(
      'Nothing of theirs was on the board.',
    )
    expect(removalSummary(null)).toBe('Their login is closed.')
  })

  it('warns only when the login step did not fully work', () => {
    expect(loginClosureWarning('closed')).toBeNull()
    expect(loginClosureWarning('blocked')).toMatch(/blocked/)
    expect(loginClosureWarning('open')).toMatch(/Finish removal/)
  })
})
