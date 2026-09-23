'use client'

import { Button, Field, Input, Select } from '@/components/ui'
import { isYmd } from '@/lib/sffd/dates'
import { stationInfo } from '@/lib/sffd/stations'
import { BattalionFilter, SearchField, StationFilter } from '../../_components/ListControls'
import { DEFAULT_TRADE_FILTERS, SCOPE_OPTIONS, isTradeScope, type TradeFilters } from '../_lib/query'

export interface TradeFiltersBarProps {
  value: TradeFilters
  onChange: (next: TradeFilters) => void
}

/** Status, date range, battalion/station and member-name filters for /admin/trades. */
export function TradeFiltersBar({ value, onChange }: TradeFiltersBarProps) {
  const set = (patch: Partial<TradeFilters>) => onChange({ ...value, ...patch })
  const rangeBackwards = isYmd(value.from) && isYmd(value.to) && value.from > value.to
  const filtered = JSON.stringify(value) !== JSON.stringify(DEFAULT_TRADE_FILTERS)

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Show">
          <Select
            value={value.scope}
            onChange={(event) => {
              const next = event.target.value
              if (isTradeScope(next)) set({ scope: next })
            }}
          >
            {SCOPE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
        </Field>
        <SearchField
          label="Member"
          value={value.member}
          onChange={(member) => set({ member })}
          placeholder="Poster or coverer name"
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Field label="From" error={rangeBackwards ? 'Pick a start date before the end date.' : undefined}>
          <Input type="date" value={value.from} onChange={(event) => set({ from: event.target.value })} />
        </Field>
        <Field label="To">
          <Input type="date" value={value.to} min={value.from || undefined} onChange={(event) => set({ to: event.target.value })} />
        </Field>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <BattalionFilter
          value={value.battalion}
          onChange={(battalion) => {
            // Keep the station only if it belongs to the new battalion.
            const keep = value.station !== null && battalion !== null && stationInfo(value.station)?.battalion === battalion
            set({ battalion, station: keep ? value.station : null })
          }}
        />
        <StationFilter
          value={value.station}
          battalion={value.battalion}
          onChange={(station) => {
            const info = station !== null ? stationInfo(station) : null
            set({ station, battalion: info ? info.battalion : value.battalion })
          }}
        />
      </div>

      {filtered ? (
        <Button variant="ghost" size="sm" onClick={() => onChange(DEFAULT_TRADE_FILTERS)}>
          Reset filters
        </Button>
      ) : null}
    </div>
  )
}
