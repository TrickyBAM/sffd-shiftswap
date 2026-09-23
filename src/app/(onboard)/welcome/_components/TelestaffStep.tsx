'use client'

import { useId, useState } from 'react'
import { CircleCheck, ScrollText } from 'lucide-react'
import { FormAlert } from '@/app/(auth)/_components/FormAlert'
import { Button } from '@/components/ui/Button'
import { useToast } from '@/components/ui/Toast'
import { acknowledgeTelestaff } from '@/lib/api'
import { toAppError } from '@/lib/errors'
import { createClient } from '@/lib/supabase/client'

/** The notice every member acknowledges once (ARCHITECTURE §0, §1 "Official approval"). */
export const TELESTAFF_NOTICE =
  "ShiftSwap is an unofficial tool made by SFFD members. TeleStaff is the official system of record — a trade here isn't final until it's approved per SFFD policy."

export interface TelestaffStepProps {
  /** Already acknowledged (e.g. the member came back to this step). */
  acknowledged: boolean
  onAcknowledged: () => void
}

export function TelestaffStep({ acknowledged, onAcknowledged }: TelestaffStepProps) {
  const toast = useToast()
  const checkboxId = useId()
  const [understood, setUnderstood] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function acknowledge() {
    if (acknowledged) {
      onAcknowledged()
      return
    }
    if (!understood || saving) return
    setSaving(true)
    setError(null)
    try {
      await acknowledgeTelestaff(createClient())
      onAcknowledged()
    } catch (err) {
      const message = toAppError(err).message
      setError(message)
      toast.error("Couldn't save that", message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3 rounded-xl border border-accent-yellow/30 bg-accent-yellow/[0.07] px-4 py-3">
        <ScrollText size={20} aria-hidden="true" className="mt-0.5 shrink-0 text-accent-yellow" />
        <p className="text-[15px] leading-relaxed text-fg">{TELESTAFF_NOTICE}</p>
      </div>
      <p className="text-sm text-fg-muted">
        Use ShiftSwap to find a trade partner and agree on the details, then submit the trade the usual way.
      </p>

      {error ? <FormAlert>{error}</FormAlert> : null}

      {acknowledged ? (
        <p className="flex items-center gap-2 text-sm text-fg">
          <CircleCheck size={18} aria-hidden="true" className="shrink-0 text-accent-green" />
          You&apos;ve acknowledged this.
        </p>
      ) : (
        <label
          htmlFor={checkboxId}
          className="flex min-h-11 cursor-pointer items-center gap-3 rounded-xl border border-line-strong bg-elevated px-4 py-3 text-[15px] font-medium text-fg"
        >
          <input
            id={checkboxId}
            type="checkbox"
            checked={understood}
            onChange={(event) => setUnderstood(event.target.checked)}
            disabled={saving}
            className="h-5 w-5 shrink-0 cursor-pointer accent-[#D32F2F]"
          />
          I understand
        </label>
      )}

      <Button size="lg" fullWidth loading={saving} disabled={!acknowledged && !understood} onClick={acknowledge}>
        Continue
      </Button>
    </div>
  )
}
