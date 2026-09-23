// Compares a roster entry with a member's sign-up details, the same way
// roster matching does (ARCHITECTURE §6.4 + §9): every attribute the roster
// entry has is checked; a blank employee ID on the member counts as a mismatch
// when the roster entry has one.

import type { Profile, RosterEntry } from '@/lib/types/database'
import { stationText, tourText } from './format'

export type CompareStatus = 'match' | 'differs'

export interface CompareItem {
  field: 'employee_id' | 'rank' | 'station' | 'tour' | 'email'
  label: string
  status: CompareStatus
  /** What the roster says, for display. */
  roster: string
  /** What the member entered, for display ('not given' when blank). */
  member: string
}

type RosterFields = Pick<RosterEntry, 'employee_id' | 'rank' | 'station' | 'tour' | 'email'>
type MemberFields = Pick<Profile, 'employee_id' | 'rank' | 'station' | 'tour' | 'email'>

const NOT_GIVEN = 'not given'

function normText(value: string | null | undefined): string {
  return (value ?? '').trim().toLowerCase()
}

/** One item per attribute the roster entry has, in a fixed order. */
export function compareRosterToMember(entry: RosterFields, member: MemberFields): CompareItem[] {
  const items: CompareItem[] = []
  if (normText(entry.employee_id)) {
    items.push({
      field: 'employee_id',
      label: 'Employee ID',
      status: normText(entry.employee_id) === normText(member.employee_id) ? 'match' : 'differs',
      roster: entry.employee_id!.trim(),
      member: member.employee_id?.trim() || NOT_GIVEN,
    })
  }
  if (entry.rank) {
    items.push({
      field: 'rank',
      label: 'Rank',
      status: entry.rank === member.rank ? 'match' : 'differs',
      roster: entry.rank,
      member: member.rank ?? NOT_GIVEN,
    })
  }
  if (typeof entry.station === 'number') {
    items.push({
      field: 'station',
      label: 'Station',
      status: entry.station === member.station ? 'match' : 'differs',
      roster: stationText(entry.station),
      member: typeof member.station === 'number' ? stationText(member.station) : NOT_GIVEN,
    })
  }
  if (typeof entry.tour === 'number') {
    items.push({
      field: 'tour',
      label: 'Tour',
      status: entry.tour === member.tour ? 'match' : 'differs',
      roster: tourText(entry.tour),
      member: tourText(member.tour),
    })
  }
  if (normText(entry.email)) {
    items.push({
      field: 'email',
      label: 'Email',
      status: normText(entry.email) === normText(member.email) ? 'match' : 'differs',
      roster: entry.email!.trim(),
      member: member.email?.trim() || NOT_GIVEN,
    })
  }
  return items
}

/** "Rank, station and tour match" style summary of the matching fields. */
export function summarizeMatches(items: readonly CompareItem[]): { matches: number; differs: number } {
  let matches = 0
  let differs = 0
  for (const item of items) {
    if (item.status === 'match') matches++
    else differs++
  }
  return { matches, differs }
}
