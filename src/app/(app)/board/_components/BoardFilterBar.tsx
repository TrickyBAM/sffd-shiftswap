'use client'

import { useId, useState } from 'react'
import { ChevronDown, SlidersHorizontal } from 'lucide-react'
import { Button, Chip, Field, Select, cn } from '@/components/ui'
import { RANKS, isRank } from '@/lib/sffd/ranks'
import {
  battalionOptions,
  describeFilters,
  divisionOptions,
  effectiveRank,
  isAllLocations,
  stationOptions,
  withAllLocations,
  withBattalion,
  withDivision,
  withStation,
  type BoardFilterState,
} from '../_lib/filters'

export interface BoardFilterBarProps {
  filters: BoardFilterState
  onChange: (filters: BoardFilterState) => void
  /** My default filters (for "Back to my battalion"). */
  defaults: BoardFilterState
  memberRank: string | null
}

function toNumber(value: string): number | null {
  if (value === '') return null
  const n = Number(value)
  return Number.isInteger(n) ? n : null
}

/**
 * "Only shifts I can take" toggle plus a collapsible panel with the
 * Division ▸ Battalion ▸ Station cascade and rank.
 */
export function BoardFilterBar({ filters, onChange, defaults, memberRank }: BoardFilterBarProps) {
  const [open, setOpen] = useState(false)
  const panelId = useId()
  const rank = effectiveRank(filters, memberRank)
  const atDefaultLocation =
    filters.division === defaults.division &&
    filters.battalion === defaults.battalion &&
    filters.station === defaults.station

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Chip
          selected={filters.onlyEligible}
          onSelectedChange={(onlyEligible) => onChange({ ...filters, onlyEligible })}
        >
          Only shifts I can take
        </Chip>
        <button
          type="button"
          aria-expanded={open}
          aria-controls={panelId}
          onClick={() => setOpen((v) => !v)}
          className={cn(
            'inline-flex min-h-11 min-w-0 max-w-full items-center gap-2 rounded-full border px-4 text-sm font-medium transition-colors',
            open
              ? 'border-line-strong bg-raised text-fg'
              : 'border-line-strong bg-elevated text-fg-muted hover:bg-raised hover:text-fg',
          )}
        >
          <SlidersHorizontal size={16} aria-hidden="true" className="shrink-0" />
          <span className="truncate">
            <span className="sr-only">Filters: </span>
            {describeFilters(filters, memberRank)}
          </span>
          <ChevronDown
            size={16}
            aria-hidden="true"
            className={cn('shrink-0 transition-transform', open && 'rotate-180')}
          />
        </button>
      </div>

      <div
        id={panelId}
        hidden={!open}
        className="rounded-2xl border border-line bg-card p-4"
      >
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Division">
            <Select
              value={filters.division ?? ''}
              onChange={(e) => onChange(withDivision(filters, toNumber(e.target.value)))}
            >
              <option value="">All divisions</option>
              {divisionOptions().map((d) => (
                <option key={d.id} value={d.id}>
                  {d.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Battalion">
            <Select
              value={filters.battalion ?? ''}
              onChange={(e) => onChange(withBattalion(filters, toNumber(e.target.value)))}
            >
              <option value="">All battalions</option>
              {battalionOptions(filters.division).map((b) => (
                <option key={b.id} value={b.id}>
                  {b.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Station">
            <Select
              value={filters.station ?? ''}
              onChange={(e) => onChange(withStation(filters, toNumber(e.target.value)))}
            >
              <option value="">All stations</option>
              {stationOptions(filters.division, filters.battalion).map((s) => (
                <option key={s.station} value={s.station}>
                  {s.label}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        <Field
          label="Rank"
          className="mt-3"
          hint={
            filters.onlyEligible
              ? 'Trades are same rank only. Turn off “Only shifts I can take” to look at other ranks.'
              : undefined
          }
        >
          <Select
            value={rank ?? ''}
            disabled={filters.onlyEligible}
            onChange={(e) => onChange({ ...filters, rank: isRank(e.target.value) ? e.target.value : null })}
          >
            <option value="">All ranks</option>
            {RANKS.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </Select>
        </Field>

        <div className="mt-3 flex flex-wrap gap-2">
          {!isAllLocations(filters) ? (
            <Button variant="secondary" size="sm" onClick={() => onChange(withAllLocations(filters))}>
              All locations
            </Button>
          ) : null}
          {!atDefaultLocation && (defaults.battalion != null || defaults.division != null) ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={() =>
                onChange({
                  ...filters,
                  division: defaults.division,
                  battalion: defaults.battalion,
                  station: defaults.station,
                })
              }
            >
              Back to my battalion
            </Button>
          ) : null}
          <Button variant="ghost" size="sm" className="ml-auto" onClick={() => setOpen(false)}>
            Done
          </Button>
        </div>
      </div>
    </div>
  )
}
