'use client'

import { useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { Users } from 'lucide-react'
import { Card, EmptyState, ErrorState, LoadingBlock, cn } from '@/components/ui'
import { isUuid, listMembers } from '@/lib/api'
import { plural } from '@/lib/format'
import { createClient } from '@/lib/supabase/client'
import { Pager } from '../../_components/ListControls'
import { useAdmin } from '../../_components/AdminProvider'
import { useAsyncData, useDebouncedValue } from '../../_lib/useAsyncData'
import { DEFAULT_MEMBER_FILTERS, MEMBER_PAGE_SIZE, memberListOptions, type MemberFilters } from '../_lib/query'
import { MemberFiltersBar } from './MemberFiltersBar'
import { MemberRow } from './MemberRow'
import { MemberSheet } from './MemberSheet'

/** /admin/members — find anyone, open their sheet to edit or manage them. */
export function MembersView() {
  const router = useRouter()
  const pathname = usePathname() ?? '/admin/members'
  const params = useSearchParams()
  const { refreshOverview } = useAdmin()

  const [filters, setFilters] = useState<MemberFilters>(DEFAULT_MEMBER_FILTERS)
  const search = useDebouncedValue(filters.search.trim(), 300)
  const query: MemberFilters = { ...filters, search }
  const filterKey = JSON.stringify(query)

  // The page resets to the first one whenever the filters change.
  const [page, setPage] = useState({ key: filterKey, offset: 0 })
  const offset = page.key === filterKey ? page.offset : 0

  const members = useAsyncData(
    () => listMembers(createClient(), memberListOptions(query, { offset, limit: MEMBER_PAGE_SIZE })),
    `${filterKey}|${offset}`,
  )

  // ?member=<id> (e.g. from "Recently joined") opens that member's sheet.
  const paramId = params.get('member')
  const linkedId = isUuid(paramId) ? paramId : null
  const [picked, setPicked] = useState<string | null>(null)
  const [dismissedLink, setDismissedLink] = useState<string | null>(null)
  const openId = picked ?? (linkedId && linkedId !== dismissedLink ? linkedId : null)

  function closeSheet() {
    setPicked(null)
    if (linkedId) {
      setDismissedLink(linkedId)
      router.replace(pathname, { scroll: false })
    }
  }

  function afterChange() {
    members.reload()
    void refreshOverview()
  }

  const items = members.data?.items ?? []
  const total = members.data?.total ?? 0

  return (
    <div className="space-y-4">
      <MemberFiltersBar value={filters} onChange={setFilters} />

      {members.error ? (
        <ErrorState title="Couldn't load members" message={members.error.message} onRetry={members.reload} />
      ) : !members.data ? (
        <LoadingBlock label="Loading members…" cards={3} />
      ) : items.length === 0 ? (
        <EmptyState
          icon={<Users size={28} />}
          title="No members found"
          description={
            filterKey === JSON.stringify(DEFAULT_MEMBER_FILTERS)
              ? 'Nobody has signed up yet.'
              : query.status === 'all'
                ? 'Try a different search or clear the filters. Removed accounts are under Status ▸ Removed.'
                : 'Try a different search or clear the filters.'
          }
        />
      ) : (
        <>
          <p className="text-sm text-fg-muted" aria-live="polite">
            {plural(total, 'member')}
          </p>
          <Card padding="none" className={cn(members.loading && 'opacity-60')} aria-busy={members.loading || undefined}>
            <ul className="divide-y divide-white/[0.06]">
              {items.map((member) => (
                <MemberRow key={member.id} member={member} onOpen={setPicked} />
              ))}
            </ul>
          </Card>
          <Pager
            label="Members"
            offset={offset}
            pageSize={MEMBER_PAGE_SIZE}
            total={total}
            loading={members.loading}
            onOffsetChange={(next) => setPage({ key: filterKey, offset: next })}
          />
        </>
      )}

      {openId ? <MemberSheet key={openId} memberId={openId} onClose={closeSheet} onChanged={afterChange} /> : null}
    </div>
  )
}
