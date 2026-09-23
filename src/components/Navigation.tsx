'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  ArrowLeftRight,
  CalendarDays,
  ClipboardList,
  Flame,
  Plus,
  UserRound,
  type LucideIcon,
} from 'lucide-react'
import { cn } from '@/components/ui/cn'

interface NavItem {
  href: string
  label: string
  icon: LucideIcon
  /** The raised center "Post" button. */
  primary?: boolean
}

/** The five tabs (ARCHITECTURE §1, §7.1): Calendar · Board · Post · Trades · Profile. */
export const NAV_ITEMS: readonly NavItem[] = [
  { href: '/calendar', label: 'Calendar', icon: CalendarDays },
  { href: '/board', label: 'Board', icon: ClipboardList },
  { href: '/post', label: 'Post', icon: Plus, primary: true },
  { href: '/trades', label: 'Trades', icon: ArrowLeftRight },
  { href: '/profile', label: 'Profile', icon: UserRound },
]

export function isNavActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`)
}

/**
 * Main navigation: glassmorphic bottom tab bar with a raised Post button on phones
 * (portrait and landscape), left rail on desktop. Only one is displayed at a time, so
 * each is its own "Main" landmark and the hidden one is removed from the accessibility
 * tree by CSS.
 *
 * "Desktop" = 1024 px and wider, or 768 px and wider with a fine pointer (mouse or
 * trackpad): `[@media(min-width:1024px),(min-width:768px)_and_(pointer:fine)]:`. A phone
 * turned sideways (844–932 px, touch) keeps the tab bar (UX-16). The same variant is
 * written out in AppShell; keep them identical (Tailwind reads class names literally).
 */
export default function Navigation() {
  const pathname = usePathname() ?? ''

  return (
    <>
      <DesktopRail pathname={pathname} />
      <MobileTabBar pathname={pathname} />
    </>
  )
}

function DesktopRail({ pathname }: { pathname: string }) {
  return (
    <aside className="fixed inset-y-0 left-0 z-40 hidden w-[var(--rail-width)] flex-col border-r border-line bg-card pl-safe [@media(min-width:1024px),(min-width:768px)_and_(pointer:fine)]:flex">
      <Link
        href="/calendar"
        className="flex min-h-16 items-center gap-2 border-b border-line px-5 py-5"
        aria-label="ShiftSwap home"
      >
        <Flame size={28} className="text-sffd-red-text" aria-hidden="true" />
        <span className="font-display text-2xl tracking-wide text-fg" aria-hidden="true">
          SHIFT<span className="text-sffd-red-text">SWAP</span>
        </span>
      </Link>

      <nav aria-label="Main" className="flex flex-1 flex-col gap-1 px-3 py-4">
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon
          const active = isNavActive(pathname, item.href)

          if (item.primary) {
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'my-2 flex min-h-12 items-center gap-3 rounded-xl px-3 text-sm font-semibold text-white transition-colors',
                  'bg-sffd-red shadow-[0_4px_20px_rgba(211,47,47,0.3)] hover:bg-sffd-red-dark',
                  active && 'ring-2 ring-white/40',
                )}
              >
                <Icon size={20} aria-hidden="true" />
                Post a shift
              </Link>
            )
          }

          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'flex min-h-12 items-center gap-3 rounded-xl px-3 text-sm font-medium transition-colors',
                active
                  ? 'bg-sffd-red/10 text-sffd-red-text'
                  : 'text-fg-muted hover:bg-white/[0.04] hover:text-fg',
              )}
            >
              <Icon size={20} aria-hidden="true" />
              {item.label}
            </Link>
          )
        })}
      </nav>

      <div className="border-t border-line px-5 py-4 pb-[calc(var(--safe-bottom)+1rem)]">
        <Link href="/privacy" className="text-xs text-fg-dim underline-offset-2 hover:text-fg-muted hover:underline">
          Unofficial tool · Privacy &amp; disclaimer
        </Link>
      </div>
    </aside>
  )
}

function MobileTabBar({ pathname }: { pathname: string }) {
  return (
    <nav
      aria-label="Main"
      className="glass-nav fixed inset-x-0 bottom-0 z-40 border-t border-line pb-safe px-safe [@media(min-width:1024px),(min-width:768px)_and_(pointer:fine)]:hidden"
    >
      <ul className="mx-auto flex h-[var(--nav-height)] max-w-lg items-stretch justify-around">
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon
          const active = isNavActive(pathname, item.href)

          if (item.primary) {
            return (
              <li key={item.href} className="flex flex-1 justify-center">
                <Link
                  href={item.href}
                  aria-current={active ? 'page' : undefined}
                  className="group relative -mt-5 flex min-w-16 flex-col items-center"
                >
                  <span
                    aria-hidden="true"
                    className={cn(
                      'flex h-14 w-14 items-center justify-center rounded-2xl text-white transition-transform',
                      'bg-linear-to-br from-sffd-red to-sffd-red-dark shadow-[0_4px_20px_rgba(211,47,47,0.45)]',
                      'group-active:scale-95',
                      active && 'ring-2 ring-white/50 ring-offset-2 ring-offset-surface',
                    )}
                  >
                    <Icon size={26} strokeWidth={2.5} />
                  </span>
                  <span className={cn('mt-1 text-[11px] font-medium', active ? 'text-fg' : 'text-fg-muted')}>
                    {item.label}
                  </span>
                </Link>
              </li>
            )
          }

          return (
            <li key={item.href} className="flex flex-1">
              <Link
                href={item.href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'flex w-full min-w-11 flex-col items-center justify-center gap-0.5 text-[11px] transition-colors',
                  active ? 'font-semibold text-sffd-red-text' : 'font-medium text-fg-dim hover:text-fg',
                )}
              >
                <Icon size={22} aria-hidden="true" />
                {item.label}
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
