// One page of /admin/activity: audit entries plus the member names and shifts
// needed to describe them.

import { getShiftsByIds, listAuditLog, type Page, type Sb } from '@/lib/api'
import type { AuditEntry } from '@/lib/types/database'
import { fetchMemberNames } from '../../_lib/queries'
import { describeActivity, memberIdsIn, shiftIdIn, type ActivityLine } from './describe'

export const ACTIVITY_PAGE_SIZE = 40

export interface ActivityItem {
  entry: AuditEntry
  line: ActivityLine
}

/** Entries older than `before` (null = newest), filtered by action or action prefix. */
export async function loadActivityPage(
  sb: Sb,
  action: string,
  before: number | null,
): Promise<Page<ActivityItem, number>> {
  const page = await listAuditLog(sb, { action: action || null, before, limit: ACTIVITY_PAGE_SIZE })
  const memberIds = page.items.flatMap(memberIdsIn)
  const shiftIds = page.items.map(shiftIdIn).filter((id): id is string => Boolean(id))
  const [names, shifts] = await Promise.all([
    fetchMemberNames(sb, memberIds),
    shiftIds.length ? getShiftsByIds(sb, shiftIds) : Promise.resolve([]),
  ])
  const ctx = { names, shifts: new Map(shifts.map((shift) => [shift.id, shift])) }
  return {
    items: page.items.map((entry) => ({ entry, line: describeActivity(entry, ctx) })),
    nextCursor: page.nextCursor,
  }
}
