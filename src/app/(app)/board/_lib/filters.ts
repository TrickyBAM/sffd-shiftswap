// Board filter state (ARCHITECTURE §7.2 "Board"): the Division ▸ Battalion ▸
// Station cascade, rank, "Only shifts I can take", and how that state maps to
// the listBoardShifts() filters. Pure functions — no I/O, easy to test.

import type { BoardFilters, BoardViewer } from '@/lib/api'
import { isYmd, type Ymd } from '@/lib/sffd/dates'
import { isRank, type Rank } from '@/lib/sffd/ranks'
import {
  BATTALIONS,
  DIVISIONS,
  STATIONS,
  battalionInfo,
  battalionLabel,
  divisionForBattalion,
  divisionLabel,
  isBattalion,
  isDivision,
  isStation,
  stationInfo,
  stationLabel,
  type BattalionInfo,
  type DivisionInfo,
  type StationInfo,
} from '@/lib/sffd/stations'

export interface BoardFilterState {
  /** Location cascade; null = "All" at that level. */
  division: number | null
  battalion: number | null
  station: number | null
  /** Rank shown when "Only shifts I can take" is off (null = all ranks). */
  rank: Rank | null
  /**
   * "Only shifts I can take": my rank, within each post's limit, not on days I
   * work, and for a SwapMatch at least one return date I could give.
   */
  onlyEligible: boolean
}

/** The member looking at the board (a profile row fits). */
export interface BoardMember extends BoardViewer {
  tour: number | null
}

/** Default filters: my battalion, my rank, only shifts I can take. */
export function defaultBoardFilters(member: Pick<BoardMember, 'rank' | 'station' | 'battalion' | 'division'>): BoardFilterState {
  const fromStation = isStation(member.station) ? stationInfo(member.station) : null
  const battalion = fromStation?.battalion ?? (isBattalion(member.battalion) ? member.battalion : null)
  const division =
    battalion != null ? divisionForBattalion(battalion) : isDivision(member.division) ? member.division : null
  return {
    division,
    battalion,
    station: null,
    rank: isRank(member.rank) ? member.rank : null,
    onlyEligible: true,
  }
}

// ---------------------------------------------------------------------------
// Cascade: picking a level fills in the levels above it and clears the ones
// below that no longer fit.
// ---------------------------------------------------------------------------

export function withDivision(filters: BoardFilterState, division: number | null): BoardFilterState {
  const next = isDivision(division) ? division : null
  // "All divisions" clears everything below it; another division keeps a battalion only if it's inside.
  const battalion =
    next != null && filters.battalion != null && divisionForBattalion(filters.battalion) === next
      ? filters.battalion
      : null
  const station = battalion != null ? filters.station : null
  return { ...filters, division: next, battalion, station }
}

export function withBattalion(filters: BoardFilterState, battalion: number | null): BoardFilterState {
  if (!isBattalion(battalion)) return { ...filters, battalion: null, station: null }
  const stationFits = filters.station != null && stationInfo(filters.station)?.battalion === battalion
  return {
    ...filters,
    division: divisionForBattalion(battalion),
    battalion,
    station: stationFits ? filters.station : null,
  }
}

export function withStation(filters: BoardFilterState, station: number | null): BoardFilterState {
  const info = station != null && isStation(station) ? stationInfo(station) : null
  if (!info) return { ...filters, station: null }
  return { ...filters, division: info.division, battalion: info.battalion, station: info.station }
}

/** Clears the whole location cascade ("All battalions"). */
export function withAllLocations(filters: BoardFilterState): BoardFilterState {
  return { ...filters, division: null, battalion: null, station: null }
}

export function isAllLocations(filters: BoardFilterState): boolean {
  return filters.division == null && filters.battalion == null && filters.station == null
}

/** Division choices (always all of them). */
export function divisionOptions(): readonly DivisionInfo[] {
  return DIVISIONS
}

