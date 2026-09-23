import { describe, expect, it } from 'vitest'
import { isRank, parseRank, rankOrder, RANKS } from '@/lib/sffd/ranks'
import { isShiftType, SHIFT_TYPE_LIST, SHIFT_TYPE_VALUES, SHIFT_TYPES, shiftHours } from '@/lib/sffd/shift-types'
import {
  BATTALIONS,
  battalionInfo,
  battalionLabel,
  battalionsForDivision,
  DIVISIONS,
  divisionForBattalion,
  divisionLabel,
  isBattalion,
  isDivision,
  isStation,
  STATION_NUMBERS,
  stationInfo,
  stationLabel,
  stationPathLabel,
  STATIONS,
  stationsForBattalion,
  stationsForDivision,
} from '@/lib/sffd/stations'

describe('stations (ARCHITECTURE §5)', () => {
  it('has exactly the documented hierarchy', () => {
    const tree = Object.fromEntries(
      DIVISIONS.map((d) => [d.id, Object.fromEntries(d.battalions.map((b) => [b, stationsForBattalion(b)]))]),
    )
    expect(tree).toEqual({
      2: { 1: [2, 13, 28, 41], 4: [3, 16, 38, 51], 5: [5, 10, 12, 21], 7: [14, 22, 31, 34], 8: [18, 20, 23, 40] },
      3: { 2: [1, 6, 29, 36], 3: [4, 8, 35, 48], 6: [7, 11, 24, 26, 32], 9: [15, 19, 33, 39, 43], 10: [9, 17, 25, 37, 42, 44] },
      4: { 99: [101, 102, 103] },
    })
  })

  it('lists every station once, sorted, with derived battalion/division', () => {
    expect(STATIONS).toHaveLength(47)
    expect(new Set(STATION_NUMBERS).size).toBe(47)
    expect([...STATION_NUMBERS]).toEqual([...STATION_NUMBERS].sort((a, b) => a - b))
    for (const s of STATIONS) {
      expect(stationsForBattalion(s.battalion)).toContain(s.station)
      expect(divisionForBattalion(s.battalion)).toBe(s.division)
    }
    expect(BATTALIONS.map((b) => b.id).sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 99])
  })

  it('stationInfo derives battalion, division and label', () => {
    expect(stationInfo(19)).toEqual({ station: 19, battalion: 9, division: 3, label: 'Station 19' })
    expect(stationInfo(2)).toEqual({ station: 2, battalion: 1, division: 2, label: 'Station 2' })
    expect(stationInfo(102)).toEqual({ station: 102, battalion: 99, division: 4, label: 'Airport Station 2' })
    expect(stationInfo(27)).toBeNull() // not a station
    expect(stationInfo(0)).toBeNull()
  })

  it('labels', () => {
    expect(divisionLabel(2)).toBe('Division 2')
    expect(divisionLabel(4)).toBe('Airport Division')
    expect(battalionLabel(9)).toBe('Battalion 9')
    expect(battalionLabel(99)).toBe('Airport Battalion')
    expect(stationLabel(19)).toBe('Station 19')
    expect(stationLabel(101)).toBe('Airport Station 1')
    expect(stationLabel(103)).toBe('Airport Station 3')
    expect(stationPathLabel(19)).toBe('Station 19 · Battalion 9 · Division 3')
    expect(stationPathLabel(103)).toBe('Airport Station 3 · Airport Battalion · Airport Division')
    expect(DIVISIONS.map((d) => d.label)).toEqual(['Division 2', 'Division 3', 'Airport Division'])
    expect(battalionInfo(99)?.label).toBe('Airport Battalion')
  })

  it('cascade helpers', () => {
    expect(battalionsForDivision(2)).toEqual([1, 4, 5, 7, 8])
    expect(battalionsForDivision(3)).toEqual([2, 3, 6, 9, 10])
    expect(battalionsForDivision(4)).toEqual([99])
    expect(battalionsForDivision(1)).toEqual([])
    expect(stationsForBattalion(12)).toEqual([])
    expect(stationsForDivision(4)).toEqual([101, 102, 103])
    expect(stationsForDivision(2)).toHaveLength(20)
    expect(stationsForDivision(3)).toHaveLength(24)
    // Returned arrays are copies — mutating them can't corrupt the data.
    stationsForBattalion(1).push(999)
    expect(stationsForBattalion(1)).toEqual([2, 13, 28, 41])
  })

  it('type guards', () => {
    expect(isStation(19)).toBe(true)
    expect(isStation(101)).toBe(true)
    expect(isStation(27)).toBe(false)
    expect(isStation('19')).toBe(false)
    expect(isBattalion(99)).toBe(true)
    expect(isBattalion(11)).toBe(false)
    expect(isDivision(3)).toBe(true)
    expect(isDivision(1)).toBe(false)
  })
})

describe('ranks', () => {
  it('are ordered as documented', () => {
    expect([...RANKS]).toEqual(['Firefighter', 'Paramedic', 'Lieutenant', 'Captain', 'Battalion Chief', 'Division Chief'])
    expect(rankOrder('Captain')).toBe(3)
    expect(rankOrder('Chief')).toBe(-1)
  })

  it('isRank is exact', () => {
    expect(isRank('Captain')).toBe(true)
    expect(isRank('captain')).toBe(false)
    expect(isRank('EMT')).toBe(false)
    expect(isRank(null)).toBe(false)
  })

  it('parseRank maps names and common abbreviations', () => {
    const cases: Record<string, string | null> = {
      Firefighter: 'Firefighter',
      FF: 'Firefighter',
      'ff ': 'Firefighter',
      PM: 'Paramedic',
      'FF-PM': 'Paramedic',
      'FF/PM': 'Paramedic',
      Medic: 'Paramedic',
      paramedic: 'Paramedic',
      Lt: 'Lieutenant',
      'LT.': 'Lieutenant',
      lieutenant: 'Lieutenant',
      Capt: 'Captain',
      CPT: 'Captain',
      'Capt.': 'Captain',
      BC: 'Battalion Chief',
      'B/C': 'Battalion Chief',
      'battalion chief': 'Battalion Chief',
      DC: 'Division Chief',
      'Division Chief': 'Division Chief',
      EMT: null,
      Chief: null,
      '': null,
    }
    for (const [input, expected] of Object.entries(cases)) expect(parseRank(input), input).toBe(expected)
    expect(parseRank(null)).toBeNull()
    expect(parseRank(undefined)).toBeNull()
  })
})

describe('shift types', () => {
  it('24-Hour and PM', () => {
    expect([...SHIFT_TYPE_VALUES]).toEqual(['24-Hour', 'PM'])
    expect(SHIFT_TYPES['24-Hour']).toEqual({ label: '24-Hour', hours: 24, startTime: '08:00', description: '0800–0800' })
    expect(SHIFT_TYPES.PM).toEqual({ label: 'PM', hours: 16, startTime: '16:00', description: '1600–0800' })
    expect(SHIFT_TYPE_LIST.map((t) => t.label)).toEqual(['24-Hour', 'PM'])
    expect(shiftHours('PM')).toBe(16)
    expect(isShiftType('PM')).toBe(true)
    expect(isShiftType('12-Hour Day')).toBe(false)
    expect(Object.isFrozen(SHIFT_TYPES)).toBe(true)
  })
})
