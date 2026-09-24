'use client'

import { usePathname } from 'next/navigation'
import { LinkTabs } from '@/components/ui'

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

/**
 * Approvals · Members · Roster · Trades · Activity (UX-08). The five labels
 * fit a 375 px phone on one row (measured in Chromium with DM Sans: 341 of
 * 341 px); narrower phones scroll sideways with an edge fade (LinkTabs). The
 * waiting-for-approval count isn't repeated on the Approvals tab: a count
 * bubble would push Activity off a 375 px screen, and the same number sits
 * right below in the overview strip's "Waiting" tile, highlighted when it
 * isn't zero, on every admin page.
 */
export function AdminTabs({ className }: { className?: string }) {
  const pathname = usePathname() ?? '/admin'
  return (
    <LinkTabs label="Admin sections" items={ADMIN_SECTIONS} activeHref={activeAdminHref(pathname)} className={className} />
  )
}
