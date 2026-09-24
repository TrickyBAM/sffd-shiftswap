'use client'

import { useState } from 'react'
import { UserX } from 'lucide-react'
import { Button, useToast } from '@/components/ui'
import { NETWORK_MESSAGE } from '@/lib/errors'
import type { Profile } from '@/lib/types/database'
import { removeMember } from '../../actions'
import { formatInstantDate } from '../../_lib/format'
import { loginClosureWarning, loginStillOnFile } from '../_lib/remove'

export interface RemovedAccountProps {
  member: Pick<Profile, 'id' | 'full_name' | 'email' | 'removed_at'>
  /** Reload after Finish removal. */
  onChanged: () => void
}

/**
 * The Manage section of a removed account: what removal means, and "Finish
 * removal" when the login step didn't complete (their sign-in email is still
 * on file), which retries closing the login.
 */
export function RemovedAccount({ member, onChanged }: RemovedAccountProps) {
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  const unfinished = loginStillOnFile(member)
  const when = formatInstantDate(member.removed_at)

  async function finish() {
    if (busy) return
    setBusy(true)
    try {
      const result = await removeMember(member.id, '')
      if (!result.ok) {
        toast.error("Couldn't finish the removal", result.message)
        return
      }
      const warning = loginClosureWarning(result.login)
      if (warning) toast.show({ tone: 'warning', title: 'Their login needs another try', description: warning, duration: 0 })
      else toast.success('Removal finished', 'Their login is closed and their email is erased.')
      onChanged()
    } catch {
      toast.error("Couldn't finish the removal", NETWORK_MESSAGE)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold uppercase tracking-wide text-fg-dim">Manage</h3>
      <div className="flex items-start gap-3 rounded-xl border border-line bg-elevated/60 px-3 py-3 text-sm text-fg-muted">
        <UserX size={18} aria-hidden="true" className="mt-0.5 shrink-0 text-fg-dim" />
        <p>
          This account was removed{when ? ` on ${when}` : ''} at the member&apos;s request. Their contact details are
          erased and they can&apos;t sign in. Their name stays on past trades. If they want to come back, they sign up
          again with their email.
        </p>
      </div>
      {unfinished ? (
        <div role="status" className="space-y-3 rounded-xl border border-accent-yellow/30 bg-accent-yellow/[0.07] px-3 py-3">
          <p className="text-sm text-fg">
            The last step didn&apos;t finish: their sign-in email is still on file, so their login may still work.
          </p>
          <Button variant="secondary" loading={busy} onClick={() => void finish()} fullWidth>
            Finish removal
          </Button>
        </div>
      ) : null}
    </div>
  )
}
