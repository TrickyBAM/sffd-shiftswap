'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { KeyRound } from 'lucide-react'
import { FormAlert } from '@/components/forms/FormAlert'
import { PasswordInput } from '@/components/forms/PasswordInput'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Field } from '@/components/ui/Field'
import { useToast } from '@/components/ui/Toast'
import { clearMustChangePassword } from '@/lib/api'
import { toAppError } from '@/lib/errors'
import { createClient } from '@/lib/supabase/client'
import { changePasswordSchema, PASSWORD_MAX, PASSWORD_MIN } from '@/lib/validation'
import { SignOutButton } from '../../_components/SignOutButton'

export interface ChangePasswordFormProps {
  /** Where to go once the new password is saved. */
  next: string
  /** The login email, so password managers save the new password for the right account. */
  email: string
}

/**
 * Supabase refuses a password change on a session older than a day when
 * "secure password change" is on ('reauthentication_needed'): the member has
 * to log in again first. They still know the temporary password.
 */
const REAUTH_MESSAGE =
  'For your security, sign out and log back in with your temporary password, then choose your new password right away.'

interface Problem {
  message: string
  /** Offer "Sign out" in the message (the fix is to log in again). */
  signOut?: boolean
}

function authCode(error: unknown): string | null {
  if (typeof error !== 'object' || error === null) return null
  const code = (error as { code?: unknown }).code
  return typeof code === 'string' ? code : null
}

/** What went wrong, in words that fit this screen. */
function problemFrom(error: unknown): Problem {
  switch (authCode(error)) {
    case 'reauthentication_needed':
      return { message: REAUTH_MESSAGE, signOut: true }
    case 'same_password':
      return { message: "That's the temporary password. Choose a new one." }
    default:
      return { message: toAppError(error).message }
  }
}

export function ChangePasswordForm({ next, email }: ChangePasswordFormProps) {
  const router = useRouter()
  const toast = useToast()
  const [formError, setFormError] = useState<Problem | null>(null)
  // The password can be saved while clearing the reset flag fails; a retry
  // then only needs the second step.
  const passwordSaved = useRef(false)
  const [stuck, setStuck] = useState(false)
  const [leaving, setLeaving] = useState(false)
  const [retrying, setRetrying] = useState(false)

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm({
    resolver: zodResolver(changePasswordSchema),
    defaultValues: { password: '', confirmPassword: '' },
  })

  async function finish() {
    await clearMustChangePassword(createClient())
    setLeaving(true)
    toast.success('Password changed', 'Use your new password next time you log in.')
    router.replace(next)
  }

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null)
    try {
      if (!passwordSaved.current) {
        const { error } = await createClient().auth.updateUser({ password: values.password })
        if (error) throw error
        passwordSaved.current = true
      }
      await finish()
    } catch (err) {
      setFormError(problemFrom(err))
      if (passwordSaved.current) setStuck(true)
    }
  })

  async function retryFinish() {
    if (retrying) return
    setFormError(null)
    setRetrying(true)
    try {
      await finish()
    } catch (err) {
      setFormError(problemFrom(err))
    } finally {
      setRetrying(false)
    }
  }

  const busy = isSubmitting || leaving

  if (stuck) {
    return (
      <Card className="space-y-4">
        <p className="text-sm text-fg">
          Your new password is saved, but we couldn&apos;t finish setting up your account. Check your connection and
          try again.
        </p>
        {formError ? <FormAlert>{formError.message}</FormAlert> : null}
        <Button size="lg" fullWidth loading={retrying || leaving} onClick={retryFinish}>
          {leaving ? 'Opening ShiftSwap…' : 'Try again'}
        </Button>
      </Card>
    )
  }

  return (
    <div className="space-y-4">
      <Card className="animate-fade-in-up">
        <div className="flex items-start gap-3">
          <KeyRound size={22} aria-hidden="true" className="mt-0.5 shrink-0 text-accent-yellow" />
          <p className="text-sm text-fg">
            An admin reset your password. Choose a new one to continue.
          </p>
        </div>
      </Card>

      <Card>
        <form onSubmit={onSubmit} noValidate className="space-y-5">
          {/* Lets password managers file the new password under the right account. */}
          <input
            type="email"
            name="username"
            autoComplete="username"
            value={email}
            readOnly
            hidden
          />

          {formError ? (
            <FormAlert action={formError.signOut ? <SignOutButton variant="secondary" size="sm" /> : undefined}>
              {formError.message}
            </FormAlert>
          ) : null}

          <Field
            label="New password"
            required
            error={errors.password?.message}
            hint={`At least ${PASSWORD_MIN} characters. Don't reuse the temporary one.`}
          >
            <PasswordInput autoComplete="new-password" maxLength={PASSWORD_MAX} {...register('password')} />
          </Field>

          <Field label="Confirm new password" required error={errors.confirmPassword?.message}>
            <PasswordInput autoComplete="new-password" maxLength={PASSWORD_MAX} {...register('confirmPassword')} />
          </Field>

          <Button type="submit" size="lg" fullWidth loading={busy}>
            {leaving ? 'Opening ShiftSwap…' : 'Save new password'}
          </Button>
        </form>
      </Card>

      <div className="flex justify-center">
        <SignOutButton size="sm" />
      </div>
    </div>
  )
}
