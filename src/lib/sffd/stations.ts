// SFFD fire-suppression organisation (ARCHITECTURE §5, verified against
// sf-fire.org). Mirrored by the seeded public.stations table — keep in sync.
// Picking a station always determines battalion and division.

export interface DivisionInfo {
  id: number
  label: string
  battalions: readonly number[]
}

export interface BattalionInfo {
  id: number
  division: number
  label: string
  stations: readonly number[]
}

export interface StationInfo {
  station: number
  battalion: number
  division: number
  label: string
}

/** Airport Division / Battalion ids and the station numbers used for SFO. */
export const AIRPORT_DIVISION = 4
export const AIRPORT_BATTALION = 99
const AIRPORT_STATION_BASE = 100 // 101–103 = Airport Station 1–3

const HIERARCHY: ReadonlyArray<{ division: number; battalions: ReadonlyArray<[number, number[]]> }> = [
  {
    division: 2,
    battalions: [
      [1, [2, 13, 28, 41]],
      [4, [3, 16, 38, 51]],
      [5, [5, 10, 12, 21]],
      [7, [14, 22, 31, 34]],
      [8, [18, 20, 23, 40]],
    ],
  },
  {
    division: 3,
    battalions: [
      [2, [1, 6, 29, 36]],
      [3, [4, 8, 35, 48]],
      [6, [7, 11, 24, 26, 32]],
      [9, [15, 19, 33, 39, 43]],
      [10, [9, 17, 25, 37, 42, 44]],
    ],
  },
  {
    division: AIRPORT_DIVISION,
    battalions: [[AIRPORT_BATTALION, [101, 102, 103]]],
  },
]

export function divisionLabel(division: number): string {
  return division === AIRPORT_DIVISION ? 'Airport Division' : `Division ${division}`
}

export function battalionLabel(battalion: number): string {
  return battalion === AIRPORT_BATTALION ? 'Airport Battalion' : `Battalion ${battalion}`
}

export function isAirportStation(station: number): boolean {
  return station > AIRPORT_STATION_BASE && station <= AIRPORT_STATION_BASE + 3
}

export function stationLabel(station: number): string {
  return isAirportStation(station) ? `Airport Station ${station - AIRPORT_STATION_BASE}` : `Station ${station}`
}

/** Divisions in display order (2, 3, Airport). */
export const DIVISIONS: readonly DivisionInfo[] = Object.freeze(
  HIERARCHY.map(({ division, battalions }) =>
    Object.freeze({ id: division, label: divisionLabel(division), battalions: Object.freeze(battalions.map(([b]) => b)) }),
  ),
)

/** Battalions in display order (grouped by division). */
export const BATTALIONS: readonly BattalionInfo[] = Object.freeze(
  HIERARCHY.flatMap(({ division, battalions }) =>
    battalions.map(([id, stations]) =>
      Object.freeze({ id, division, label: battalionLabel(id), stations: Object.freeze([...stations]) }),
    ),
  ),
)

/** Every station, ascending by number (Airport 101–103 last). */
export const STATIONS: readonly StationInfo[] = Object.freeze(
  BATTALIONS.flatMap((b) =>
    b.stations.map((station) =>
      Object.freeze({ station, battalion: b.id, division: b.division, label: stationLabel(station) }),
    ),
  ).sort((a, b) => a.station - b.station),
)

const STATION_BY_NUMBER = new Map(STATIONS.map((s) => [s.station, s]))
const BATTALION_BY_ID = new Map(BATTALIONS.map((b) => [b.id, b]))
const DIVISION_BY_ID = new Map(DIVISIONS.map((d) => [d.id, d]))

export const DIVISION_IDS: readonly number[] = Object.freeze(DIVISIONS.map((d) => d.id))
export const BATTALION_IDS: readonly number[] = Object.freeze(BATTALIONS.map((b) => b.id))
export const STATION_NUMBERS: readonly number[] = Object.freeze(STATIONS.map((s) => s.station))

export function isStation(value: unknown): value is number {
  return typeof value === 'number' && STATION_BY_NUMBER.has(value)
}

export function isBattalion(value: unknown): value is number {
  return typeof value === 'number' && BATTALION_BY_ID.has(value)
}

export function isDivision(value: unknown): value is number {
  return typeof value === 'number' && DIVISION_BY_ID.has(value)
}

/** Station → { station, battalion, division, label }, or null if unknown. */
export function stationInfo(station: number): StationInfo | null {
  return STATION_BY_NUMBER.get(station) ?? null
}

export function battalionInfo(battalion: number): BattalionInfo | null {
  return BATTALION_BY_ID.get(battalion) ?? null
}

/** Battalion ids in a division ([] if unknown). */
export function battalionsForDivision(division: number): number[] {
  return [...(DIVISION_BY_ID.get(division)?.battalions ?? [])]
}

/** Station numbers in a battalion ([] if unknown). */
export function stationsForBattalion(battalion: number): number[] {
  return [...(BATTALION_BY_ID.get(battalion)?.stations ?? [])]
}

/** Station numbers in a division ([] if unknown). */
export function stationsForDivision(division: number): number[] {
  return battalionsForDivision(division).flatMap(stationsForBattalion)
}

export function divisionForBattalion(battalion: number): number | null {
  return BATTALION_BY_ID.get(battalion)?.division ?? null
}

/** Human label with the chain of command, e.g. 'Station 19 · Battalion 9 · Division 3'. */
export function stationPathLabel(station: number): string {
  const info = stationInfo(station)
  if (!info) return `Station ${station}`
  return `${info.label} · ${battalionLabel(info.battalion)} · ${divisionLabel(info.division)}`
}
