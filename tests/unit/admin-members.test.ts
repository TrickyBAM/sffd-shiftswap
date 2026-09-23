import { describe, expect, it } from 'vitest'
import { dialable, smsHref, stationText, telHref, timeAgo, tourText } from '@/app/(app)/admin/_lib/format'
import { activeAdminHref } from '@/app/(app)/admin/_components/AdminTabs'
import {
  editValuesFrom,
  isDirty,
  toUpdateInput,
  validateMemberEdit,
  type MemberEditValues,
} from '@/app/(app)/admin/members/_lib/edit'
import { statusLabel } from '@/app/(app)/admin/members/_lib/query'
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
  it('builds tel: and sms: links from typed phone numbers', () => {
    expect(dialable('(415) 555-0123')).toBe('4155550123')
    expect(dialable('+1 415 555 0123')).toBe('+14155550123')
    expect(telHref('(415) 555-0123')).toBe('tel:4155550123')
    expect(telHref('')).toBeNull()
    expect(smsHref('415-555-0123')).toBe('sms:4155550123')
    expect(smsHref('415-555-0123', 'Hi & bye')).toBe('sms:4155550123?&body=Hi%20%26%20bye')
    expect(smsHref(null, 'x')).toBeNull()
  })

  it('formats tours, stations and relative times', () => {
    expect(tourText(7)).toBe('Tour 7')
    expect(tourText(null)).toBe('No tour')
    expect(stationText(19)).toBe('Station 19')
    expect(stationText(null)).toBe('No station')
    const now = Date.parse('2026-09-23T12:00:00Z')
    expect(timeAgo('2026-09-23T11:59:50Z', now)).toBe('just now')
    expect(timeAgo('2026-09-23T11:55:00Z', now)).toBe('5 min ago')
    expect(timeAgo('2026-09-23T09:00:00Z', now)).toBe('3 hr ago')
    expect(timeAgo('2026-09-22T12:00:00Z', now)).toBe('yesterday')
    expect(timeAgo('2026-09-20T12:00:00Z', now)).toBe('3 days ago')
    expect(timeAgo('nope', now)).toBe('')
  })

  it('picks the admin tab for a path', () => {
    expect(activeAdminHref('/admin')).toBe('/admin')
    expect(activeAdminHref('/admin/')).toBe('/admin')
    expect(activeAdminHref('/admin/members')).toBe('/admin/members')
    expect(activeAdminHref('/admin/trades/extra')).toBe('/admin/trades')
  })
})
