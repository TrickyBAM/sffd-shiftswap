import type { ReactNode } from 'react'
import Link from 'next/link'
import { BrandMark } from './_components/BrandMark'

/**
 * Public sign-in / sign-up frame: the brand over a centered card, with the
 * "unofficial tool" note and a privacy link underneath. Signed-in visitors
 * never see it — the proxy sends them on to the app.
 */
export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <main
      id="main"
      tabIndex={-1}
      className="flex min-h-dvh flex-col items-center justify-center px-safe pb-[calc(var(--safe-bottom)+2rem)] pt-[calc(var(--safe-top)+2rem)] outline-none"
    >
      <div className="w-full max-w-md px-4">
        <div className="mb-8 flex flex-col items-center text-center">
          <BrandMark />
          <p className="mt-3 text-sm text-fg-muted">Trade shifts with other SFFD members.</p>
        </div>

        <div className="animate-fade-in-up rounded-2xl border border-line bg-card p-5 sm:p-8">{children}</div>

        <p className="mt-6 flex flex-wrap items-center justify-center gap-x-1 text-center text-xs text-fg-dim">
          <span>Unofficial tool for SFFD members</span>
          <span aria-hidden="true">·</span>
          <Link
            href="/privacy"
            className="inline-flex min-h-11 items-center px-1 font-medium text-fg-muted underline-offset-4 hover:text-fg hover:underline"
          >
            Privacy
          </Link>
        </p>
      </div>
    </main>
  )
}
