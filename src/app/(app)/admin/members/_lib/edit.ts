// Member edit form: values, validation and the data the member sheet loads.
// The rules are the shared ones in src/lib/validation.ts (CC-6), so a phone
// number an admin saves is one the member's own Profile form accepts too:
// 7 to 20 digits, spaces, +, - or parentheses, with at least 7 digits.

import { getMember, getRosterEntry, type AdminUpdateMemberInput, type Sb } from '@/lib/api'
import { AppError } from '@/lib/errors'
import { isRank, type Rank } from '@/lib/sffd/ranks'
import { isStation } from '@/lib/sffd/stations'
import { isTour } from '@/lib/sffd/tours'
import type { Profile, RosterEntry } from '@/lib/types/database'
import { cleanName, employeeIdError, fullNameError, phoneError } from '@/lib/validation'
import { fetchMemberNames } from '../../_lib/queries'

export interface MemberEditValues {
  fullName: string
  rank: Rank | ''
  station: number | null
  tour: number | null
  phone: string
  employeeId: string
}

export type MemberEditErrors = Partial<Record<keyof MemberEditValues, string>>

export function editValuesFrom(member: Profile): MemberEditValues {
  return {
    fullName: member.full_name ?? '',
    rank: member.rank ?? '',
    station: member.station,
    tour: member.tour,
    phone: member.phone ?? '',
    employeeId: member.employee_id ?? '',
  }
}

/** Field errors (empty object when the values can be saved). */
export function validateMemberEdit(values: MemberEditValues): MemberEditErrors {
  const errors: MemberEditErrors = {}
  const name = fullNameError(values.fullName)
  if (name) errors.fullName = name
  if (!isRank(values.rank)) errors.rank = 'Choose a rank.'
  if (values.station === null || !isStation(values.station)) errors.station = 'Choose a station.'
  if (values.tour !== null && !isTour(values.tour)) errors.tour = 'Choose a tour from 1 to 31, or No tour.'
  const phone = phoneError(values.phone)
  if (phone) errors.phone = phone
  const employeeId = employeeIdError(values.employeeId)
  if (employeeId) errors.employeeId = employeeId
  return errors
}

/** The admin_update_member input for valid values. */
export function toUpdateInput(values: MemberEditValues): AdminUpdateMemberInput {
  if (!isRank(values.rank) || values.station === null) {
    throw new AppError('INVALID_INPUT', 'Choose a rank and a station.')
  }
  return {
    fullName: cleanName(values.fullName),
    rank: values.rank,
    station: values.station,
    tour: values.tour,
    phone: values.phone.trim(),
    employeeId: values.employeeId.trim() || null,
  }
}

/** True when the form differs from the saved member. */
export function isDirty(values: MemberEditValues, member: Profile): boolean {
  const saved = editValuesFrom(member)
  return (
    cleanName(values.fullName) !== cleanName(saved.fullName) ||
    values.rank !== saved.rank ||
    values.station !== saved.station ||
    values.tour !== saved.tour ||
    values.phone.trim() !== saved.phone.trim() ||
    values.employeeId.trim() !== saved.employeeId.trim()
  )
}

export interface MemberDetail {
  member: Profile
  rosterEntry: RosterEntry | null
  approvedByName: string | null
}

/** Everything the member sheet shows. Throws AppError NOT_FOUND if the member is gone. */
export async function loadMemberDetail(sb: Sb, memberId: string): Promise<MemberDetail> {
  const member = await getMember(sb, memberId)
  if (!member) throw new AppError('NOT_FOUND', "That member wasn't found.")
  const [rosterEntry, names] = await Promise.all([
    member.roster_id ? getRosterEntry(sb, member.roster_id) : Promise.resolve(null),
    fetchMemberNames(sb, [member.approved_by]),
  ])
  return {
    member,
    rosterEntry,
    approvedByName: member.approved_by ? (names.get(member.approved_by) ?? 'an admin') : null,
  }
}
