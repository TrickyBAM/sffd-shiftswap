'use client'

import { useState, type FormEvent } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import type { z } from 'zod'
import { ShieldCheck } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Field } from '@/components/ui/Field'
import { Input } from '@/components/ui/Input'
import { toAppError } from '@/lib/errors'
import { createClient } from '@/lib/supabase/client'
import { FormAlert } from '../../_components/FormAlert'
import { PasswordInput } from '../../_components/PasswordInput'
import { NAME_MAX, PASSWORD_MAX, PASSWORD_MIN, signupFormSchema } from '../../_lib/validation'
import { signUp } from '../actions'

export interface SignupFormProps {
  /** Signed "form shown at" token from the page (empty when the server isn't configured). */
  token: string
}

type Problem =
  | { kind: 'message'; text: string }
  | { kind: 'account-exists'; text: string }
  | { kind: 'refresh'; text: string }
  | { kind: 'created-no-session'; text: string }

type SignupValues = z.output<typeof signupFormSchema>

/** Name of the hidden honeypot input. */
const HONEYPOT = 'website'

const LINK = 'inline-flex min-h-11 items-center font-semibold text-sffd-red-text underline-offset-4 hover:underline'

export function SignupForm({ token }: SignupFormProps) {
  const router = useRouter()
  const [problem, setProblem] = useState<Problem | null>(null)
  const [leaving, setLeaving] = useState(false)

  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm({
    resolver: zodResolver(signupFormSchema),
    defaultValues: { fullName: '', email: '', phone: '', password: '', confirmPassword: '' },
  })

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    const hp = new FormData(event.currentTarget).get(HONEYPOT)
    return handleSubmit((values) => submit(values, typeof hp === 'string' ? hp : ''))(event)
  }

  async function submit(values: SignupValues, hp: string) {
    setProblem(null)

    const result = await signUp({
      fullName: values.fullName,
      email: values.email,
      phone: values.phone,
      password: values.password,
      hp,
      token,
    }).catch((err: unknown) => ({ ok: false as const, message: toAppError(err).message }))

    if (!result.ok) {
      if ('code' in result && result.code === 'account-exists') {
        setProblem({ kind: 'account-exists', text: result.message })
      } else if ('retry' in result && result.retry === 'refresh') {
        setProblem({ kind: 'refresh', text: result.message })
      } else if ('field' in result && result.field) {
        setError(result.field, { message: result.message }, { shouldFocus: true })
      } else {
        setProblem({ kind: 'message', text: result.message })
      }
      return
    }

    // The account exists and is confirmed; sign in on this device.
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
      setProblem({
        kind: 'created-no-session',
        text: toAppError(failure).isNetwork
          ? "Your account is ready, but we couldn't reach ShiftSwap to sign you in. Log in when you have a connection."
          : "Your account is ready, but we couldn't sign you in on this device. Log in to continue.",
      })
      return
    }

    setLeaving(true)
    router.replace('/onboarding')
    router.refresh()
  }

  const busy = isSubmitting || leaving

  return (
    <div>
      <h1 className="font-display text-4xl leading-none tracking-wide text-fg">Create account</h1>
      <p className="mt-2 text-sm text-fg-muted">For San Francisco Fire Department members.</p>

      <div className="mt-4 flex items-start gap-3 rounded-xl border border-accent-blue/25 bg-accent-blue/[0.08] px-4 py-3 text-sm text-fg">
        <ShieldCheck size={18} aria-hidden="true" className="mt-0.5 shrink-0 text-accent-blue" />
        <p>
          Your account is checked against the department roster. If we can&apos;t match you automatically, an
          admin will approve you.
        </p>
      </div>

      <form onSubmit={onSubmit} noValidate className="mt-6 space-y-5">
        {problem ? <ProblemAlert problem={problem} /> : null}

        <Field label="Full name" required error={errors.fullName?.message} hint="As it appears on the department roster.">
          <Input
            autoComplete="name"
            autoCapitalize="words"
            maxLength={NAME_MAX}
            {...register('fullName')}
          />
        </Field>

        <Field label="Email" required error={errors.email?.message} hint="You'll use this to log in.">
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

        <Field
          label="Mobile phone"
          required
          error={errors.phone?.message}
          hint="Only admins and your trade partners see it."
        >
          <Input type="tel" inputMode="tel" autoComplete="tel" maxLength={20} {...register('phone')} />
        </Field>

        <Field
          label="Password"
          required
          error={errors.password?.message}
          hint={`At least ${PASSWORD_MIN} characters.`}
        >
          <PasswordInput autoComplete="new-password" maxLength={PASSWORD_MAX} {...register('password')} />
        </Field>

        <Field label="Confirm password" required error={errors.confirmPassword?.message}>
          <PasswordInput
            autoComplete="new-password"
            maxLength={PASSWORD_MAX}
            {...register('confirmPassword')}
          />
        </Field>

        {/*
          Honeypot: hidden from people (and screen readers), so anything typed
          here came from a bot. Not display:none, which some bots skip.
        */}
        <div aria-hidden="true" className="absolute -left-[10000px] top-auto h-px w-px overflow-hidden">
          <label htmlFor="signup-website">Leave this field empty</label>
          <input id="signup-website" name={HONEYPOT} type="text" tabIndex={-1} autoComplete="off" defaultValue="" />
        </div>

        <Button type="submit" size="lg" fullWidth loading={busy}>
          {leaving ? 'Opening ShiftSwap…' : 'Create account'}
        </Button>
      </form>

      <p className="mt-6 border-t border-line pt-5 text-center text-sm text-fg-muted">
        Already have an account?{' '}
        <Link href="/login" className={LINK}>
          Log in
        </Link>
      </p>
    </div>
  )
}

function ProblemAlert({ problem }: { problem: Problem }) {
  switch (problem.kind) {
    case 'account-exists':
    case 'created-no-session':
      return (
        <FormAlert
          action={
            <Link href="/login" className={LINK}>
              Go to log in
            </Link>
          }
        >
          {problem.text}
        </FormAlert>
      )
    case 'refresh':
      return (
        <FormAlert
          action={
            <button type="button" onClick={() => window.location.reload()} className={LINK}>
              Refresh the page
            </button>
          }
        >
          {problem.text}
        </FormAlert>
      )
    default:
      return <FormAlert>{problem.text}</FormAlert>
  }
}
