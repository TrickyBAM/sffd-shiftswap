import type { Metadata } from 'next'
import { WifiOff } from 'lucide-react'
import RetryButton from './RetryButton'

// Fully static (no Supabase, no cookies): the service worker precaches this page and
// serves it whenever a page can't be loaded from the network.

export const metadata: Metadata = {
  title: 'Offline',
}

export default function OfflinePage() {
  return (
    <main id="main" className="flex min-h-dvh items-center justify-center px-4 pt-safe pb-safe">
      <div className="animate-fade-in-up w-full max-w-sm text-center">
        <div
          aria-hidden="true"
          className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-2xl border border-line bg-card text-fg-dim"
        >
          <WifiOff size={30} />
        </div>
        <h1 className="mb-2 font-display text-4xl tracking-wide text-fg">
          You&apos;re <span className="text-sffd-red-text">offline</span>
        </h1>
        <p className="mb-8 text-sm text-fg-muted">
          ShiftSwap needs a connection to load shifts and trades. Check your signal and try
          again — this page will reload by itself when you&apos;re back online.
        </p>
        <RetryButton />
        {/* Plain link, not <Link>: a full page load is what we want when offline. */}
        <a
          href="/calendar"
          className="mt-3 inline-flex min-h-11 items-center justify-center px-3 text-sm font-medium text-fg-muted underline-offset-2 hover:text-fg hover:underline"
        >
          Open my calendar
        </a>
        <p className="mt-8 text-xs text-fg-dim">
          TeleStaff is the official record for your schedule.
        </p>
      </div>
    </main>
  )
}
