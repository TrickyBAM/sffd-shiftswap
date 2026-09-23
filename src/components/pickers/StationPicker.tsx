'use client'

import { useId, useState } from 'react'
import { Field, Fieldset } from '@/components/ui/Field'
import { Select } from '@/components/ui/Input'
import {
  BATTALIONS,
  DIVISIONS,
  battalionLabel,
  battalionsForDivision,
  divisionForBattalion,
  divisionLabel,
  stationInfo,
  stationLabel,
  stationsForBattalion,
} from '@/lib/sffd/stations'

export interface StationPickerProps {
  /** Id of the station <select> (the control that holds the value). Generated when omitted. */
  id?: string
  /** Group label (the fieldset legend). Defaults to "Station". */
  label?: string
  /** The chosen station number, or null when none is chosen yet. */
  value: number | null
  /** Called with a station number; battalion and division always follow from it. */
  onChange: (station: number) => void
  disabled?: boolean
  /** Validation message shown under the station select. */
  error?: string
  /** Optional help text under the station select. */
  hint?: string
  className?: string
}

interface Draft {
  division: number | null
  battalion: number | null
}

const NO_DRAFT: Draft = { division: null, battalion: null }

function byNumber(a: number, b: number) {
  return a - b
}

/**
 * Cascading Division ▸ Battalion ▸ Station selects (ARCHITECTURE §5).
 *
 * The value is always a station: picking one fills in its battalion and
 * division. Division and battalion narrow the station list:
 * - with no station chosen yet they are free filters (a member who only knows
 *   their station number can pick it straight away);
 * - once a station is chosen they show that station's battalion/division, and
 *   switching either picks the first station there, so what's on screen always
 *   matches the value.
 *
 * Renders its own labels; don't wrap it in a <Field>.
 */
export function StationPicker({
  id,
  label = 'Station',
  value,
  onChange,
  disabled = false,
  error,
  hint,
  className,
}: StationPickerProps) {
  const generated = useId()
  const stationId = id ?? `station-${generated}`
  const [draft, setDraft] = useState<Draft>(NO_DRAFT)

  const current = value !== null ? stationInfo(value) : null
  const division = current ? current.division : draft.division
  const battalion = current ? current.battalion : draft.battalion

  const battalionOptions =
    division !== null
      ? BATTALIONS.filter((b) => b.division === division)
      : BATTALIONS

  // With a battalion chosen the list is short; otherwise it's grouped by
  // battalion so the whole division (or department) is easy to scan.
  const stationOptions = battalion !== null ? [...stationsForBattalion(battalion)].sort(byNumber) : null

  function chooseDivision(raw: string) {
    const next = Number(raw)
    if (!Number.isInteger(next)) return
    const battalions = battalionsForDivision(next)
    if (current) {
      if (current.division === next) return
      const first = battalions.length ? stationsForBattalion(battalions[0])[0] : undefined
      if (first !== undefined) onChange(first)
      return
    }
    // One battalion (Airport): choose it for them.
    setDraft({ division: next, battalion: battalions.length === 1 ? battalions[0] : null })
  }

  function chooseBattalion(raw: string) {
    const next = Number(raw)
    if (!Number.isInteger(next)) return
    if (current) {
      if (current.battalion === next) return
      const first = stationsForBattalion(next)[0]
      if (first !== undefined) onChange(first)
      return
    }
    setDraft({ division: divisionForBattalion(next), battalion: next })
  }

  function chooseStation(raw: string) {
    const next = Number(raw)
    const info = Number.isInteger(next) ? stationInfo(next) : null
    if (!info) return
    setDraft({ division: info.division, battalion: info.battalion })
    onChange(info.station)
  }

  return (
    <Fieldset legend={label} className={className}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Division" id={`${stationId}-division`}>
          <Select
            value={division !== null ? String(division) : ''}
            onChange={(event) => chooseDivision(event.target.value)}
            disabled={disabled}
          >
            {division === null ? (
              <option value="" disabled>
                Choose division
              </option>
            ) : null}
            {DIVISIONS.map((d) => (
              <option key={d.id} value={d.id}>
                {divisionLabel(d.id)}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Battalion" id={`${stationId}-battalion`}>
          <Select
            value={battalion !== null ? String(battalion) : ''}
            onChange={(event) => chooseBattalion(event.target.value)}
            disabled={disabled}
          >
            {battalion === null ? (
              <option value="" disabled>
                Choose battalion
              </option>
            ) : null}
            {battalionOptions.map((b) => (
              <option key={b.id} value={b.id}>
                {battalionLabel(b.id)}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Station" id={stationId} error={error} hint={hint} className="sm:col-span-2">
          <Select
            value={current ? String(current.station) : ''}
            onChange={(event) => chooseStation(event.target.value)}
            disabled={disabled}
            invalid={Boolean(error)}
          >
            {current === null ? (
              <option value="" disabled>
                Choose station
              </option>
            ) : null}
            {stationOptions === null
              ? battalionOptions.map((b) => (
                  <optgroup key={b.id} label={`${battalionLabel(b.id)} · ${divisionLabel(b.division)}`}>
                    {[...b.stations].sort(byNumber).map((s) => (
                      <option key={s} value={s}>
                        {stationLabel(s)}
                      </option>
                    ))}
                  </optgroup>
                ))
              : stationOptions.map((s) => (
                  <option key={s} value={s}>
                    {stationLabel(s)}
                  </option>
                ))}
          </Select>
        </Field>
      </div>
    </Fieldset>
  )
}

export default StationPicker
