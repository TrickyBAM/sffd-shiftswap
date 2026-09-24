import { describe, expect, it } from 'vitest'
import { buildRosterPreview, importErrorsWithLines, rosterRowName } from '@/app/(app)/admin/roster/_lib/preview'
import { compareRosterToMember, summarizeMatches } from '@/app/(app)/admin/_lib/roster-compare'

describe('buildRosterPreview', () => {
  it('is empty for blank input', () => {
    expect(buildRosterPreview('  \n ')).toEqual({ fatal: null, lines: [], rows: [], rowLines: [], errorCount: 0 })
  })

  it('reports a file without name columns as a whole-file problem', () => {
    const preview = buildRosterPreview('foo,bar\n1,2\n')
    expect(preview.fatal).toMatch(/name columns/i)
    expect(preview.rows).toEqual([])
    expect(preview.lines).toEqual([])
  })

  it('lists good and bad lines in file order with their line numbers', () => {
    const text = [
      'First Name,Last Name,Rank,Station,Tour',
      'Mike,Lee,Firefighter,19,7',
      ',NoFirst,Firefighter,19,7',
      '',
      'Ana,Cruz,Captain,Station 3,T12',
      'Bob,Smith,Chef,19,7',
      'Mike,Lee,Firefighter,19,7',
    ].join('\n')
    const preview = buildRosterPreview(text)
    expect(preview.fatal).toBeNull()
    expect(preview.rows.map(rosterRowName)).toEqual(['Mike Lee', 'Ana Cruz'])
    expect(preview.rowLines).toEqual([2, 5])
    expect(preview.errorCount).toBe(3)
    expect(preview.lines.map((l) => [l.line, l.row ? rosterRowName(l.row) : null, l.error !== null])).toEqual([
      [2, 'Mike Lee', false],
      [3, null, true],
      [5, 'Ana Cruz', false],
      [6, null, true],
      [7, null, true],
    ])
    expect(preview.lines.find((l) => l.line === 7)?.error).toMatch(/duplicate of line 2/i)
    expect(preview.rows[1]).toMatchObject({ rank: 'Captain', station: 3, tour: 12 })
  })

  it('maps server row errors back to file lines', () => {
    const preview = buildRosterPreview('first,last\nA,One\nbad\nB,Two\n')
    expect(preview.rowLines).toEqual([2, 4])
    expect(
      importErrorsWithLines(
        [
          { row: 2, message: 'Unknown station.' },
          { row: 9, message: 'Out of range.' },
        ],
        preview.rowLines,
      ),
    ).toEqual([
      { line: 4, message: 'Unknown station.' },
      { line: null, message: 'Out of range.' },
    ])
  })
})

describe('compareRosterToMember', () => {
  const member = {
    employee_id: ' 123 ',
    rank: 'Firefighter' as const,
    station: 19,
    tour: 7,
    email: 'Mike@Example.com',
  }

  it('checks every attribute the roster entry has', () => {
    const items = compareRosterToMember(
      { employee_id: '123', rank: 'Firefighter', station: 19, tour: 8, email: 'mike@example.com' },
      member,
    )
    expect(items.map((i) => [i.field, i.status])).toEqual([
      ['employee_id', 'match'],
      ['rank', 'match'],
      ['station', 'match'],
      ['tour', 'differs'],
      ['email', 'match'],
    ])
    expect(summarizeMatches(items)).toEqual({ matches: 4, differs: 1 })
  })

  it('skips attributes the roster lacks and treats a blank employee ID as different', () => {
    const items = compareRosterToMember(
      { employee_id: '555', rank: null, station: null, tour: null, email: null },
      { ...member, employee_id: null },
    )
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ field: 'employee_id', status: 'differs', member: 'not given' })
  })
})
