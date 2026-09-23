// Member edit form: values, validation (mirrors admin_update_member) and the
// data the member sheet loads.

import { getMember, getRosterEntry, type AdminUpdateMemberInput, type Sb } from '@/lib/api'
import { AppError } from '@/lib/errors'
import { isRank, type Rank } from '@/lib/sffd/ranks'
import { isStation } from '@/lib/sffd/stations'
import { isTour } from '@/lib/sffd/tours'
import type { Profile, RosterEntry } from '@/lib/types/database'
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

/** Same rule as private.valid_phone(): 7–20 of digits, spaces, +, -, ( ). */
const PHONE_RE = /^[0-9+() -]{7,20}$/

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

/** Collapses whitespace like private.clean_name(). */
export function cleanText(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

/** Field errors (empty object when the values can be saved). */
export function validateMemberEdit(values: MemberEditValues): MemberEditErrors {
  const errors: MemberEditErrors = {}
  const name = cleanText(values.fullName)
  if (name.length < 2 || name.length > 80) errors.fullName = 'Enter their full name (2 to 80 characters).'
  if (!isRank(values.rank)) errors.rank = 'Choose a rank.'
  if (values.station === null || !isStation(values.station)) errors.station = 'Choose a station.'
  if (values.tour !== null && !isTour(values.tour)) errors.tour = 'Choose a tour from 1 to 31, or No tour.'
  if (!PHONE_RE.test(values.phone.trim())) {
    errors.phone = 'Enter a phone number (7 to 20 digits, spaces, +, - or parentheses).'
  }
  if (values.employeeId.trim().length > 40) errors.employeeId = 'Employee ID is too long (40 characters at most).'
  return errors
}

/** The admin_update_member input for valid values. */
export function toUpdateInput(values: MemberEditValues): AdminUpdateMemberInput {
  if (!isRank(values.rank) || values.station === null) {
    throw new AppError('INVALID_INPUT', 'Choose a rank and a station.')
  }
  return {
    fullName: cleanText(values.fullName),
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
    cleanText(values.fullName) !== cleanText(saved.fullName) ||
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
  if (!member) throw new AppError('NOT_FOUND', "That member wasn't found. They may have been removed.")
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