/** Battalion choices for the current division (all battalions when none). */
export function battalionOptions(division: number | null): readonly BattalionInfo[] {
  return division == null ? BATTALIONS : BATTALIONS.filter((b) => b.division === division)
}

/** Station choices for the current battalion, else division, else every station. */
export function stationOptions(division: number | null, battalion: number | null): readonly StationInfo[] {
  if (battalion != null) {
    const stations = battalionInfo(battalion)?.stations ?? []
    return STATIONS.filter((s) => stations.includes(s.station))
  }
  if (division != null) return STATIONS.filter((s) => s.division === division)
  return STATIONS
}

// ---------------------------------------------------------------------------
// Descriptions
// ---------------------------------------------------------------------------

/** "Station 19" / "Battalion 9" / "Division 3" / "All locations". */
export function describeLocation(filters: Pick<BoardFilterState, 'division' | 'battalion' | 'station'>): string {
  if (filters.station != null) return stationLabel(filters.station)
  if (filters.battalion != null) return battalionLabel(filters.battalion)
  if (filters.division != null) return divisionLabel(filters.division)
  return 'All locations'
}

/** Rank part of the summary: the member's rank when only-eligible is on. */
export function effectiveRank(filters: BoardFilterState, memberRank: string | null): string | null {
  if (filters.onlyEligible) return isRank(memberRank) ? memberRank : null
  return filters.rank
}

/** One-line summary for the filter button: "Battalion 9 · Captain". */
export function describeFilters(filters: BoardFilterState, memberRank: string | null): string {
  const rank = effectiveRank(filters, memberRank)
  return `${describeLocation(filters)} · ${rank ?? 'All ranks'}`
}

// ---------------------------------------------------------------------------
// URL + query mapping
// ---------------------------------------------------------------------------

/** The ?date= filter: a valid 'YYYY-MM-DD' or null. */
export function parseDateParam(value: string | null | undefined): Ymd | null {
  return isYmd(value) ? value : null
}

/**
 * ?scope=all: open the Board on every location (e.g. from the calendar's
 * "See N available", which counts shifts department-wide). Rank and "Only
 * shifts I can take" keep their defaults.
 */
export function isScopeAllParam(value: string | null | undefined): boolean {
  return value === 'all'
}

/** The filters the Board opens with: my defaults, or all locations for ?scope=all. */
export function initialBoardFilters(defaults: BoardFilterState, scopeAll: boolean): BoardFilterState {
  return scopeAll ? withAllLocations(defaults) : defaults
}

/** True when two filter states differ in the location cascade. */
export function locationChanged(a: BoardFilterState, b: BoardFilterState): boolean {
  return a.division !== b.division || a.battalion !== b.battalion || a.station !== b.station
}

/** Stable identity of a board query (filters + ?date), for caching and races. */
export function boardQueryKey(filters: BoardFilterState, date: Ymd | null): string {
  return JSON.stringify([
    filters.division,
    filters.battalion,
    filters.station,
    filters.onlyEligible ? null : filters.rank,
    filters.onlyEligible,
    date,
  ])
}

/**
 * The listBoardShifts() filters for this state. With "Only shifts I can take"
 * on, the database applies rank/limit/own-post rules and `excludeDates`
 * removes the days I work or already cover (SwapMatch return dates are
 * checked on the client, see eligibility.ts).
 */
export function toBoardApiFilters(
  filters: BoardFilterState,
  member: BoardViewer,
  options: { date?: Ymd | null; excludeDates?: readonly Ymd[] | null } = {},
): BoardFilters {
  const date = options.date ?? null
  return {
    division: filters.division,
    battalion: filters.battalion,
    station: filters.station,
    rank: filters.onlyEligible ? null : filters.rank,
    from: date,
    to: date,
    eligibleFor: filters.onlyEligible
      ? { id: member.id, rank: member.rank, station: member.station, battalion: member.battalion, division: member.division }
      : null,
    excludeDates: filters.onlyEligible ? (options.excludeDates ?? []) : null,
  }
}
