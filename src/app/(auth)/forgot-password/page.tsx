'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { zodResolver } from '@hookform/resolvers/zod'
import { createClient } from '@/lib/supabase/client'

const forgotSchema = z.object({
  email: z.string().email('Please enter a valid email address'),
})

type ForgotForm = z.infer<typeof forgotSchema>

export default function ForgotPasswordPage() {
  const [sent, setSent] = useState(false)
  const [serverError, setServerError] = useState<string | null>(null)

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ForgotForm>({
    resolver: zodResolver(forgotSchema),
  })

  async function onSubmit(data: ForgotForm) {
    setServerError(null)
    const supabase = createClient()

    const { error } = await supabase.auth.resetPasswordForEmail(data.email, {
      redirectTo: `${window.location.origin}/auth/callback?next=/reset-password`,
    })

    if (error) {
      if (/fetch|network|load failed/i.test(error.message)) {
        setServerError('Cannot reach the ShiftSwap server right now. Check your signal and try again in a minute.')
      } else {
        setServerError(error.message)
      }
      return
    }

    setSent(true)
  }

  return (
    <div className="animate-fade-in-up">
      <div className="text-center mb-10">
        <h1 className="font-display text-5xl tracking-wide">
          SHIFT<span className="text-[#D32F2F]">SWAP</span>
        </h1>
        <p className="text-[#8888A0] text-sm mt-2">Reset your password</p>
      </div>

      <div className="bg-[#12121a] rounded-2xl border border-white/[0.06] p-8">
        {sent ? (
          <div className="text-center">
            <p className="text-[#F0F0F5] font-semibold mb-2">Check your inbox</p>
            <p className="text-sm text-[#8888A0] mb-6">
              If an account exists for that email, a reset link is on its way.
              Open it on this device and you can set a new password.
            </p>
            <Link
              href="/login"
              className="text-[#D32F2F] hover:text-[#FF3D3D] text-sm font-medium transition"
            >
              Back to sign in
            </Link>
          </div>
        ) : (
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
            {serverError && (
              <div className="bg-red-500/10 border border-red-500/20 text-red-400 px-4 py-3 rounded-xl text-sm">
                {serverError}
              </div>
            )}

            <div>
              <label htmlFor="email" className="block text-sm font-medium text-[#8888A0] mb-1.5">
                Email
              </label>
              <input
                id="email"
                type="email"
                autoComplete="email"
                {...register('email')}
                className="w-full px-4 py-3 bg-[#12121a] border border-white/[0.06] rounded-xl text-[#F0F0F5] placeholder-[#555570] focus:outline-none focus:ring-2 focus:ring-[#D32F2F]/50 focus:border-transparent transition"
                placeholder="you@sfgov.org"
              />
              {errors.email && (
                <p className="mt-1 text-sm text-red-400">{errors.email.message}</p>
              )}
            </div>

            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full py-3 px-4 bg-[#D32F2F] hover:bg-[#B71C1C] disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold rounded-xl transition"
            >
              {isSubmitting ? 'Sending...' : 'Send Reset Link'}
            </button>

            <p className="text-center text-sm text-[#8888A0]">
              Remembered it?{' '}
              <Link href="/login" className="text-[#D32F2F] hover:text-[#FF3D3D] font-medium transition">
                Sign in
              </Link>
            </p>
          </form>
        )}
      </div>
    </div>
  )
}
