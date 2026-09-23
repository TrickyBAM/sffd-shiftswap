'use client'

import { useId, useState } from 'react'
import { Controller, useForm, useWatch } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { FormAlert } from '@/components/forms/FormAlert'
import { Button, Field, Input, Sheet, useToast } from '@/components/ui'
import { StationPicker, TourPicker } from '@/components/pickers'
import { useProfile } from '@/components/providers/ProfileProvider'
import { updateMyProfile } from '@/lib/api'
import { errorMessage } from '@/lib/errors'
import { createClient } from '@/lib/supabase/client'
import { isNotifyScope } from '@/lib/types/database'
import { detailsSchema } from './profile-model'
import { ScopeRadios } from './ScopeRadios'

/**
 * Edit phone, station, tour and new-shift alert scope (update_my_profile).
 * Name, rank and employee ID are shown read-only: only admins change them.
 * Mount it when opening, so every open starts from the saved profile.
 */
export function EditDetailsSheet({ onClose }: { onClose: () => void }) {
  const { profile, refresh } = useProfile()
  const toast = useToast()
  const formId = useId()
  const [formError, setFormError] = useState<string | null>(null)
  // Bumped on every failed save, so the same message is announced again.
  const [attempt, setAttempt] = useState(0)

  const {
    control,
    register,
    handleSubmit,
    formState: { errors, isSubmitting, isDirty },
  } = useForm({
    resolver: zodResolver(detailsSchema),
    defaultValues: {
      phone: profile.phone ?? '',
      station: profile.station,
      tour: profile.tour,
      notifyScope: isNotifyScope(profile.notify_scope) ? profile.notify_scope : 'battalion',
    },
  })
  const station = useWatch({ control, name: 'station' })

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null)
    if (values.station === null) return // the schema already requires it
    try {
      await updateMyProfile(createClient(), {
        phone: values.phone,
        station: values.station,
        tour: values.tour,
        notifyScope: values.notifyScope,
      })
    } catch (error) {
      // Shown next to Save (the sticky footer), not at the top of this long
      // sheet where it would be scrolled out of view (UX-06).
      setFormError(errorMessage(error))
      setAttempt((n) => n + 1)
      return
    }
    try {
      await refresh()
      toast.success('Your details are saved')
    } catch {
      toast.show({
        tone: 'success',
        title: 'Your details are saved',
        description: "Reload the page if you don't see the changes yet.",
      })
    }
    onClose()
  })

  return (
    <Sheet
      open
      onClose={isSubmitting ? () => {} : onClose}
      title="Edit my details"
      description="Trade partners see your phone number so they can reach you."
      closeOnOverlay={!isDirty && !isSubmitting}
      closeOnEscape={!isSubmitting}
      footer={
        <div className="space-y-3">
          {formError ? <FormAlert key={attempt}>{formError}</FormAlert> : null}
          <div className="flex gap-2">
            <Button variant="secondary" onClick={onClose} disabled={isSubmitting}>
              Cancel
            </Button>
            <Button type="submit" form={formId} fullWidth loading={isSubmitting} disabled={!isDirty}>
              Save changes
            </Button>
          </div>
        </div>
      }
    >
      <form id={formId} onSubmit={onSubmit} noValidate className="space-y-5 pt-2">
        <ReadOnlyDetails
          rows={[
            { label: 'Name', value: profile.full_name || '—' },
            { label: 'Rank', value: profile.rank ?? '—' },
            { label: 'Employee ID', value: profile.employee_id || 'Not set' },
          ]}
        />

        <Field label="Mobile phone" error={errors.phone?.message} required>
          <Input type="tel" inputMode="tel" autoComplete="tel" disabled={isSubmitting} {...register('phone')} />
        </Field>

        <Controller
          control={control}
          name="station"
          render={({ field, fieldState }) => (
            <StationPicker
              label="Your station"
              value={field.value}
              onChange={field.onChange}
              disabled={isSubmitting}
              error={fieldState.error?.message}
            />
          )}
        />

        <Controller
          control={control}
          name="tour"
          render={({ field, fieldState }) => (
            <TourPicker
              value={field.value}
              onChange={field.onChange}
              allowNone
              showPreview
              disabled={isSubmitting}
              error={fieldState.error?.message}
              hint="Your tour sets which days show as your work days. Trades you've already made stay as they are."
            />
          )}
        />

        <Controller
          control={control}
          name="notifyScope"
          render={({ field, fieldState }) => (
            <ScopeRadios
              value={field.value}
              onChange={field.onChange}
              station={station ?? null}
              disabled={isSubmitting}
              error={fieldState.error?.message}
            />
          )}
        />
      </form>
    </Sheet>
  )
}

function ReadOnlyDetails({ rows }: { rows: { label: string; value: string }[] }) {
  return (
    <div className="rounded-xl border border-line bg-elevated/60 p-3">
      <dl className="space-y-1.5 text-sm">
        {rows.map((row) => (
          <div key={row.label} className="flex items-baseline justify-between gap-3">
            <dt className="text-fg-dim">{row.label}</dt>
            <dd className="min-w-0 truncate text-right font-semibold text-fg">{row.value}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-2 border-t border-line pt-2 text-sm text-fg-muted">
        Need to change your name, rank or employee ID? Ask an admin to change it.
      </p>
    </div>
  )
}
