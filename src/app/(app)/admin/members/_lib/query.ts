// The /admin/members filters and how they map onto listMembers() in
// src/lib/api/admin.ts (the one member query, CC-5), plus plain-English
// labels for a member's state.

import type { ListMembersOptions } from '@/lib/api'
import { isMemberStatus, type MemberStatus, type Profile, type Role } from '@/lib/types/database'

/**
 * A status, 'all', or 'removed' (accounts an admin removed at the member's
 * request, profiles.removed_at). Every choice except 'removed' leaves removed
 * accounts out: they are gone and only kept so trade history makes sense.
 */
export type MemberStatusFilter = MemberStatus | 'all' | 'removed'

export interface MemberFilters {
  /** Name, email, phone or employee ID (contains, any case). */
  search: string
  status: MemberStatusFilter
  role: Role | 'all'
  station: number | null
}

export const DEFAULT_MEMBER_FILTERS: MemberFilters = { search: '', status: 'all', role: 'all', station: null }

export const MEMBER_PAGE_SIZE = 30

export const STATUS_OPTIONS: ReadonlyArray<{ value: MemberStatusFilter; label: string }> = [
  { value: 'all', label: 'Everyone' },
  { value: 'approved', label: 'Active' },
  { value: 'pending', label: 'Waiting for approval' },
  { value: 'suspended', label: 'Suspended' },
  { value: 'rejected', label: 'Turned down' },
  { value: 'onboarding', label: 'Still signing up' },
  { value: 'removed', label: 'Removed' },
]

export function isMemberStatusFilter(value: unknown): value is MemberStatusFilter {
  return value === 'all' || value === 'removed' || isMemberStatus(value)
}

/** listMembers() options for the filters and page (sorted by name). */
export function memberListOptions(
  filters: MemberFilters,
  page: { offset?: number; limit?: number } = {},
): ListMembersOptions {
  const { status } = filters
  const removedOnly = status === 'removed'
  return {
    statuses: status === 'all' || status === 'removed' ? null : [status],
    role: filters.role === 'all' ? null : filters.role,
    station: filters.station,
    search: filters.search,
    removed: removedOnly ? 'only' : 'exclude',
    order: 'name',
    offset: page.offset ?? 0,
    limit: page.limit ?? MEMBER_PAGE_SIZE,
  }
}

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

/** True for an account an admin removed (admin_remove_member). */
export function isRemoved(member: Pick<Profile, 'removed_at'>): boolean {
  return Boolean(member.removed_at)
}

/** "Removed" for a removed account, otherwise the status label. */
export function memberStateLabel(member: Pick<Profile, 'status' | 'removed_at'>): string {
  return isRemoved(member) ? 'Removed' : statusLabel(member.status)
}
