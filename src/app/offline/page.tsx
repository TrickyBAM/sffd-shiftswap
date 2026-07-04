import type { Metadata } from 'next'
import { Flame } from 'lucide-react'
import Link from 'next/link'

export const metadata: Metadata = {
  title: 'Offline | SFFD ShiftSwap',
}

export default function OfflinePage() {
  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="text-center max-w-sm animate-fade-in-up">
        <div className="w-16 h-16 rounded-2xl bg-[#12121a] border border-white/[0.06] flex items-center justify-center mx-auto mb-6">
          <Flame size={32} className="text-[#555570]" />
        </div>
        <h1 className="font-display text-4xl tracking-wide mb-3">
          NO<span className="text-[#D32F2F]">SIGNAL</span>
        </h1>
        <p className="text-[#8888A0] text-sm mb-8">
          ShiftSwap needs a connection to load fresh shift data. Check your
          signal and try again.
        </p>
        <Link
          href="/dashboard"
          className="inline-block px-6 py-3 bg-[#D32F2F] hover:bg-[#B71C1C] text-white font-semibold rounded-xl transition"
        >
          Try Again
        </Link>
      </div>
    </div>
  )
}
