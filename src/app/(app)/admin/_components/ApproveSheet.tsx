'use client'

import { useState } from 'react'
import { CheckCircle2, Search, XCircle } from 'lucide-react'
import {
  Badge,
  Button,
  ErrorState,
  Field,
  Fieldset,
  Input,
  Sheet,
  Skeleton,
  cn,
  useToast,
} from '@/components/ui'
import {
  approveMember,
  findRosterCandidates,
  getRosterEntry,
  listRoster,
  rankRosterCandidates,
  type PendingApproval,
  type Sb,
} from '@/lib/api'
import { toAppError } from '@/lib/errors'
import { tourLabel } from '@/lib/format'
import { createClient } from '@/lib/supabase/client'
import type { RosterEntry } from '@/lib/types/database'
import { stationText } from '../_lib/format'
import { fetchMemberNames } from '../_lib/queries'
import { compareRosterToMember, type CompareItem } from '../_lib/roster-compare'
import { useAsyncData, useDebouncedValue } from '../_lib/useAsyncData'

interface Candidate {
  entry: RosterEntry
  /** Linked to someone else: can't be chosen. */
  blocked: boolean
  claimedByName: string | null
  compare: CompareItem[]
}

async function loadCandidates(sb: Sb, approval: PendingApproval, search: string): Promise<Candidate[]> {
  const { member, rosterId } = approval
  const [rows, suggested] = await Promise.all([
    search
      ? listRoster(sb, { search, limit: 25 }).then((page) => rankRosterCandidates(page.items, member.full_name))
      : findRosterCandidates(sb, member.full_name),
    rosterId && !search ? getRosterEntry(sb, rosterId) : Promise.resolve(null),
  ])
  const list = (suggested && !rows.some((r) => r.id === suggested.id) ? [suggested, ...rows] : rows).slice(0, 25)
  const names = await fetchMemberNames(
    sb,
    list.map((r) => (r.claimed_by && r.claimed_by !== member.id ? r.claimed_by : null)),
  )
  return list.map((entry) => ({
    entry,
    blocked: Boolean(entry.claimed_by && entry.claimed_by !== member.id),
    claimedByName: entry.claimed_by ? (names.get(entry.claimed_by) ?? 'another member') : null,
    compare: compareRosterToMember(entry, member),
  }))
}

function entryName(entry: Pick<RosterEntry, 'first_name' | 'last_name'>): string {
  return `${entry.first_name} ${entry.last_name}`.trim()
}

function entryFacts(entry: RosterEntry): string {
  return [
    entry.employee_id ? `Emp ID ${entry.employee_id}` : null,
    entry.rank,
    typeof entry.station === 'number' ? stationText(entry.station) : null,
    typeof entry.tour === 'number' ? tourLabel(entry.tour) : null,
  ]
    .filter(Boolean)
    .join(' · ')
}

export interface ApproveSheetProps {
  approval: PendingApproval
  onClose: () => void
  /** Called after a successful approval (reload lists, counts). */
  onApproved: () => void
}

/**
 * Approve a sign-up, optionally linking the roster entry that is really them
 * (the suggested closest match is pre-selected).
 */
