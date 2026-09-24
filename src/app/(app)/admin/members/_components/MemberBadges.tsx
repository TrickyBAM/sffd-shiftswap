import { ShieldCheck } from 'lucide-react'
import { Badge, type BadgeTone } from '@/components/ui'
import type { MemberStatus, Profile, Role } from '@/lib/types/database'
import { isRemoved, memberStateLabel } from '../_lib/query'

const STATUS_TONES: Record<MemberStatus, BadgeTone> = {
  approved: 'green',
  pending: 'yellow',
  suspended: 'red',
  rejected: 'gray',
  onboarding: 'neutral',
}

/** "Active", "Waiting for approval", "Suspended", "Removed", … as a coloured badge. */
export function MemberStatusBadge({ member }: { member: Pick<Profile, 'status' | 'removed_at'> }) {
  return <Badge tone={isRemoved(member) ? 'gray' : STATUS_TONES[member.status]}>{memberStateLabel(member)}</Badge>
}

/** "Admin" badge; nothing for ordinary members. */
export function AdminBadge({ role }: { role: Role }) {
  if (role !== 'admin') return null
  return (
    <Badge tone="blue">
      <ShieldCheck size={12} aria-hidden="true" />
      Admin
    </Badge>
  )
}
