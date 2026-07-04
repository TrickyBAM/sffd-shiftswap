'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { zodResolver } from '@hookform/resolvers/zod'
import { createClient } from '@/lib/supabase/client'

const resetSchema = z
  .object({
    password: z.string().min(6, 'Password must be at least 6 characters'),
    confirm: z.string(),
  })
  .refine((data) => data.password === data.confirm, {
    message: 'Passwords do not match',
    path: ['confirm'],
  })

type ResetForm = z.infer<typeof resetSchema>

export default function ResetPasswordPage() {
  const router = useRouter()
  const [serverError, setServerError] = useState<string | null>(null)
  const [hasSession, setHasSession] = useState<boolean | null>(null)

  useEffect(() => {
    const supabase = createClient()
    supabase.auth.getUser().then(({ data }) => {
      setHasSession(!!data.user)
    })
  }, [])

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ResetForm>({
    resolver: zodResolver(resetSchema),
  })

  async function onSubmit(data: ResetForm) {
    setServerError(null)
    const supabase = createClient()

    const { error } = await supabase.auth.updateUser({ password: data.password })

    if (error) {
      setServerError(error.message)
      return
    }

    router.push('/dashboard')
    router.refresh()
  }

  return (
    <div className="animate-fade-in-up">
      <div className="text-center mb-10">
        <h1 className="font-display text-5xl tracking-wide">
          SHIFT<span className="text-[#D32F2F]">SWAP</span>
        </h1>
        <p className="text-[#8888A0] text-sm mt-2">Choose a new password</p>
      </div>

      <div className="bg-[#12121a] rounded-2xl border border-white/[0.06] p-8">
        {hasSession === false ? (
          <div className="text-center">
            <p className="text-[#F0F0F5] font-semibold mb-2">Link expired</p>
            <p className="text-sm text-[#8888A0] mb-6">
              This reset link is no longer valid. Request a fresh one and try
              again.
            </p>
            <Link
              href="/forgot-password"
              className="text-[#D32F2F] hover:text-[#FF3D3D] text-sm font-medium transition"
            >
              Send a new link
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
              <label htmlFor="password" className="block text-sm font-medium text-[#8888A0] mb-1.5">
                New Password
              </label>
              <input
                id="password"
                type="password"
                autoComplete="new-password"
                {...register('password')}
                className="w-full px-4 py-3 bg-[#12121a] border border-white/[0.06] rounded-xl text-[#F0F0F5] placeholder-[#555570] focus:outline-none focus:ring-2 focus:ring-[#D32F2F]/50 focus:border-transparent transition"
                placeholder="At least 6 characters"
              />
              {errors.password && (
                <p className="mt-1 text-sm text-red-400">{errors.password.message}</p>
              )}
            </div>

            <div>
              <label htmlFor="confirm" className="block text-sm font-medium text-[#8888A0] mb-1.5">
                Confirm New Password
              </label>
              <input
                id="confirm"
                type="password"
                autoComplete="new-password"
                {...register('confirm')}
                className="w-full px-4 py-3 bg-[#12121a] border border-white/[0.06] rounded-xl text-[#F0F0F5] placeholder-[#555570] focus:outline-none focus:ring-2 focus:ring-[#D32F2F]/50 focus:border-transparent transition"
                placeholder="Type it again"
              />
              {errors.confirm && (
                <p className="mt-1 text-sm text-red-400">{errors.confirm.message}</p>
              )}
            </div>

            <button
              type="submit"
              disabled={isSubmitting || hasSession === null}
              className="w-full py-3 px-4 bg-[#D32F2F] hover:bg-[#B71C1C] disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold rounded-xl transition"
            >
              {isSubmitting ? 'Saving...' : 'Set New Password'}
            </button>
          </form>
        )}
      </div>
    </div>
  )
}
