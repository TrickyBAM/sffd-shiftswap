'use client'

import { ChevronLeft, ChevronRight, Search } from 'lucide-react'
import { Button, Field, Input, Select, cn } from '@/components/ui'
import { BATTALIONS, battalionLabel, divisionLabel, stationLabel } from '@/lib/sffd/stations'

// ---------------------------------------------------------------------------
// Search box
// ---------------------------------------------------------------------------

export interface SearchFieldProps {
  label: string
  value: string
  onChange: (value: string) => void
  placeholder?: string
  hint?: string
  className?: string
}

/** Labelled search input with a magnifier icon. */
export function SearchField({ label, value, onChange, placeholder, hint, className }: SearchFieldProps) {
  return (
    <Field label={label} hint={hint} className={className}>
      <div className="relative">
        <Search
          size={18}
          aria-hidden="true"
          className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-fg-dim"
        />
        <Input
          type="search"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          autoComplete="off"
          enterKeyHint="search"
          className="pl-11"
        />
      </div>
    </Field>
  )
}

// ---------------------------------------------------------------------------
// Station / battalion filters
// ---------------------------------------------------------------------------

export interface StationFilterProps {
  label?: string
  value: number | null
  onChange: (station: number | null) => void
  /** Only list this battalion's stations. */
  battalion?: number | null
  allLabel?: string
  className?: string
}

/** "All stations" or one station, grouped by battalion. */
export function StationFilter({
  label = 'Station',
  value,
  onChange,
  battalion = null,
  allLabel = 'All stations',
  className,
}: StationFilterProps) {
  const groups = battalion === null ? BATTALIONS : BATTALIONS.filter((b) => b.id === battalion)
  return (
    <Field label={label} className={className}>
      <Select
        value={value === null ? '' : String(value)}
        onChange={(event) => onChange(event.target.value ? Number(event.target.value) : null)}
      >
        <option value="">{allLabel}</option>
        {groups.map((b) => (
          <optgroup key={b.id} label={`${battalionLabel(b.id)} · ${divisionLabel(b.division)}`}>
            {[...b.stations]
              .sort((x, y) => x - y)
              .map((station) => (
                <option key={station} value={station}>
                  {stationLabel(station)}
                </option>
              ))}
          </optgroup>
        ))}
      </Select>
    </Field>
  )
}

export interface BattalionFilterProps {
  value: number | null
  onChange: (battalion: number | null) => void
  className?: string
}

/** "All battalions" or one battalion. */
export function BattalionFilter({ value, onChange, className }: BattalionFilterProps) {
  return (
    <Field label="Battalion" className={className}>
      <Select
        value={value === null ? '' : String(value)}
        onChange={(event) => onChange(event.target.value ? Number(event.target.value) : null)}
      >
        <option value="">All battalions</option>
        {BATTALIONS.map((b) => (
          <option key={b.id} value={b.id}>
            {battalionLabel(b.id)} ({divisionLabel(b.division)})
          </option>
        ))}
      </Select>
    </Field>
  )
}

// ---------------------------------------------------------------------------
// Pager
// ---------------------------------------------------------------------------

export interface PagerProps {
  /** What is being paged, for the accessible name ("Members"). */
  label: string
  offset: number
  pageSize: number
  total: number
  onOffsetChange: (offset: number) => void
  loading?: boolean
  className?: string
}

/** "Showing 1–30 of 132" with Previous / Next. Hidden when everything fits on one page. */
export function Pager({ label, offset, pageSize, total, onOffsetChange, loading = false, className }: PagerProps) {
  if (total <= pageSize && offset === 0) return null
  const from = total === 0 ? 0 : Math.min(offset + 1, total)
  const to = Math.min(offset + pageSize, total)
  return (
    <nav aria-label={`${label} pages`} className={cn('flex flex-wrap items-center justify-between gap-3', className)}>
      <p className="text-sm text-fg-muted" aria-live="polite">
        Showing {from.toLocaleString('en-US')}–{to.toLocaleString('en-US')} of {total.toLocaleString('en-US')}
      </p>
      <div className="flex gap-2">
        <Button
          variant="secondary"
          size="sm"
          icon={<ChevronLeft size={16} aria-hidden="true" />}
          disabled={offset === 0 || loading}
          onClick={() => onOffsetChange(Math.max(0, offset - pageSize))}
        >
          Previous
        </Button>
        <Button
          variant="secondary"
          size="sm"
          iconRight={<ChevronRight size={16} aria-hidden="true" />}
          disabled={offset + pageSize >= total || loading}
          onClick={() => onOffsetChange(offset + pageSize)}
        >
          Next
        </Button>
      </div>
    </nav>
  )
}
