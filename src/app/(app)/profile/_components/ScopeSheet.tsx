'use client'

import { useId, useState, type FormEvent } from 'react'
import { FormAlert } from '@/components/forms/FormAlert'
import { Button, Sheet, useToast } from '@/components/ui'
import { useProfile } from '@/components/providers/ProfileProvider'
import { getMyProfile, updateMyProfile } from '@/lib/api'
import { errorMessage } from '@/lib/errors'
import { createClient } from '@/lib/supabase/client'
import { isNotifyScope, type NotifyScope } from '@/lib/types/database'
import { ScopeRadios } from './ScopeRadios'

const MISSING_DETAILS_MESSAGE = 'Add your phone number and station in Edit my details first, then choose your alerts.'

/**
 * Profile ▸ Alerts ▸ Change (UX-07): a small sheet with only the new-shift
 * alert choice. update_my_profile saves every editable field at once, so the
 * other fields are sent as they are saved right now (re-read first, so a
 * change made on another device isn't undone). Mount it when opening.
 */
export function ScopeSheet({ onClose }: { onClose: () => void }) {
  const { profile, refresh } = useProfile()
  const toast = useToast()
  const formId = useId()
  const saved: NotifyScope = isNotifyScope(profile.notify_scope) ? profile.notify_scope : 'battalion'
  const [scope, setScope] = useState<NotifyScope>(saved)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  // Bumped on every failed save, so the same message is announced again.
  const [attempt, setAttempt] = useState(0)
  const changed = scope !== saved

  function fail(message: string) {
    setFormError(message)
    setAttempt((n) => n + 1)
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (saving) return
    if (!changed) {
      onClose()
      return
    }
    setFormError(null)
    setSaving(true)
    try {
      const sb = createClient()
      const current = (await getMyProfile(sb, profile.id)) ?? profile
      if (!current.phone || current.station === null) {
        setSaving(false)
        fail(MISSING_DETAILS_MESSAGE)
        return
      }
      await updateMyProfile(sb, {
        phone: current.phone,
        station: current.station,
        tour: current.tour,
        notifyScope: scope,
      })
    } catch (error) {
      setSaving(false)
      fail(errorMessage(error))
      return
    }
    // Stay busy until the sheet closes.
    try {
      await refresh()
      toast.success('New-shift alerts updated')
    } catch {
      toast.show({
        tone: 'success',
        title: 'New-shift alerts updated',
        description: "Reload the page if you don't see the change yet.",
      })
    }
    onClose()
  }

  return (
    <Sheet
      open
      onClose={saving ? () => {} : onClose}
      title="New-shift alerts"
      description="Choose which new shifts you get an alert about."
      closeOnOverlay={!changed && !saving}
      closeOnEscape={!saving}
      footer={
        <div className="space-y-3">
          {formError ? <FormAlert key={attempt}>{formError}</FormAlert> : null}
          <div className="flex gap-2">
            <Button variant="secondary" onClick={onClose} disabled={saving}>
              Cancel
            </Button>
            <Button type="submit" form={formId} fullWidth loading={saving} disabled={!changed}>
              Save
            </Button>
          </div>
        </div>
      }
    >
      <form id={formId} onSubmit={save} noValidate className="pt-2">
        <ScopeRadios value={scope} onChange={setScope} station={profile.station} disabled={saving} />
      </form>
    </Sheet>
  )
}
