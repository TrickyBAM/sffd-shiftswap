import { ShieldCheck } from 'lucide-react'
import { Badge, type BadgeTone } from '@/components/ui'
import type { MemberStatus, Role } from '@/lib/types/database'
import { statusLabel } from '../_lib/query'

const STATUS_TONES: Record<MemberStatus, BadgeTone> = {
  approved: 'green',
  pending: 'yellow',
  suspended: 'red',
  rejected: 'gray',
  onboarding: 'neutral',
}

/** "Active", "Waiting for approval", "Suspended", … as a coloured badge. */
export function MemberStatusBadge({ status }: { status: MemberStatus }) {
  return <Badge tone={STATUS_TONES[status]}>{statusLabel(status)}</Badge>
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
