'use client'

import { useId } from 'react'
import { MapPin } from 'lucide-react'
import { StationPicker } from '@/components/pickers'
import { Button } from '@/components/ui'
import { battalionLabel, divisionLabel, stationInfo, stationLabel } from '@/lib/sffd/stations'

export interface LocationFieldProps {
  /** The shift's station. */
  value: number | null
  onChange: (station: number) => void
  /** My own station (the default). */
  myStation: number | null
  /** Show the Division ▸ Battalion ▸ Station selects. */
  editing: boolean
  onEditingChange: (editing: boolean) => void
  error?: string
  disabled?: boolean
}

/** Where the shift is worked: my station by default, with "Change". */
export function LocationField({
  value,
  onChange,
  myStation,
  editing,
  onEditingChange,
  error,
  disabled = false,
}: LocationFieldProps) {
  const labelId = useId()
  const info = value != null ? stationInfo(value) : null

  if (editing || !info) {
    return (
      <div className="space-y-3">
        <StationPicker
          label="Where is the shift?"
          value={value}
          onChange={onChange}
          disabled={disabled}
          error={error}
          hint="Picking a station fills in its battalion and division."
        />
        <div className="flex flex-wrap gap-2">
          {info ? (
            <Button variant="secondary" size="sm" onClick={() => onEditingChange(false)} disabled={disabled}>
              Done
            </Button>
          ) : null}
          {myStation != null && value !== myStation ? (
            <Button
              variant="ghost"
              size="sm"
              disabled={disabled}
              onClick={() => {
                onChange(myStation)
                onEditingChange(false)
              }}
            >
              Use my station ({stationLabel(myStation)})
            </Button>
          ) : null}
        </div>
      </div>
    )
  }

  const mine = value === myStation
  return (
    <div className="space-y-1.5">
      <p className="text-sm font-medium text-fg" id={labelId}>
        Where is the shift?
      </p>
      <div
        role="group"
        aria-labelledby={labelId}
        className="flex items-center gap-3 rounded-xl border border-line-strong bg-elevated px-4 py-3"
      >
        <MapPin size={20} aria-hidden="true" className="shrink-0 text-fg-dim" />
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-fg">
            {info.label}
            {mine ? <span className="ml-2 text-sm font-normal text-fg-muted">(your station)</span> : null}
          </p>
          <p className="text-sm text-fg-muted">
            {battalionLabel(info.battalion)} · {divisionLabel(info.division)}
          </p>
        </div>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => onEditingChange(true)}
          disabled={disabled}
          aria-label={`Change where the shift is (now ${info.label})`}
        >
          Change
        </Button>
      </div>
      {error ? <p className="text-sm text-sffd-red-text">{error}</p> : null}
    </div>
  )
}
