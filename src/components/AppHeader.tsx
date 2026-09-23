'use client'

import type { ReactNode } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Bell, ChevronLeft, ShieldCheck } from 'lucide-react'
import { CountBadge } from '@/components/ui/Badge'
import { cn } from '@/components/ui/cn'
import { useProfile } from '@/components/providers/ProfileProvider'
import { useUnreadCount } from '@/hooks/useUnreadCount'
import { isNavActive } from './Navigation'

export interface AppHeaderProps {
  /** Page title (the page's h1), shown in the display font. */
  title: ReactNode
  /** Optional line under the title. */
  subtitle?: ReactNode
  /** Adds a back link before the title (e.g. trade detail → /trades). */
  back?: { href: string; label: string }
  /** Extra page actions placed before the bell. */
  actions?: ReactNode
  className?: string
}

const ICON_LINK =
  'relative inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full transition-colors'

/**
 * Sticky page header: title slot, alerts bell with unread badge (→ /alerts) and, for
 * admins, a shield link to /admin. Must render inside <ProfileProvider>.
 *
 * Titles and subtitles wrap to a second line instead of being cut off with "…" on a
 * 375 px phone. Left/right safe areas are padded by AppShell's <main>, which this
 * header sits in.
 */
export default function AppHeader({ title, subtitle, back, actions, className }: AppHeaderProps) {
  const { profile, isAdmin } = useProfile()
  const { count } = useUnreadCount(profile.id)
  const pathname = usePathname() ?? ''
  const onAlerts = isNavActive(pathname, '/alerts')
  const onAdmin = isNavActive(pathname, '/admin')

  const alertsLabel = count > 0 ? `Alerts, ${count} unread` : 'Alerts'

  return (
    <header
      className={cn(
        'glass-nav sticky top-0 z-30 border-b border-line pt-safe',
        className,
      )}
    >
      <div className="mx-auto flex min-h-16 max-w-3xl items-center gap-2 px-4 py-2 md:px-6">
        {back ? (
          <Link
            href={back.href}
            aria-label={back.label}
            className={cn(ICON_LINK, '-ml-2 text-fg-muted hover:bg-white/[0.06] hover:text-fg')}
          >
            <ChevronLeft size={24} aria-hidden="true" />
          </Link>
        ) : null}

        <div className="min-w-0 flex-1">
          <h1 className="line-clamp-2 font-display text-3xl leading-none tracking-wide break-words text-fg">{title}</h1>
          {subtitle ? (
            <p className="mt-0.5 line-clamp-2 text-sm leading-snug text-pretty break-words text-fg-muted">{subtitle}</p>
          ) : null}
        </div>

        {actions ? <div className="flex shrink-0 items-center gap-1">{actions}</div> : null}

        {isAdmin ? (
          <Link
            href="/admin"
            aria-label="Admin"
            aria-current={onAdmin ? 'page' : undefined}
            className={cn(
              ICON_LINK,
              onAdmin ? 'bg-accent-blue/15 text-accent-blue' : 'text-fg-muted hover:bg-white/[0.06] hover:text-fg',
            )}
          >
            <ShieldCheck size={22} aria-hidden="true" />
          </Link>
        ) : null}

        <Link
          href="/alerts"
          aria-label={alertsLabel}
          aria-current={onAlerts ? 'page' : undefined}
          className={cn(
            ICON_LINK,
            onAlerts ? 'bg-sffd-red/15 text-sffd-red-text' : 'text-fg-muted hover:bg-white/[0.06] hover:text-fg',
          )}
        >
          <Bell size={22} aria-hidden="true" />
          <CountBadge count={count} className="absolute right-0.5 top-0.5 ring-2 ring-surface" />
        </Link>
      </div>
    </header>
  )
}
