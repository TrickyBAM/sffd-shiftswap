'use client'

import { useId, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { FormAlert } from '@/components/forms/FormAlert'
import { PasswordInput } from '@/components/forms/PasswordInput'
import { Button, Field, Sheet, useToast } from '@/components/ui'
import { useProfile } from '@/components/providers/ProfileProvider'
import { toAppError } from '@/lib/errors'
import { createClient } from '@/lib/supabase/client'
import { PASSWORD_MAX, PASSWORD_MIN } from '@/lib/validation'
import {
  CURRENT_PASSWORD_WRONG_MESSAGE,
  isWrongCurrentPassword,
  needsFreshSignIn,
  profilePasswordSchema,
} from './profile-model'

const REAUTH_MESSAGE = 'For your security, sign out and sign back in, then change your password right away.'
const NO_EMAIL_MESSAGE = "We couldn't check your current password. Sign out, sign back in, then try again."

/**
 * Change my password while signed in. Asks for the current password first and
 * checks it by signing in with it (SEC-1), so someone picking up a phone that
 * was left signed in can't lock the member out. Then auth.updateUser.
 * Mount it when opening, so the fields always start empty.
 *
 * The forced change after an admin reset (/change-password) doesn't ask for
 * the current password: the member has just signed in with the temporary one.
 */
export function ChangePasswordSheet({ onClose }: { onClose: () => void }) {
  const { profile } = useProfile()
  const toast = useToast()
  const formId = useId()
  const [formError, setFormError] = useState<string | null>(null)
  // Bumped on every failed save, so the same message is announced again.
  const [attempt, setAttempt] = useState(0)

  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting, isDirty },
  } = useForm({
    resolver: zodResolver(profilePasswordSchema),
    defaultValues: { currentPassword: '', password: '', confirmPassword: '' },
  })

  function fail(message: string) {
    setFormError(message)
    setAttempt((n) => n + 1)
  }

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null)
    let sb: ReturnType<typeof createClient>
    try {
      sb = createClient()
    } catch (error) {
      fail(toAppError(error).message)
      return
    }

    // 1. Check the current password: sign in again with this account's email.
    let email = profile.email
    try {
      const { data } = await sb.auth.getSession()
      email = data.session?.user.email || email
    } catch {
      // Use the profile's email.
    }
    if (!email) {
      fail(NO_EMAIL_MESSAGE)
      return
    }
    try {
      const { error } = await sb.auth.signInWithPassword({ email, password: values.currentPassword })
      if (error) {
        if (isWrongCurrentPassword(error)) {
          setError('currentPassword', { type: 'manual', message: CURRENT_PASSWORD_WRONG_MESSAGE }, { shouldFocus: true })
          return
        }
        fail(toAppError(error).message)
        return
      }
    } catch (error) {
      fail(toAppError(error).message)
      return
    }

    // 2. Save the new one. current_password also lets Supabase Auth check it
    // itself when the project requires that.
    let failure: unknown = null
    try {
      const { error } = await sb.auth.updateUser({
        password: values.password,
        current_password: values.currentPassword,
      })
      failure = error
    } catch (error) {
      failure = error
    }
    if (failure) {
      fail(needsFreshSignIn(failure) ? REAUTH_MESSAGE : toAppError(failure).message)
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
      description={`Enter your current password, then choose a new one of at least ${PASSWORD_MIN} characters. You'll stay signed in on this device.`}
      closeOnOverlay={!isDirty && !isSubmitting}
      closeOnEscape={!isSubmitting}
      footer={
        <div className="space-y-3">
          {/* Next to the button, so a failed save is always in view (UX-06). */}
          {formError ? <FormAlert key={attempt}>{formError}</FormAlert> : null}
          <div className="flex gap-2">
            <Button variant="secondary" onClick={onClose} disabled={isSubmitting}>
              Cancel
            </Button>
            <Button type="submit" form={formId} fullWidth loading={isSubmitting}>
              Change password
            </Button>
          </div>
        </div>
      }
    >
      {/* Fields are read-only (not disabled) while saving, so a wrong current
          password can move focus straight back to its field. */}
      <form id={formId} onSubmit={onSubmit} noValidate className="space-y-5 pt-2">
        {/* Lets password managers file the new password under the right account. */}
        <input type="email" name="username" autoComplete="username" value={profile.email} readOnly hidden />

        <Field label="Current password" error={errors.currentPassword?.message} required>
          <PasswordInput autoComplete="current-password" readOnly={isSubmitting} {...register('currentPassword')} />
        </Field>
        <Field label="New password" error={errors.password?.message} required>
          <PasswordInput
            autoComplete="new-password"
            maxLength={PASSWORD_MAX}
            readOnly={isSubmitting}
            {...register('password')}
          />
        </Field>
        <Field label="Type the new password again" error={errors.confirmPassword?.message} required>
          <PasswordInput
            autoComplete="new-password"
            maxLength={PASSWORD_MAX}
            readOnly={isSubmitting}
            {...register('confirmPassword')}
          />
        </Field>
      </form>
    </Sheet>
  )
}
