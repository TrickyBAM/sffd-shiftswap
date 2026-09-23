import type { ReactNode } from 'react'
import AppHeader from '@/components/AppHeader'
import { AdminTabs } from './AdminTabs'
import { OverviewStrip } from './OverviewStrip'

export interface AdminFrameProps {
  /** The page's h1 (e.g. "Approvals"). */
  title: string
  children: ReactNode
}

/**
 * Every admin page: the page header (its only h1), the section tabs and the
 * overview counts, then the page content. The tabs sit under the sticky
 * header, which is why each page renders this rather than the layout.
 */
export function AdminFrame({ title, children }: AdminFrameProps) {
  return (
    <>
      <AppHeader title={title} subtitle="Admin" />
      <div className="mx-auto w-full max-w-3xl px-4 pb-8 pt-4 md:px-6">
        <AdminTabs />
        <OverviewStrip className="mt-3" />
        <div className="mt-6">{children}</div>
      </div>
    </>
  )
}
