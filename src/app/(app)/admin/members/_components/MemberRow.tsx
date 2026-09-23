'use client'

import { ChevronRight } from 'lucide-react'
import { Avatar } from '@/components/ui'
import { tourLabel } from '@/lib/format'
import type { Profile } from '@/lib/types/database'
import { stationText } from '../../_lib/format'
import { isRemoved } from '../_lib/query'
import { isRemovedLoginEmail } from '../_lib/remove'
import { AdminBadge, MemberStatusBadge } from './MemberBadges'

export interface MemberRowProps {
  member: Profile
  onOpen: (memberId: string) => void
}

/** One member in the list; tapping opens their sheet. */
export function MemberRow({ member, onOpen }: MemberRowProps) {
  const removed = isRemoved(member)
  const email = isRemovedLoginEmail(member.email) ? '' : member.email
  const name = member.full_name || email || 'New member'
  const details =
    member.status === 'onboarding' && !member.rank
      ? 'Hasn’t finished signing up'
      : `${member.rank ?? 'No rank'} · ${stationText(member.station)} · ${tourLabel(member.tour)}`
  const contact = removed
    ? 'Contact details erased'
    : [email, member.phone].filter(Boolean).join(' · ') || 'No contact details'

  return (
    <li>
      <button
        type="button"
        onClick={() => onOpen(member.id)}
        className="flex min-h-16 w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-white/[0.03] focus-visible:bg-white/[0.03]"
      >
        <Avatar name={name} colorKey={member.id} />
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="truncate font-semibold text-fg">{name}</span>
            {member.status !== 'approved' ? <MemberStatusBadge member={member} /> : null}
            <AdminBadge role={member.role} />
          </span>
          <span className="mt-0.5 block truncate text-sm text-fg-muted">{details}</span>
          <span className="block truncate text-xs text-fg-dim">{contact}</span>
        </span>
        <ChevronRight size={18} aria-hidden="true" className="shrink-0 text-fg-dim" />
      </button>
    </li>
  )
}
