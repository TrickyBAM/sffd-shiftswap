'use client'

import { useState } from 'react'
import { ErrorState, LoadingBlock, Sheet } from '@/components/ui'
import { useProfile } from '@/components/providers/ProfileProvider'
import { createClient } from '@/lib/supabase/client'
import { useAsyncData } from '../../_lib/useAsyncData'
import { loadMemberDetail } from '../_lib/edit'
import { statusLabel } from '../_lib/query'
import { MemberActions } from './MemberActions'
import { MemberDetails } from './MemberDetails'
import { MemberEditForm } from './MemberEditForm'

export interface MemberSheetProps {
  memberId: string
  onClose: () => void
  /** Called after any change so the list and counts can reload. */
  onChanged: () => void
}

/** Everything about one member, with edit and admin actions. */
export function MemberSheet({ memberId, onClose, onChanged }: MemberSheetProps) {
  const { profile } = useProfile()
  const [editing, setEditing] = useState(false)
  const detail = useAsyncData(() => loadMemberDetail(createClient(), memberId), memberId)
  const member = detail.data?.member

  function changed() {
    detail.reload()
    onChanged()
  }

  const title = member ? member.full_name || member.email || 'Member' : 'Member'
  const description = member
    ? editing
      ? 'Edit their details'
      : [member.rank, statusLabel(member.status)].filter(Boolean).join(' · ')
    : undefined

  return (
    <Sheet
      open
      onClose={onClose}
      title={title}
      description={description}
      closeOnOverlay={!editing}
      closeOnEscape={!editing}
    >
      <div className="pb-2">
        {detail.data && detail.error ? (
          <p role="alert" className="mb-4 text-sm text-accent-yellow">
            Couldn&apos;t refresh these details. {detail.error.message}{' '}
            <button type="button" onClick={detail.reload} className="min-h-11 font-semibold text-fg underline">
              Try again
            </button>
          </p>
        ) : null}
        {detail.data ? (
          editing ? (
            <MemberEditForm
              member={detail.data.member}
              onCancel={() => setEditing(false)}
              onSaved={() => {
                setEditing(false)
                changed()
              }}
            />
          ) : (
            <div className="space-y-6">
              <MemberDetails detail={detail.data} />
              <MemberActions
                member={detail.data.member}
                myId={profile.id}
                onEdit={() => setEditing(true)}
                onChanged={changed}
              />
            </div>
          )
        ) : detail.error ? (
          <ErrorState title="Couldn't load this member" message={detail.error.message} onRetry={detail.reload} />
        ) : (
          <LoadingBlock label="Loading member…" cards={2} />
        )}
      </div>
    </Sheet>
  )
}
