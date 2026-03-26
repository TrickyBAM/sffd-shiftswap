'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { zodResolver } from '@hookform/resolvers/zod'
import { createClient } from '@/lib/supabase/client'

const signupSchema = z
  .object({
    full_name: z.string().min(2, 'Name must be at least 2 characters'),
    email: z.string().email('Please enter a valid email address'),
    password: z.string().min(6, 'Password must be at least 6 characters'),
    confirm_password: z.string(),
  })
  .refine((data) => data.password === data.confirm_password, {
    message: 'Passwords do not match',
    path: ['confirm_password'],
  })

type SignupForm = z.infer<typeof signupSchema>

export default function SignupPage() {
  const router = useRouter()
  const [serverError, setServerError] = useState<string | null>(null)

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<SignupForm>({
    resolver: zodResolver(signupSchema),
  })

  async function onSubmit(data: SignupForm) {
    setServerError(null)
    const supabase = createClient()

    const { error } = await supabase.auth.signUp({
      email: data.email,
      password: data.password,
      options: {
        data: {
          full_name: data.full_name,
        },
      },
    })

    if (error) {
      setServerError(error.message)
      return
    }

    router.push('/verify-email')
  }

  const inputClasses = "w-full px-4 py-3 bg-[#12121a] border border-white/[0.06] rounded-xl text-[#F0F0F5] placeholder-[#555570] focus:outline-none focus:ring-2 focus:ring-[#D32F2F]/50 focus:border-transparent transition"

  return (
    <div className="animate-fade-in-up">
      {/* Brand */}
      <div className="text-center mb-10">
        <h1 className="font-display text-5xl tracking-wide">
          SHIFT<span className="text-[#D32F2F]">SWAP</span>
        </h1>
        <p className="text-[#8888A0] text-sm mt-2">
          Create your account
        </p>
      </div>

      <div className="bg-[#12121a] rounded-2xl border border-white/[0.06] p-8">
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
          {serverError && (
            <div className="bg-red-500/10 border border-red-500/20 text-red-400 px-4 py-3 rounded-xl text-sm">
              {serverError}
            </div>
          )}

          <div>
            <label htmlFor="full_name" className="block text-sm font-medium text-[#8888A0] mb-1.5">
              Full Name
            </label>
            <input id="full_name" type="text" autoComplete="name" {...register('full_name')} className={inputClasses} placeholder="John Smith" />
            {errors.full_name && <p className="mt-1 text-sm text-red-400">{errors.full_name.message}</p>}
          </div>

          <div>
            <label htmlFor="email" className="block text-sm font-medium text-[#8888A0] mb-1.5">
              Email
            </label>
            <input id="email" type="email" autoComplete="email" {...register('email')} className={inputClasses} placeholder="you@sfgov.org" />
            {errors.email && <p className="mt-1 text-sm text-red-400">{errors.email.message}</p>}
          </div>

          <div>
            <label htmlFor="password" className="block text-sm font-medium text-[#8888A0] mb-1.5">
              Password
            </label>
            <input id="password" type="password" autoComplete="new-password" {...register('password')} className={inputClasses} placeholder="At least 6 characters" />
            {errors.password && <p className="mt-1 text-sm text-red-400">{errors.password.message}</p>}
          </div>

          <div>
            <label htmlFor="confirm_password" className="block text-sm font-medium text-[#8888A0] mb-1.5">
              Confirm Password
            </label>
            <input id="confirm_password" type="password" autoComplete="new-password" {...register('confirm_password')} className={inputClasses} placeholder="Confirm your password" />
            {errors.confirm_password && <p className="mt-1 text-sm text-red-400">{errors.confirm_password.message}</p>}
          </div>

          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full py-3 px-4 bg-[#D32F2F] hover:bg-[#B71C1C] disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold rounded-xl transition"
          >
            {isSubmitting ? (
              <span className="inline-flex items-center gap-2">
                <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                Creating account...
              </span>
            ) : (
              'Create Account'
            )}
          </button>
        </form>

        <p className="mt-6 text-center text-sm text-[#8888A0]">
          Already have an account?{' '}
          <Link href="/login" className="text-[#D32F2F] hover:text-[#FF3D3D] font-medium transition">
            Sign in
          </Link>
        </p>
      </div>
    </div>
  )
}
