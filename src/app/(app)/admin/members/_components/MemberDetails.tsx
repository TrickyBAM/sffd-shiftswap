import type { ReactNode } from 'react'
import { KeyRound } from 'lucide-react'
import { tourLabel } from '@/lib/format'
import { formatInstant, stationWithBattalion } from '../../_lib/format'
import { ContactButtons } from '../../_components/ContactButtons'
import type { MemberDetail } from '../_lib/edit'
import { isRemoved } from '../_lib/query'
import { isRemovedLoginEmail } from '../_lib/remove'
import { AdminBadge, MemberStatusBadge } from './MemberBadges'

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2.5">
      <dt className="shrink-0 text-sm text-fg-dim">{label}</dt>
      <dd className="min-w-0 break-words text-right text-sm text-fg">{children}</dd>
    </div>
  )
}

const notGiven = <span className="text-fg-muted">Not given</span>
const erased = <span className="text-fg-muted">Erased</span>

/** Read-only view of a member for the member sheet. */
export function MemberDetails({ detail }: { detail: MemberDetail }) {
  const { member, rosterEntry, approvedByName } = detail
  const removed = isRemoved(member)
  const emailErased = removed && isRemovedLoginEmail(member.email)
  const name = member.full_name || (emailErased ? '' : member.email) || 'this member'
  const blank = removed ? erased : notGiven

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <MemberStatusBadge member={member} />
        <AdminBadge role={member.role} />
        {member.must_change_password && !removed ? (
          <span className="inline-flex items-center gap-1 text-xs text-accent-yellow">
            <KeyRound size={14} aria-hidden="true" />
            Must choose a new password at next sign-in
          </span>
        ) : null}
      </div>

      {member.status_reason && (member.status === 'suspended' || member.status === 'rejected') ? (
        <p className="rounded-xl border border-line bg-elevated/60 px-3 py-2 text-sm text-fg-muted">
          <span className="font-semibold text-fg">Reason given: </span>
          {member.status_reason}
        </p>
      ) : null}

      {!removed ? (
        <ContactButtons
          name={name}
          phone={member.phone}
          email={member.email || null}
          smsBody={`Hi ${name.split(' ')[0] || 'there'}, this is the ShiftSwap admin.`}
        />
      ) : null}

      <dl className="divide-y divide-white/[0.06] rounded-xl border border-line px-3">
        <Row label="Rank">{member.rank ?? notGiven}</Row>
        <Row label="Station">{typeof member.station === 'number' ? stationWithBattalion(member.station) : notGiven}</Row>
        <Row label="Tour">{tourLabel(member.tour)}</Row>
        <Row label="Phone">{member.phone || blank}</Row>
        <Row label="Email">{emailErased ? erased : member.email || notGiven}</Row>
        <Row label="Employee ID">{member.employee_id || blank}</Row>
        <Row label="Roster">
          {rosterEntry ? (
            `Linked to ${rosterEntry.first_name} ${rosterEntry.last_name}${
              rosterEntry.employee_id ? ` (ID ${rosterEntry.employee_id})` : ''
            }`
          ) : (
            <span className="text-fg-muted">Not linked</span>
          )}
        </Row>
        <Row label="Signed up">{formatInstant(member.created_at)}</Row>
        {member.approved_at ? (
          <Row label="Approved">
            {formatInstant(member.approved_at)}
            <span className="block text-xs text-fg-muted">
              {approvedByName ? `by ${approvedByName}` : 'automatically (roster match)'}
            </span>
          </Row>
        ) : null}
        {member.removed_at ? <Row label="Removed">{formatInstant(member.removed_at)}</Row> : null}
      </dl>
    </div>
  )
}
