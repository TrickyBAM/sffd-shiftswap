// The department roster (admin-only): import, browse, delete, and the
// candidates shown when approving a member by hand (ARCHITECTURE §6.1
// "roster", §6.3 admin_import_roster, §6.4).

import { nameKey, splitFullName } from '@/lib/roster/normalize'
import type { ImportRosterResult, RosterEntry, RosterImportRow } from '@/lib/types/database'
import {
  callRpc,
  clampLimit,
  ilikeContains,
  isUuid,
  runList,
  runMaybe,
  runQuery,
  sanitizeSearch,
  type CountedPage,
  type Sb,
} from './core'

/**
 * Imports roster rows (admin_import_roster), e.g. from parseRosterCsv(). With
 * `replace`, every unclaimed entry is deleted first. Invalid rows are skipped
 * and reported in `errors` (1-based row numbers within `rows`).
 */
export async function importRoster(
  sb: Sb,
  rows: readonly RosterImportRow[],
  options: { replace?: boolean } = {},
): Promise<ImportRosterResult> {
  const result = await callRpc(sb, 'admin_import_roster', { p_rows: [...rows], p_replace: options.replace ?? false })
  return {
    inserted: result?.inserted ?? 0,
    updated: result?.updated ?? 0,
    skipped: result?.skipped ?? 0,
    deleted: result?.deleted ?? 0,
    errors: Array.isArray(result?.errors) ? result.errors : [],
  }
}

/** Deletes one roster entry (admin_delete_roster_entry; a linked member is unlinked). */
export async function deleteRosterEntry(sb: Sb, id: string): Promise<void> {
  await callRpc(sb, 'admin_delete_roster_entry', { p_id: id })
}

/** One roster entry, or null. */
export async function getRosterEntry(sb: Sb, id: string): Promise<RosterEntry | null> {
  if (!isUuid(id)) return null
  return runMaybe<RosterEntry>(sb.from('roster').select('*').eq('id', id).maybeSingle())
}

export interface ListRosterOptions {
  /** Matches first/last name, employee ID or email (contains, case-insensitive). */
  search?: string | null
  /** true = linked to a member, false = unclaimed, omitted = both. */
  claimed?: boolean | null
  station?: number | null
  /** Page size (default 100, max 500). */
  limit?: number
  offset?: number
}

/** Roster entries for /admin/roster, by last then first name, with the total count. */
export async function listRoster(sb: Sb, options: ListRosterOptions = {}): Promise<CountedPage<RosterEntry>> {
  const limit = clampLimit(options.limit, 100, 500)
  const offset = Math.max(0, Math.trunc(options.offset ?? 0))
  let query = sb.from('roster').select('*', { count: 'exact' })
  if (options.claimed === true) query = query.not('claimed_by', 'is', null)
  if (options.claimed === false) query = query.is('claimed_by', null)
  if (options.station != null) query = query.eq('station', options.station)
  const search = sanitizeSearch(options.search)
  if (search) {
    query = query.or(
      ['first_name', 'last_name', 'employee_id', 'email'].map((column) => ilikeContains(column, search)).join(','),
    )
  }
  const { data, count } = await runQuery<RosterEntry[] | null>(
    query.order('last_key').order('first_key').order('id').range(offset, offset + limit - 1),
  )
  const items = Array.isArray(data) ? data : []
  return { items, total: count ?? items.length }
}

/**
 * Roster entries that could be `fullName` (same last-name key as roster
 * matching uses: the last word, or everything after the first name for
 * compound names like "Maria De La Cruz"), best first: exact first name, then
 * a matching initial, then the rest; unclaimed before claimed. For picking an
 * entry when approving someone by hand.
 */
export async function findRosterCandidates(sb: Sb, fullName: string): Promise<RosterEntry[]> {
  const keys = rosterLastKeys(fullName)
  if (!keys.length) return []
  const rows = await runList<RosterEntry>(
    sb.from('roster').select('*').in('last_key', keys).order('first_key').order('id').limit(100),
  )
  return rankRosterCandidates(rows, fullName)
}

/** The last-name keys roster matching tries for a full name (§6.4). */
export function rosterLastKeys(fullName: string): string[] {
  const name = splitFullName(fullName)
  if (!name) return []
  const keys = [nameKey(name.last)]
  if (name.middle) keys.push(nameKey(`${name.middle} ${name.last}`))
  return [...new Set(keys.filter(Boolean))]
}

/** Orders roster rows for `fullName`: exact first-name key, then initial, then others; unclaimed first. */
export function rankRosterCandidates<T extends Pick<RosterEntry, 'first_key' | 'claimed_by'>>(
  rows: readonly T[],
  fullName: string,
): T[] {
  const firstKey = nameKey(splitFullName(fullName)?.first)
  const score = (row: T): number => {
    let s = 0
    if (firstKey && row.first_key === firstKey) s += 4
    else if (firstKey && row.first_key.length === 1 && row.first_key === firstKey[0]) s += 2
    if (!row.claimed_by) s += 1
    return s
  }
  return rows
    .map((row, index) => ({ row, index, s: score(row) }))
    .sort((a, b) => b.s - a.s || a.index - b.index)
    .map((x) => x.row)
}
