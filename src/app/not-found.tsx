import type { Metadata } from 'next'
import Link from 'next/link'
import { MapPinOff } from 'lucide-react'
import { buttonClasses } from '@/components/ui/button-styles'

export const metadata: Metadata = {
  title: 'Page not found',
}

export default function NotFound() {
  return (
    <main id="main" className="flex min-h-dvh items-center justify-center px-4 pt-safe pb-safe">
      <div className="animate-fade-in-up w-full max-w-sm text-center">
        <div
          aria-hidden="true"
          className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-2xl border border-line bg-card text-fg-dim"
        >
          <MapPinOff size={30} />
        </div>
        <h1 className="mb-2 font-display text-4xl tracking-wide text-fg">
          Page not <span className="text-sffd-red-text">found</span>
        </h1>
        <p className="mb-8 text-sm text-fg-muted">
          That page doesn&apos;t exist or has moved. The shift or trade you were looking for may
          have been cancelled.
        </p>
        <Link href="/calendar" className={buttonClasses({ size: 'lg', fullWidth: true })}>
          Go to my calendar
        </Link>
      </div>
    </main>
  )
}
