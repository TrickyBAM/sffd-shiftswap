import { describe, expect, it } from 'vitest'
import { disambiguatingDay, findTour, matchTours, tourDaysInRange, tourWorks, TOURS } from '@/lib/sffd/tours'
import { addDays } from '@/lib/sffd/dates'

const TODAY = '2026-09-23'
const FROM = '2026-08-01'
const TO = '2026-09-22'

/** Simulates a member answering "Did you work <day>?" truthfully until one tour is left. */
function resolve(tour: number, tapped: string[]): { result: ReturnType<typeof findTour>; questions: number } {
  const worked = [...tapped]
  const notWorked: string[] = []
  let result = findTour(worked, notWorked)
  let questions = 0
  while (result.kind === 'ambiguous' && questions < 10) {
    const day = disambiguatingDay(result.candidates, TODAY, [...worked, ...notWorked])
    if (!day) break
    if (tourWorks(tour, day)) worked.push(day)
    else notWorked.push(day)
    questions++
    result = findTour(worked, notWorked)
  }
  return { result, questions }
}

describe('findTour', () => {
  it('returns empty with no days', () => {
    expect(findTour([])).toEqual({ kind: 'empty' })
  })

  it('one day narrows to the 9 tours on duty that day', () => {
    expect(findTour(['2026-09-23'])).toEqual({
      kind: 'ambiguous',
      candidates: [2, 7, 10, 13, 17, 20, 23, 27, 30],
      days: 1,
    })
  })

  it('three consecutive shifts leave at most three candidates, always including the right tour', () => {
    for (const tour of TOURS) {
      const result = findTour(tourDaysInRange(tour, FROM, TO).slice(2, 5))
      if (result.kind === 'exact') expect(result.tour).toBe(tour)
      else {
        expect(result.kind).toBe('ambiguous')
        if (result.kind === 'ambiguous') {
          expect(result.candidates).toContain(tour)
          expect(result.candidates.length).toBeLessThanOrEqual(3)
        }
      }
    }
  })

  it('a full month of shifts pins every tour', () => {
    for (const tour of TOURS) {
      expect(findTour(tourDaysInRange(tour, '2026-09-01', '2026-09-30'))).toMatchObject({ kind: 'exact', tour })
    }
  })

  it('"did you work this day?" questions resolve every tour from any three shifts in two questions or fewer', () => {
    for (const tour of TOURS) {
      const shifts = tourDaysInRange(tour, FROM, TO)
      for (let start = 0; start + 3 <= shifts.length; start++) {
        const { result, questions } = resolve(tour, shifts.slice(start, start + 3))
        expect(result).toMatchObject({ kind: 'exact', tour })
        expect(questions).toBeLessThanOrEqual(2)
      }
    }
  })

  it('one tapped shift plus questions also resolves', () => {
    for (const tour of TOURS) {
      const { result } = resolve(tour, [tourDaysInRange(tour, FROM, TO)[4]])
      expect(result).toMatchObject({ kind: 'exact', tour })
    }
  })

  it('ignores duplicate taps', () => {
    const days = tourDaysInRange(12, '2026-09-01', '2026-09-30')
    expect(findTour([...days, ...days])).toMatchObject({ kind: 'exact', tour: 12, days: days.length })
  })

  it('tolerates one stray day (e.g. a trade) once three or more days are known', () => {
    const tour = 19
    const own = tourDaysInRange(tour, '2026-09-01', '2026-09-30')
    let stray = addDays(own[0], 1)
    while (tourWorks(tour, stray)) stray = addDays(stray, 1)
    expect(findTour([...own, stray])).toEqual({ kind: 'closest', tour, matched: own.length, days: own.length + 1 })
  })

  it('reports none when the days follow no numbered tour', () => {
    // Seven days in a row cannot all be one tour's regular shifts.
    const week = Array.from({ length: 7 }, (_, i) => addDays('2026-09-01', i))
    expect(findTour(week).kind).toBe('none')
  })

  it('counts a confirmed day off against tours that work it', () => {
    const [best] = matchTours(['2026-09-23'], ['2026-09-26'])
    // Tour 2 works 9/23 and also 9/26, so it cannot be the best perfect match.
    expect(tourWorks(2, '2026-09-26')).toBe(true)
    expect(best.missed).toBe(0)
    expect(best.tour).not.toBe(2)
  })
})

describe('disambiguatingDay', () => {
  it('picks a recent past day that splits the candidates', () => {
    const day = disambiguatingDay([1, 11], TODAY)
    expect(day).not.toBeNull()
    expect(day! < TODAY).toBe(true)
    expect(tourWorks(1, day!)).not.toBe(tourWorks(11, day!))
  })

  it('returns null for a single candidate', () => {
    expect(disambiguatingDay([7], TODAY)).toBeNull()
  })
})
