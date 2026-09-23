// Small admin-only reads that the shared API layer (src/lib/api) doesn't cover.
// They rely on the admin RLS policies (admins can read every profile).

import { isUuid, type Sb } from '@/lib/api'
import { runList } from '@/lib/api/core'
import type { Profile } from '@/lib/types/database'

/** How many ids go into one `in (...)` filter (keeps request URLs short). */
const ID_CHUNK = 100

/** Member names by id (unknown ids are left out). */
export async function fetchMemberNames(sb: Sb, ids: Iterable<string | null | undefined>): Promise<Map<string, string>> {
  const unique = [...new Set([...ids].filter((id): id is string => isUuid(id)))]
  const names = new Map<string, string>()
  for (let i = 0; i < unique.length; i += ID_CHUNK) {
    const chunk = unique.slice(i, i + ID_CHUNK)
    const rows = await runList<Pick<Profile, 'id' | 'full_name' | 'email'>>(
      sb.from('profiles').select('id, full_name, email').in('id', chunk),
    )
    for (const row of rows) names.set(row.id, row.full_name?.trim() || row.email || 'Unnamed member')
  }
  return names
}

export interface RecentMember {
  member: Profile
  /** Name of the admin who approved them; null when the roster match approved them. */
  approvedByName: string | null
}

/**
 * Members approved in the last `days` days, newest approval first. A member
 * with `approved_by` null was auto-approved by a roster match.
 */
export async function listRecentlyJoined(sb: Sb, days = 14, now: Date = new Date()): Promise<RecentMember[]> {
  const since = new Date(now.getTime() - days * 86_400_000).toISOString()
  const members = await runList<Profile>(
    sb
      .from('profiles')
      .select('*')
      .eq('status', 'approved')
      .gte('approved_at', since)
      .order('approved_at', { ascending: false })
      .order('id')
      .limit(100),
  )
  const names = await fetchMemberNames(
    sb,
    members.map((m) => m.approved_by),
  )
  return members.map((member) => ({
    member,
    approvedByName: member.approved_by ? (names.get(member.approved_by) ?? 'an admin') : null,
  }))
}
