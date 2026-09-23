'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Controller, useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import type { z } from 'zod'
import { IdCard, UserRoundCheck } from 'lucide-react'
import { FormAlert } from '@/app/(auth)/_components/FormAlert'
import { EMPLOYEE_ID_MAX, NAME_MAX, onboardingSchema } from '@/app/(auth)/_lib/validation'
import { StationPicker, TourPicker } from '@/components/pickers'
import { Button } from '@/components/ui/Button'
import { buttonClasses } from '@/components/ui/button-styles'
import { Card } from '@/components/ui/Card'
import { Field } from '@/components/ui/Field'
import { Input, Select } from '@/components/ui/Input'
import { useToast } from '@/components/ui/Toast'
import { completeOnboarding } from '@/lib/api'
import { toAppError } from '@/lib/errors'
import { RANKS, isRank } from '@/lib/sffd/ranks'
import { createClient } from '@/lib/supabase/client'

export interface OnboardingDefaults {
  fullName: string
  phone: string
  rank: string
  station: number | null
  /** undefined = not chosen yet; null = "No tour". */
  tour: number | null | undefined
  employeeId: string
}

type OnboardingValues = z.output<typeof onboardingSchema>

const STATION_ID = 'onboarding-station'
const TOUR_ID = 'onboarding-tour'

export interface OnboardingFormProps {
  defaults: OnboardingDefaults
  /** True while pending: the member is changing details they already sent. */
  editing: boolean
  /** The login email, shown for reference. */
  email: string
}

export function OnboardingForm({ defaults, editing, email }: OnboardingFormProps) {
  const router = useRouter()
  const toast = useToast()
  const [formError, setFormError] = useState<string | null>(null)
  const [leaving, setLeaving] = useState(false)

  const {
    register,
    control,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm({
    resolver: zodResolver(onboardingSchema),
    defaultValues: defaults,
  })

  const onSubmit = handleSubmit(onValid, (invalid) => {
    // react-hook-form focuses the first invalid text box or select itself; the
    // station and tour pickers are controlled, so focus those by id.
    if (invalid.fullName || invalid.phone || invalid.rank) return
    const id = invalid.station ? STATION_ID : invalid.tour ? TOUR_ID : null
    if (id) document.getElementById(id)?.focus()
  })

  async function onValid(values: OnboardingValues) {
    setFormError(null)
    // The schema has already checked these; this narrows the types.
    if (!isRank(values.rank) || values.station === null || values.tour === undefined) return

    try {
      const result = await completeOnboarding(createClient(), {
        fullName: values.fullName,
        phone: values.phone,
        rank: values.rank,
        station: values.station,
        tour: values.tour,
        employeeId: values.employeeId,
      })
      setLeaving(true)
      if (result.status === 'approved') {
        toast.success("You're approved!", result.message)
        router.replace('/welcome')
      } else {
        toast.info(editing ? 'Details saved' : 'Profile saved', 'An admin will review your account.')
        router.replace('/pending')
      }
    } catch (err) {
      const message = toAppError(err).message
      setFormError(message)
      toast.error("Couldn't save your profile", message)
    }
  }

  const busy = isSubmitting || leaving

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-5">
      <Card className="animate-fade-in-up">
        <div className="flex items-start gap-3">
          <UserRoundCheck size={22} aria-hidden="true" className="mt-0.5 shrink-0 text-accent-blue" />
          <div className="min-w-0 text-sm text-fg-muted">
            <p className="text-fg">
              {editing
                ? "You're waiting for approval. If something here was wrong, fix it and save — we'll try matching you to the roster again."
                : "We'll check these details against the department roster. If they match, you're in right away. If not, an admin will approve you."}
            </p>
            {email ? (
              <p className="mt-2">
                Signed in as <span className="break-all text-fg">{email}</span>
              </p>
            ) : null}
          </div>
        </div>
      </Card>

      {formError ? <FormAlert>{formError}</FormAlert> : null}

      <Card className="space-y-5">
        <Field
          label="Full name"
          required
          error={errors.fullName?.message}
          hint="First and last name, as on the department roster."
        >
          <Input autoComplete="name" autoCapitalize="words" maxLength={NAME_MAX} {...register('fullName')} />
        </Field>

        <Field
          label="Mobile phone"
          required
          error={errors.phone?.message}
          hint="Admins and your trade partners use this to reach you."
        >
          <Input type="tel" inputMode="tel" autoComplete="tel" maxLength={20} {...register('phone')} />
        </Field>

        <Field label="Rank" required error={errors.rank?.message} hint="Trades are same rank only.">
          <Select {...register('rank')}>
            <option value="" disabled>
              Choose your rank
            </option>
            {RANKS.map((rank) => (
              <option key={rank} value={rank}>
                {rank}
              </option>
            ))}
          </Select>
        </Field>
      </Card>

      <Card className="space-y-5">
        <Controller
          control={control}
          name="station"
          render={({ field, fieldState }) => (
            <StationPicker
              id={STATION_ID}
              label="Your station"
              value={field.value}
              onChange={field.onChange}
              disabled={busy}
              error={fieldState.error?.message}
            />
          )}
        />
      </Card>

      <Card className="space-y-5">
        <Controller
          control={control}
          name="tour"
          render={({ field, fieldState }) => (
            <TourPicker
              id={TOUR_ID}
              label="Your tour"
              value={field.value}
              onChange={field.onChange}
              allowNone
              showPreview
              disabled={busy}
              error={fieldState.error?.message}
              hint="Check the red days match your real schedule."
            />
          )}
        />
      </Card>

      <Card className="space-y-3">
        <div className="flex items-start gap-3 text-sm text-fg-muted">
          <IdCard size={20} aria-hidden="true" className="mt-0.5 shrink-0 text-accent-green" />
          <p>Adding your SFFD employee ID helps us match you to the roster automatically.</p>
        </div>
        <Field
          label={
            <>
              Employee ID <span className="font-normal text-fg-dim">(optional)</span>
            </>
          }
          error={errors.employeeId?.message}
          hint="Only you and ShiftSwap admins can see it."
        >
          <Input
            autoComplete="off"
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
            maxLength={EMPLOYEE_ID_MAX}
            {...register('employeeId')}
          />
        </Field>
      </Card>

      <div className="space-y-3">
        <Button type="submit" size="lg" fullWidth loading={busy}>
          {editing ? 'Save changes' : 'Save and continue'}
        </Button>
        {editing ? (
          <Link href="/pending" className={buttonClasses({ variant: 'ghost', fullWidth: true })}>
            Cancel
          </Link>
        ) : null}
      </div>
    </form>
  )
}
