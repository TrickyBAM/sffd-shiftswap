'use client'

import { usePathname } from 'next/navigation'
import { LinkTabs } from '@/components/ui'
import { useAdmin } from './AdminProvider'

export const ADMIN_SECTIONS = [
  { href: '/admin', label: 'Approvals' },
  { href: '/admin/members', label: 'Members' },
  { href: '/admin/roster', label: 'Roster' },
  { href: '/admin/trades', label: 'Trades' },
  { href: '/admin/activity', label: 'Activity' },
] as const

/** The admin section whose href best matches the current path. */
export function activeAdminHref(pathname: string): string {
  const path = pathname.replace(/\/+$/, '') || '/'
  let best: string = ADMIN_SECTIONS[0].href
  for (const { href } of ADMIN_SECTIONS) {
    if ((path === href || path.startsWith(`${href}/`)) && href.length > best.length) best = href
  }
  return best
}

/** Approvals · Members · Roster · Trades · Activity. */
export function AdminTabs({ className }: { className?: string }) {
  const pathname = usePathname() ?? '/admin'
  const { overview } = useAdmin()
  const items = ADMIN_SECTIONS.map((section) =>
    section.href === '/admin' ? { ...section, count: overview?.pending_members ?? 0 } : section,
  )
  return <LinkTabs label="Admin sections" items={items} activeHref={activeAdminHref(pathname)} className={className} />
}
