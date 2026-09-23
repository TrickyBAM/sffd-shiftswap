'use client'

import { useState } from 'react'
import Link from 'next/link'
import { ClipboardList, Trash2 } from 'lucide-react'
import { Badge, Button, Card, EmptyState, ErrorState, Field, LoadingBlock, Select, cn } from '@/components/ui'
import { deleteRosterEntry, listRoster, type Sb } from '@/lib/api'
import { plural, tourLabel } from '@/lib/format'
import { createClient } from '@/lib/supabase/client'
import type { RosterEntry } from '@/lib/types/database'
import { Pager, SearchField } from '../../_components/ListControls'
import { ReasonConfirmDialog } from '../../_components/ReasonConfirmDialog'
import { stationText } from '../../_lib/format'
import { fetchMemberNames } from '../../_lib/queries'
import { useAsyncData, useDebouncedValue } from '../../_lib/useAsyncData'

export const ROSTER_PAGE_SIZE = 50

type Claimed = 'all' | 'claimed' | 'unclaimed'

interface RosterItem {
  entry: RosterEntry
  claimedByName: string | null
}

async function loadRoster(
  sb: Sb,
  search: string,
  claimed: Claimed,
  offset: number,
): Promise<{ items: RosterItem[]; total: number }> {
  const page = await listRoster(sb, {
    search,
    claimed: claimed === 'all' ? null : claimed === 'claimed',
    limit: ROSTER_PAGE_SIZE,
    offset,
  })
  const names = await fetchMemberNames(
    sb,
    page.items.map((entry) => entry.claimed_by),
  )
  return {
    total: page.total,
    items: page.items.map((entry) => ({
      entry,
      claimedByName: entry.claimed_by ? (names.get(entry.claimed_by) ?? 'a member') : null,
    })),
  }
}

function entryFacts(entry: RosterEntry): string {
  return [
    entry.employee_id ? `ID ${entry.employee_id}` : null,
    entry.rank,
    typeof entry.station === 'number' ? stationText(entry.station) : null,
    typeof entry.tour === 'number' ? tourLabel(entry.tour) : null,
  ]
    .filter(Boolean)
    .join(' · ')
}

export interface RosterListProps {
  /** Bump to reload (e.g. after an import). */
  version: number
  /** Called after an entry is removed (reload counts). */
  onChanged: () => void
}

/** The current roster: search, claimed/unclaimed filter, remove entries. */
export function RosterList({ version, onChanged }: RosterListProps) {
  const [searchText, setSearchText] = useState('')
  const [claimed, setClaimed] = useState<Claimed>('all')
  const search = useDebouncedValue(searchText.trim(), 300)
  const filterKey = `${search}|${claimed}`
  const [page, setPage] = useState({ key: filterKey, offset: 0 })
  const offset = page.key === filterKey ? page.offset : 0
  const [removing, setRemoving] = useState<RosterItem | null>(null)

  const roster = useAsyncData(
    () => loadRoster(createClient(), search, claimed, offset),
    `${filterKey}|${offset}|${version}`,
  )
  const items = roster.data?.items ?? []
  const total = roster.data?.total ?? 0
  const filtered = search !== '' || claimed !== 'all'

  return (
    <section aria-labelledby="roster-list-heading" className="space-y-4">
      <h2 id="roster-list-heading" className="font-display text-2xl text-fg">
        Current roster
      </h2>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <SearchField
          label="Search the roster"
          value={searchText}
          onChange={setSearchText}
          placeholder="Name, employee ID or email"
          className="sm:col-span-2"
        />
        <Field label="Show">
          <Select value={claimed} onChange={(event) => setClaimed(event.target.value as Claimed)}>
            <option value="all">Everyone</option>
            <option value="unclaimed">Not signed up yet</option>
            <option value="claimed">Linked to a member</option>
          </Select>
        </Field>
      </div>

      {roster.error ? (
        <ErrorState title="Couldn't load the roster" message={roster.error.message} onRetry={roster.reload} />
      ) : !roster.data ? (
        <LoadingBlock label="Loading the roster…" cards={3} />
      ) : items.length === 0 ? (
        <EmptyState
          icon={<ClipboardList size={28} />}
          title={filtered ? 'No matches' : 'The roster is empty'}
          description={
            filtered
              ? 'Try a different search or show everyone.'
              : 'Upload the department roster above so matching members are approved automatically.'
          }
        />
      ) : (
        <>
          <p className="text-sm text-fg-muted" aria-live="polite">
            {plural(total, 'entry', 'entries')}
          </p>
          <Card padding="none" className={cn(roster.loading && 'opacity-60')} aria-busy={roster.loading || undefined}>
            <ul className="divide-y divide-white/[0.06]">
              {items.map((item) => {
                const { entry, claimedByName } = item
                const name = `${entry.first_name} ${entry.last_name}`
                return (
                  <li key={entry.id} className="flex items-center gap-3 px-4 py-3">
                    <div className="min-w-0 flex-1">
                      <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <span className="font-semibold text-fg">{name}</span>
                        {entry.claimed_by ? (
                          <Badge tone="green">Claimed</Badge>
                        ) : (
                          <Badge tone="neutral">Unclaimed</Badge>
                        )}
                      </p>
                      <p className="truncate text-sm text-fg-muted">{entryFacts(entry) || 'No other details'}</p>
                      {entry.claimed_by ? (
                        <p className="text-xs text-fg-dim">
                          Claimed by{' '}
                          <Link
                            href={`/admin/members?member=${entry.claimed_by}`}
                            className="font-medium text-accent-blue underline-offset-2 hover:underline"
                          >
                            {claimedByName}
                          </Link>
                        </p>
                      ) : entry.email || entry.phone ? (
                        <p className="truncate text-xs text-fg-dim">
                          {[entry.email, entry.phone].filter(Boolean).join(' · ')}
                        </p>
                      ) : null}
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Remove ${name} from the roster`}
                      onClick={() => setRemoving(item)}
                    >
                      <Trash2 size={18} aria-hidden="true" />
                    </Button>
                  </li>
                )
              })}
            </ul>
          </Card>
          <Pager
            label="Roster"
            offset={offset}
            pageSize={ROSTER_PAGE_SIZE}
            total={total}
            loading={roster.loading}
            onOffsetChange={(next) => setPage({ key: filterKey, offset: next })}
          />
        </>
      )}

      {removing ? (
        <ReasonConfirmDialog
          title={`Remove ${removing.entry.first_name} ${removing.entry.last_name} from the roster?`}
          description={
            removing.entry.claimed_by
              ? `${removing.claimedByName} stays a member. Their account just won't be linked to this roster entry any more.`
              : 'Anyone who signs up with this name will need an admin to approve them.'
          }
          confirmLabel="Remove"
          reason="none"
          action={() => deleteRosterEntry(createClient(), removing.entry.id)}
          successTitle="Removed from the roster"
          failureTitle="Couldn't remove that entry"
          onClose={() => setRemoving(null)}
          onDone={() => {
            roster.reload()
            onChanged()
          }}
        />
      ) : null}
    </section>
  )
}
