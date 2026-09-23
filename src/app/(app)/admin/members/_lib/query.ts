// Member search for /admin/members: like listMembers() in src/lib/api/admin.ts
// plus a station filter.

import type { CountedPage, Sb } from '@/lib/api'
import { clampLimit, ilikeContains, runQuery, sanitizeSearch } from '@/lib/api/core'
import type { MemberStatus, Profile, Role } from '@/lib/types/database'

export interface MemberFilters {
  /** Name, email, phone or employee ID (contains, any case). */
  search: string
  status: MemberStatus | 'all'
  role: Role | 'all'
  station: number | null
}

export const DEFAULT_MEMBER_FILTERS: MemberFilters = { search: '', status: 'all', role: 'all', station: null }

export const MEMBER_PAGE_SIZE = 30

export const STATUS_OPTIONS: ReadonlyArray<{ value: MemberFilters['status']; label: string }> = [
  { value: 'all', label: 'Everyone' },
  { value: 'approved', label: 'Active' },
  { value: 'pending', label: 'Waiting for approval' },
  { value: 'suspended', label: 'Suspended' },
  { value: 'rejected', label: 'Turned down' },
  { value: 'onboarding', label: 'Still signing up' },
]

/** Plain-English label for a member status. */
export function statusLabel(status: MemberStatus): string {
  switch (status) {
    case 'approved':
      return 'Active'
    case 'pending':
      return 'Waiting for approval'
    case 'suspended':
      return 'Suspended'
    case 'rejected':
      return 'Turned down'
    case 'onboarding':
      return 'Still signing up'
  }
}

/** Members matching the filters, by name, with the total count for paging. */
export async function queryMembers(
  sb: Sb,
  filters: MemberFilters,
  options: { offset?: number; limit?: number } = {},
): Promise<CountedPage<Profile>> {
  const limit = clampLimit(options.limit, MEMBER_PAGE_SIZE, 200)
  const offset = Math.max(0, Math.trunc(options.offset ?? 0))
  let query = sb.from('profiles').select('*', { count: 'exact' })
  if (filters.status !== 'all') query = query.eq('status', filters.status)
  if (filters.role !== 'all') query = query.eq('role', filters.role)
  if (typeof filters.station === 'number') query = query.eq('station', filters.station)
  const search = sanitizeSearch(filters.search)
  if (search) {
    query = query.or(
      ['full_name', 'email', 'phone', 'employee_id'].map((column) => ilikeContains(column, search)).join(','),
    )
  }
  const { data, count } = await runQuery<Profile[] | null>(
    query.order('full_name').order('created_at').order('id').range(offset, offset + limit - 1),
  )
  const items = Array.isArray(data) ? data : []
  return { items, total: count ?? items.length }
}
