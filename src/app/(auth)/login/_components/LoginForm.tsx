'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Button } from '@/components/ui/Button'
import { Field } from '@/components/ui/Field'
import { Input } from '@/components/ui/Input'
import { toAppError } from '@/lib/errors'
import { createClient } from '@/lib/supabase/client'
import { FormAlert } from '../../_components/FormAlert'
import { PasswordInput } from '../../_components/PasswordInput'
import { HOME_PATH } from '../../_lib/safe-next'
import { loginSchema } from '../../_lib/validation'

export interface LoginFormProps {
  /** A safe same-site path to open after logging in (already checked by the page). */
  next: string | null
}

export function LoginForm({ next }: LoginFormProps) {
  const router = useRouter()
  const [formError, setFormError] = useState<string | null>(null)
  const [leaving, setLeaving] = useState(false)

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: '', password: '' },
  })

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null)
    let failure: unknown = null
    try {
      const { error } = await createClient().auth.signInWithPassword({
        email: values.email,
        password: values.password,
      })
      failure = error
    } catch (err) {
      failure = err
    }

    if (failure) {
      // "That email and password don't match." vs "Can't reach ShiftSwap right now…"
      setFormError(toAppError(failure).message)
      return
    }

    // Keep the button busy until the next page takes over.
    setLeaving(true)
    router.replace(next ?? HOME_PATH)
    router.refresh()
  })

  const busy = isSubmitting || leaving

  return (
    <div>
      <h1 className="font-display text-4xl leading-none tracking-wide text-fg">Log in</h1>
      <p className="mt-2 text-sm text-fg-muted">Welcome back. Use the email you signed up with.</p>

      <form onSubmit={onSubmit} noValidate className="mt-6 space-y-5">
        {formError ? <FormAlert>{formError}</FormAlert> : null}

        <Field label="Email" error={errors.email?.message}>
          <Input
            type="email"
            inputMode="email"
            autoComplete="email"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            {...register('email')}
          />
        </Field>

        <Field label="Password" error={errors.password?.message}>
          <PasswordInput autoComplete="current-password" {...register('password')} />
        </Field>

        <Button type="submit" size="lg" fullWidth loading={busy}>
          {leaving ? 'Opening ShiftSwap…' : 'Log in'}
        </Button>
      </form>

      <div className="mt-6 space-y-2 border-t border-line pt-5 text-center text-sm">
        <p className="text-fg-muted">
          Forgot your password? Ask a ShiftSwap admin to reset it.
        </p>
        <p className="text-fg-muted">
          New to ShiftSwap?{' '}
          <Link
            href="/signup"
            className="inline-flex min-h-11 items-center font-semibold text-sffd-red-text underline-offset-4 hover:underline"
          >
            Create an account
          </Link>
        </p>
      </div>
    </div>
  )
}
