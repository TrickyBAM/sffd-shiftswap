'use client'

import { useId, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Button, Field, Sheet, useToast } from '@/components/ui'
import { toAppError } from '@/lib/errors'
import { createClient } from '@/lib/supabase/client'
import { FormAlert } from './FormAlert'
import { PasswordInput } from './PasswordInput'
import { PASSWORD_MIN, passwordSchema } from './profile-model'

const REAUTH_MESSAGE =
  'For your security, sign out and sign back in, then change your password right away.'

/** The auth error code Supabase sends when a password change needs a fresh sign-in. */
function needsFreshSignIn(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 'reauthentication_needed'
}

/**
 * Change my password while signed in (auth.updateUser). Mount it when opening,
 * so the fields always start empty.
 */
export function ChangePasswordSheet({ onClose }: { onClose: () => void }) {
  const toast = useToast()
  const formId = useId()
  const [formError, setFormError] = useState<string | null>(null)

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting, isDirty },
  } = useForm({
    resolver: zodResolver(passwordSchema),
    defaultValues: { password: '', confirmPassword: '' },
  })

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null)
    let failure: unknown = null
    try {
      const { error } = await createClient().auth.updateUser({ password: values.password })
      failure = error
    } catch (error) {
      failure = error
    }
    if (failure) {
      setFormError(needsFreshSignIn(failure) ? REAUTH_MESSAGE : toAppError(failure).message)
      return
    }
    toast.success('Password changed', 'Use your new password next time you log in.')
    onClose()
  })

  return (
    <Sheet
      open
      onClose={isSubmitting ? () => {} : onClose}
      title="Change password"
      description={`Use at least ${PASSWORD_MIN} characters. You'll stay signed in on this device.`}
      closeOnOverlay={!isDirty && !isSubmitting}
      closeOnEscape={!isSubmitting}
      footer={
        <div className="flex gap-2">
          <Button variant="secondary" onClick={onClose} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button type="submit" form={formId} fullWidth loading={isSubmitting}>
            Change password
          </Button>
        </div>
      }
    >
      <form id={formId} onSubmit={onSubmit} noValidate className="space-y-5 pt-2">
        {formError ? <FormAlert>{formError}</FormAlert> : null}
        <Field label="New password" error={errors.password?.message} required>
          <PasswordInput autoComplete="new-password" disabled={isSubmitting} {...register('password')} />
        </Field>
        <Field label="Type it again" error={errors.confirmPassword?.message} required>
          <PasswordInput autoComplete="new-password" disabled={isSubmitting} {...register('confirmPassword')} />
        </Field>
      </form>
    </Sheet>
  )
}
