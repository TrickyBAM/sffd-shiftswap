'use client'

import Link from 'next/link'

export default function VerifyEmailPage() {
  return (
    <div className="bg-[#1a1a1a] rounded-2xl shadow-xl border border-[#2a2a2a] p-8 text-center">
      {/* Email icon */}
      <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-[#D32F2F]/10 mb-6">
        <svg
          className="w-8 h-8 text-[#D32F2F]"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.5}
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75"
          />
        </svg>
      </div>

      <h1 className="text-2xl font-bold text-white mb-3">Check Your Email</h1>
      <p className="text-gray-400 mb-2">
        We&apos;ve sent a verification link to your email address.
      </p>
      <p className="text-gray-500 text-sm mb-8">
        Click the link in the email to verify your account and get started with SFFD ShiftSwap.
      </p>

      <Link
        href="/login"
        className="inline-block py-2.5 px-6 bg-[#D32F2F] hover:bg-[#B71C1C] text-white font-semibold rounded-lg transition focus:outline-none focus:ring-2 focus:ring-[#D32F2F] focus:ring-offset-2 focus:ring-offset-[#1a1a1a]"
      >
        Back to Sign In
      </Link>
    </div>
  )
}
