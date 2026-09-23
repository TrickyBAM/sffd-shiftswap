'use client'

import { useState, type FormEvent } from 'react'
import { Button, Field, Input, Select, useToast } from '@/components/ui'
import { FormAlert } from '@/components/forms/FormAlert'
import { StationPicker, TourPicker } from '@/components/pickers'
import { updateMember } from '@/lib/api'
import { toAppError } from '@/lib/errors'
import { RANKS, type Rank } from '@/lib/sffd/ranks'
import { createClient } from '@/lib/supabase/client'
import type { Profile } from '@/lib/types/database'
import {
  editValuesFrom,
  isDirty,
  toUpdateInput,
  validateMemberEdit,
  type MemberEditErrors,
  type MemberEditValues,
} from '../_lib/edit'

export interface MemberEditFormProps {
  member: Profile
  onSaved: () => void
  onCancel: () => void
}

/** Admin edit of name, rank, station, tour, phone and employee ID (admin_update_member). */
export function MemberEditForm({ member, onSaved, onCancel }: MemberEditFormProps) {
  const toast = useToast()
  const [values, setValues] = useState<MemberEditValues>(() => editValuesFrom(member))
  const [errors, setErrors] = useState<MemberEditErrors>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const idBase = `member-${member.id}`

  function set<K extends keyof MemberEditValues>(key: K, value: MemberEditValues[K]) {
    setValues((prev) => ({ ...prev, [key]: value }))
    if (errors[key]) setErrors((prev) => ({ ...prev, [key]: undefined }))
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (busy) return
    const found = validateMemberEdit(values)
    setErrors(found)
    setFormError(null)
    if (Object.values(found).some(Boolean)) return
    setBusy(true)
    try {
      await updateMember(createClient(), member.id, toUpdateInput(values))
      toast.success('Changes saved')
      onSaved()
    } catch (err) {
      const message = toAppError(err).message
      setFormError(message)
      toast.error("Couldn't save the changes", message)
    } finally {
      setBusy(false)
    }
  }

  const dirty = isDirty(values, member)

  return (
    <form onSubmit={submit} noValidate className="space-y-4" aria-label="Edit member details">
      <Field label="Full name" required error={errors.fullName} id={`${idBase}-name`}>
        <Input
          value={values.fullName}
          onChange={(event) => set('fullName', event.target.value)}
          autoComplete="off"
          autoCapitalize="words"
          maxLength={80}
          disabled={busy}
        />
      </Field>

      <Field label="Rank" required error={errors.rank} id={`${idBase}-rank`}>
        <Select
          value={values.rank}
          onChange={(event) => set('rank', event.target.value as Rank | '')}
          disabled={busy}
        >
          {values.rank === '' ? (
            <option value="" disabled>
              Choose a rank
            </option>
          ) : null}
          {RANKS.map((rank) => (
            <option key={rank} value={rank}>
              {rank}
            </option>
          ))}
        </Select>
      </Field>

      <StationPicker
        id={`${idBase}-station`}
        value={values.station}
        onChange={(station) => set('station', station)}
        disabled={busy}
        error={errors.station}
      />

      <TourPicker
        id={`${idBase}-tour`}
        value={values.tour}
        onChange={(tour) => set('tour', tour)}
        allowNone
        disabled={busy}
        error={errors.tour}
      />

      <Field label="Phone" required hint="Include the area code." error={errors.phone} id={`${idBase}-phone`}>
        <Input
          type="tel"
          inputMode="tel"
          value={values.phone}
          onChange={(event) => set('phone', event.target.value)}
          autoComplete="off"
          maxLength={20}
          disabled={busy}
        />
      </Field>

      <Field
        label="Employee ID"
        hint="Optional. Helps match them to the roster."
        error={errors.employeeId}
        id={`${idBase}-employee-id`}
      >
        <Input
          value={values.employeeId}
          onChange={(event) => set('employeeId', event.target.value)}
          autoComplete="off"
          maxLength={40}
          disabled={busy}
        />
      </Field>

      {formError ? <FormAlert>{formError}</FormAlert> : null}

      <div className="flex gap-2">
        <Button variant="secondary" onClick={onCancel} disabled={busy} className="flex-1">
          Cancel
        </Button>
        <Button type="submit" loading={busy} disabled={!dirty} className="flex-1">
          Save changes
        </Button>
      </div>
    </form>
  )
}
