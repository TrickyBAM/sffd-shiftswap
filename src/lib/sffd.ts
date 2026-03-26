import { SFDDivision } from './types'

export const SFFD_HIERARCHY: SFDDivision[] = [
  {
    id: 2,
    name: 'Division 2',
    battalions: [
      { id: 1, stations: [2, 13, 28, 41] },
      { id: 4, stations: [3, 16, 38, 51] },
      { id: 5, stations: [5, 10, 12, 21] },
      { id: 7, stations: [14, 22, 31, 34] },
      { id: 8, stations: [18, 20, 23, 40] },
    ],
  },
  {
    id: 3,
    name: 'Division 3',
    battalions: [
      { id: 2, stations: [1, 6, 29, 36] },
      { id: 3, stations: [4, 8, 35, 48] },
      { id: 6, stations: [7, 11, 24, 26, 32] },
      { id: 9, stations: [15, 19, 33, 39, 43] },
      { id: 10, stations: [9, 17, 25, 37, 42, 44] },
    ],
  },
  {
    id: 4,
    name: 'Airport Division',
    battalions: [
      { id: 99, stations: [101, 102, 103] }, // Airport Stations 1, 2, 3
    ],
  },
]

export const AIRPORT_STATION_LABELS: Record<number, string> = {
  101: 'Airport Station 1',
  102: 'Airport Station 2',
  103: 'Airport Station 3',
}

export function getStationLabel(station: number): string {
  if (AIRPORT_STATION_LABELS[station]) return AIRPORT_STATION_LABELS[station]
  return `Station ${station}`
}

export function getDivisionForBattalion(battalion: number): number | null {
  for (const div of SFFD_HIERARCHY) {
    if (div.battalions.some(b => b.id === battalion)) {
      return div.id
    }
  }
  return null
}

export function getBattalionsForDivision(divisionId: number): number[] {
  const div = SFFD_HIERARCHY.find(d => d.id === divisionId)
  if (!div) return []
  return div.battalions.map(b => b.id)
}

export function getStationsForBattalion(battalion: number): number[] {
  for (const div of SFFD_HIERARCHY) {
    const bat = div.battalions.find(b => b.id === battalion)
    if (bat) return bat.stations
  }
  return []
}

export function getBattalionLabel(battalion: number): string {
  if (battalion === 99) return 'Airport Battalion'
  return `Battalion ${battalion}`
}

export const RANKS = ['Firefighter', 'Paramedic', 'Lieutenant', 'Captain', 'Battalion Chief'] as const
export const POSITION_TYPES = ['Firefighter', 'Paramedic', 'Officer'] as const
export const SHIFT_TYPES = ['24-Hour', '12-Hour Day', '12-Hour Night'] as const
export const DIVISIONS = [2, 3, 4] as const

export function getDivisionName(divisionId: number): string {
  const div = SFFD_HIERARCHY.find(d => d.id === divisionId)
  return div?.name ?? `Division ${divisionId}`
}
