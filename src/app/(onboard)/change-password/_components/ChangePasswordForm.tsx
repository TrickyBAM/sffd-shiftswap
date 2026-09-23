'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { KeyRound } from 'lucide-react'
import { FormAlert } from '@/app/(auth)/_components/FormAlert'
import { PasswordInput } from '@/app/(auth)/_components/PasswordInput'
import { PASSWORD_MAX, PASSWORD_MIN, changePasswordSchema } from '@/app/(auth)/_lib/validation'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Field } from '@/components/ui/Field'
import { useToast } from '@/components/ui/Toast'
import { clearMustChangePassword } from '@/lib/api'
import { toAppError } from '@/lib/errors'
import { createClient } from '@/lib/supabase/client'
import { SignOutButton } from '../../_components/SignOutButton'

export interface ChangePasswordFormProps {
  /** Where to go once the new password is saved. */
  next: string
  /** The login email, so password managers save the new password for the right account. */
  email: string
}

export function ChangePasswordForm({ next, email }: ChangePasswordFormProps) {
  const router = useRouter()
  const toast = useToast()
  const [formError, setFormError] = useState<string | null>(null)
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
      setFormError(toAppError(err).message)
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
      setFormError(toAppError(err).message)
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
        {formError ? <FormAlert>{formError}</FormAlert> : null}
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

          {formError ? <FormAlert>{formError}</FormAlert> : null}

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