export function ApproveSheet({ approval, onClose, onApproved }: ApproveSheetProps) {
  const toast = useToast()
  const { member } = approval
  const name = member.full_name || member.email || 'this member'

  const [search, setSearch] = useState('')
  const query = useDebouncedValue(search.trim().length >= 2 ? search.trim() : '', 300)
  const [selectedId, setSelectedId] = useState<string | null>(approval.rosterId)
  const [pickedName, setPickedName] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const candidates = useAsyncData(() => loadCandidates(createClient(), approval, query), `${member.id}|${query}`)
  const rows = candidates.data ?? []
  const selectedRow = rows.find((c) => c.entry.id === selectedId)
  // A suggested entry that turns out to be linked to someone else can't be used.
  const effectiveId = selectedRow?.blocked ? null : selectedId
  const selectedLabel = selectedRow ? entryName(selectedRow.entry) : (pickedName ?? 'the suggested roster entry')

  async function approve() {
    if (busy) return
    setBusy(true)
    try {
      await approveMember(createClient(), member.id, effectiveId)
      toast.success(`${name} is approved`, effectiveId ? 'Linked to their roster entry.' : undefined)
      onApproved()
    } catch (err) {
      toast.error(`Couldn't approve ${name}`, toAppError(err).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Sheet
      open
      onClose={onClose}
      closeOnOverlay={!busy}
      closeOnEscape={!busy}
      title={`Approve ${name}`}
      description="Link their roster entry if you can find it. It keeps the roster accurate and stops anyone else claiming it."
      footer={
        <div className="space-y-3">
          <p className="text-sm text-fg-muted" aria-live="polite">
            {effectiveId ? (
              <>
                Will link to <span className="font-semibold text-fg">{selectedLabel}</span> on the roster.
              </>
            ) : (
              'No roster entry will be linked.'
            )}
          </p>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={onClose} disabled={busy} className="flex-1">
              Cancel
            </Button>
            <Button onClick={approve} loading={busy} className="flex-1">
              Approve
            </Button>
          </div>
        </div>
      }
    >
      <div className="space-y-4 pb-2">
        <Field label="Search the roster" hint="Try a last name or employee ID if the right person isn't listed.">
          <div className="relative">
            <Search
              size={18}
              aria-hidden="true"
              className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-fg-dim"
            />
            <Input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={member.full_name.split(' ').slice(-1)[0] || 'Last name'}
              autoComplete="off"
              className="pl-11"
            />
          </div>
        </Field>

        <Fieldset legend="Roster entry">
          <RosterChoice
            id="none"
            checked={effectiveId === null}
            onSelect={() => {
              setSelectedId(null)
              setPickedName(null)
            }}
            title="Don't link a roster entry"
            subtitle="Approve them without a roster match."
          />

          {candidates.error ? (
            <ErrorState
              title="Couldn't load the roster"
              message={candidates.error.message}
              onRetry={candidates.reload}
              className="py-6"
            />
          ) : candidates.loading && !candidates.data ? (
            <div role="status" aria-live="polite" className="space-y-2">
              <span className="sr-only">Loading roster matches…</span>
              <Skeleton className="h-20 w-full rounded-xl" />
              <Skeleton className="h-20 w-full rounded-xl" />
            </div>
          ) : rows.length === 0 ? (
            <p className="rounded-xl border border-dashed border-line-strong px-4 py-5 text-center text-sm text-fg-muted">
              {query ? `No roster entries match “${query}”.` : `No roster entries with the last name of ${name}.`}
            </p>
          ) : (
            <div className={cn('space-y-2', candidates.loading && 'opacity-60')}>
              {rows.map((candidate) => (
                <RosterChoice
                  key={candidate.entry.id}
                  id={candidate.entry.id}
                  checked={effectiveId === candidate.entry.id}
                  disabled={candidate.blocked}
                  onSelect={() => {
                    setSelectedId(candidate.entry.id)
                    setPickedName(entryName(candidate.entry))
                  }}
                  title={entryName(candidate.entry)}
                  subtitle={entryFacts(candidate.entry) || 'No other details on the roster'}
                  suggested={candidate.entry.id === approval.rosterId}
                  claimedNote={
                    candidate.blocked
                      ? `Already linked to ${candidate.claimedByName}`
                      : candidate.entry.claimed_by
                        ? 'Already linked to this member'
                        : null
                  }
                  compare={candidate.compare}
                />
              ))}
            </div>
          )}
        </Fieldset>
      </div>
    </Sheet>
  )
}

interface RosterChoiceProps {
  id: string
  checked: boolean
  disabled?: boolean
  onSelect: () => void
  title: string
  subtitle: string
  suggested?: boolean
  claimedNote?: string | null
  compare?: CompareItem[]
}

function RosterChoice({
  id,
  checked,
  disabled = false,
  onSelect,
  title,
  subtitle,
  suggested = false,
  claimedNote,
  compare,
}: RosterChoiceProps) {
  const inputId = `roster-choice-${id}`
  return (
    <label
      htmlFor={inputId}
      className={cn(
        'flex min-h-11 gap-3 rounded-xl border p-3 transition-colors',
        disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer hover:border-line-strong',
        checked ? 'border-sffd-red/60 bg-sffd-red/10' : 'border-line bg-elevated/50',
      )}
    >
      <input
        id={inputId}
        type="radio"
        name="roster-choice"
        className="mt-1 h-5 w-5 shrink-0 accent-sffd-red"
        checked={checked}
        disabled={disabled}
        onChange={onSelect}
      />
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-2">
          <span className="font-semibold text-fg">{title}</span>
          {suggested ? <Badge tone="blue">Closest match</Badge> : null}
        </span>
        <span className="mt-0.5 block text-sm text-fg-muted">{subtitle}</span>
        {claimedNote ? <span className="mt-1 block text-sm text-accent-yellow">{claimedNote}</span> : null}
        {compare && compare.length > 0 ? (
          <span className="mt-2 flex flex-col gap-1">
            {compare.map((item) => (
              <span key={item.field} className="flex items-start gap-1.5 text-xs">
                {item.status === 'match' ? (
                  <CheckCircle2 size={14} aria-hidden="true" className="mt-px shrink-0 text-accent-green" />
                ) : (
                  <XCircle size={14} aria-hidden="true" className="mt-px shrink-0 text-accent-yellow" />
                )}
                <span className={item.status === 'match' ? 'text-fg-muted' : 'text-fg'}>
                  {item.label}{' '}
                  {item.status === 'match'
                    ? 'matches'
                    : `differs: roster says ${item.roster}, they entered ${item.member}`}
                </span>
              </span>
            ))}
          </span>
        ) : null}
      </span>
    </label>
  )
}
