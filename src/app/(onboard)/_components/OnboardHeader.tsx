import type { ReactNode } from 'react'
import { BrandMark } from '@/app/(auth)/_components/BrandMark'

export interface OnboardHeaderProps {
  /** The page's h1. */
  title: ReactNode
  subtitle?: ReactNode
}

/**
 * Page header for the joining steps. Same look as the app's AppHeader, but
 * without the alerts bell and admin links: those pages aren't open yet, and a
 * tap on them would only bounce the member back here.
 */
export function OnboardHeader({ title, subtitle }: OnboardHeaderProps) {
  return (
    <header className="glass-nav sticky top-0 z-30 border-b border-line pt-safe px-safe">
      <div className="mx-auto flex min-h-16 max-w-xl flex-col justify-center px-4 py-3">
        <BrandMark size="sm" className="text-fg-muted" />
        <h1 className="mt-2 font-display text-3xl leading-none tracking-wide text-fg">{title}</h1>
        {subtitle ? <p className="mt-1 text-sm text-fg-muted">{subtitle}</p> : null}
      </div>
    </header>
  )
}
