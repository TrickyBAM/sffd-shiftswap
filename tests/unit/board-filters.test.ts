import { describe, expect, it } from 'vitest'
import {
  battalionOptions,
  boardQueryKey,
  defaultBoardFilters,
  describeFilters,
  describeLocation,
  effectiveRank,
  isAllLocations,
  parseDateParam,
  stationOptions,
  toBoardApiFilters,
  withAllLocations,
  withBattalion,
  withDivision,
  withStation,
  type BoardFilterState,
} from '@/app/(app)/board/_lib/filters'

const ME = '00000000-0000-4000-8000-000000000001'

// Station 19 is in Battalion 9, Division 3 (ARCHITECTURE §5).
const member = { id: ME, rank: 'Captain', station: 19, battalion: 9, division: 3 } as const

describe('defaultBoardFilters', () => {
  it('defaults to my battalion, my rank and only shifts I can take', () => {
    expect(defaultBoardFilters(member)).toEqual({
      division: 3,
      battalion: 9,
      station: null,
      rank: 'Captain',
      onlyEligible: true,
    })
  })

  it('derives the battalion from the station, not the stored battalion', () => {
    expect(defaultBoardFilters({ ...member, battalion: 1, division: 2 })).toMatchObject({ division: 3, battalion: 9 })
  })

  it('falls back to the stored battalion/division, then to all locations', () => {
    expect(defaultBoardFilters({ rank: 'Firefighter', station: null, battalion: 4, division: null })).toMatchObject({
      division: 2,
      battalion: 4,
    })
    expect(defaultBoardFilters({ rank: null, station: null, battalion: null, division: null })).toEqual({
      division: null,
      battalion: null,
      station: null,
      rank: null,
      onlyEligible: true,
    })
  })
})

describe('location cascade', () => {
  const base: BoardFilterState = defaultBoardFilters(member)

  it('picking a station fills in its battalion and division', () => {
    expect(withStation(withAllLocations(base), 2)).toMatchObject({ division: 2, battalion: 1, station: 2 })
    expect(withStation(base, 102)).toMatchObject({ division: 4, battalion: 99, station: 102 })
  })

  it('picking a battalion sets the division and drops a station outside it', () => {
    const atStation = withStation(base, 19)
    expect(withBattalion(atStation, 9)).toMatchObject({ division: 3, battalion: 9, station: 19 })
    expect(withBattalion(atStation, 1)).toMatchObject({ division: 2, battalion: 1, station: null })
    expect(withBattalion(atStation, null)).toMatchObject({ division: 3, battalion: null, station: null })
  })

  it('picking a division keeps a battalion only when it is inside it', () => {
    expect(withDivision(base, 3)).toMatchObject({ division: 3, battalion: 9 })
    expect(withDivision(base, 2)).toMatchObject({ division: 2, battalion: null, station: null })
    expect(withDivision(base, null)).toMatchObject({ division: null, battalion: null, station: null })
  })

  it('ignores unknown ids', () => {
    expect(withStation(base, 999)).toMatchObject({ station: null, battalion: 9 })
    expect(withBattalion(base, 42)).toMatchObject({ battalion: null })
    expect(withDivision(base, 7)).toMatchObject({ division: null })
  })

  it('"All locations" clears every level', () => {
    const all = withAllLocations(withStation(base, 19))
    expect(isAllLocations(all)).toBe(true)
    expect(describeLocation(all)).toBe('All locations')
  })

  it('offers only the choices inside the level above', () => {
    expect(battalionOptions(3).map((b) => b.id)).toEqual([2, 3, 6, 9, 10])
    expect(battalionOptions(null)).toHaveLength(11)
    expect(stationOptions(null, 9).map((s) => s.station)).toEqual([15, 19, 33, 39, 43])
    expect(stationOptions(4, null).map((s) => s.label)).toEqual(['Airport Station 1', 'Airport Station 2', 'Airport Station 3'])
  })
})

describe('describeFilters', () => {
  it('summarises location and rank', () => {
    const f = defaultBoardFilters(member)
    expect(describeFilters(f, 'Captain')).toBe('Battalion 9 · Captain')
    expect(describeFilters(withStation(f, 19), 'Captain')).toBe('Station 19 · Captain')
  })

  it('uses my rank while "only shifts I can take" is on, the chosen rank otherwise', () => {
    const f = { ...defaultBoardFilters(member), rank: 'Lieutenant' as const }
    expect(effectiveRank(f, 'Captain')).toBe('Captain')
    expect(effectiveRank({ ...f, onlyEligible: false }, 'Captain')).toBe('Lieutenant')
    expect(describeFilters({ ...withAllLocations(f), onlyEligible: false, rank: null }, 'Captain')).toBe(
      'All locations · All ranks',
    )
  })
})

describe('parseDateParam', () => {
  it('accepts only real YYYY-MM-DD dates', () => {
    expect(parseDateParam('2026-10-14')).toBe('2026-10-14')
    expect(parseDateParam('2026-02-30')).toBeNull()
    expect(parseDateParam('10/14/2026')).toBeNull()
    expect(parseDateParam(null)).toBeNull()
  })
})

describe('toBoardApiFilters', () => {
  it('"only shifts I can take" asks the database for my rank/limits and leaves out my working days', () => {
    const f = defaultBoardFilters(member)
    expect(toBoardApiFilters(f, member, { date: null, excludeDates: ['2026-10-01'] })).toEqual({
      division: 3,
      battalion: 9,
      station: null,
      rank: null,
      from: null,
      to: null,
      eligibleFor: { id: ME, rank: 'Captain', station: 19, battalion: 9, division: 3 },
      excludeDates: ['2026-10-01'],
    })
  })

  it('without it, filters by the chosen rank only', () => {
    const f = { ...defaultBoardFilters(member), onlyEligible: false, rank: 'Lieutenant' as const }
    expect(toBoardApiFilters(f, member, { date: '2026-10-14', excludeDates: ['2026-10-14'] })).toMatchObject({
      rank: 'Lieutenant',
      from: '2026-10-14',
      to: '2026-10-14',
      eligibleFor: null,
      excludeDates: null,
    })
  })
})

describe('boardQueryKey', () => {
  it('changes with anything that changes the query', () => {
    const f = defaultBoardFilters(member)
    const key = boardQueryKey(f, null)
    expect(boardQueryKey(f, '2026-10-14')).not.toBe(key)
    expect(boardQueryKey(withStation(f, 19), null)).not.toBe(key)
    expect(boardQueryKey({ ...f, onlyEligible: false }, null)).not.toBe(key)
  })

  it('ignores the rank picker while "only shifts I can take" is on', () => {
    const f = defaultBoardFilters(member)
    expect(boardQueryKey({ ...f, rank: 'Lieutenant' }, null)).toBe(boardQueryKey(f, null))
  })
})
