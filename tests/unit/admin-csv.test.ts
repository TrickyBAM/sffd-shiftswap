import { describe, expect, it } from 'vitest'
import {
  ROSTER_TEMPLATE_HEADERS,
  csvCell,
  rosterTemplateCsv,
  toCsv,
} from '@/app/(app)/admin/_lib/csv'
import { parseCsv, parseRosterCsv } from '@/lib/roster/csv'

describe('csvCell', () => {
  it('leaves plain text alone and renders empty values as blank', () => {
    expect(csvCell('Mike Lee')).toBe('Mike Lee')
    expect(csvCell(null)).toBe('')
    expect(csvCell(undefined)).toBe('')
    expect(csvCell(24)).toBe('24')
    expect(csvCell(Number.NaN)).toBe('')
    expect(csvCell(true)).toBe('yes')
  })

  it('quotes commas, quotes, line breaks and edge spaces', () => {
    expect(csvCell('Lee, Mike')).toBe('"Lee, Mike"')
    expect(csvCell('He said "hi"')).toBe('"He said ""hi"""')
    expect(csvCell('line1\nline2')).toBe('"line1\nline2"')
    expect(csvCell('a\r\nb')).toBe('"a\r\nb"')
    expect(csvCell(' padded ')).toBe('" padded "')
  })

  it('defuses spreadsheet formulas', () => {
    expect(csvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`)
    expect(csvCell('+1 415')).toBe("'+1 415")
    expect(csvCell('-5')).toBe("'-5")
    expect(csvCell('@home')).toBe("'@home")
  })
})

describe('toCsv', () => {
  it('joins rows with CRLF and ends with CRLF', () => {
    expect(toCsv([['a', 'b'], [1, 'x,y']])).toBe('a,b\r\n1,"x,y"\r\n')
    expect(toCsv([])).toBe('')
  })

  it('round-trips through the roster CSV parser', () => {
    const text = toCsv([
      ['first', 'note'],
      ['Ana', 'He said "go", then left\nearly'],
    ])
    expect(parseCsv(text).map((r) => r.cells)).toEqual([
      ['first', 'note'],
      ['Ana', 'He said "go", then left\nearly'],
    ])
  })
})

describe('roster template', () => {
  it('has the documented headers in order', () => {
    const [header] = rosterTemplateCsv().split('\r\n')
    expect(header).toBe('first_name,last_name,employee_id,rank,station,tour,email,phone')
    expect([...ROSTER_TEMPLATE_HEADERS]).toEqual([
      'first_name',
      'last_name',
      'employee_id',
      'rank',
      'station',
      'tour',
      'email',
      'phone',
    ])
  })

  it('has an example row the importer accepts', () => {
    const result = parseRosterCsv(rosterTemplateCsv())
    expect(result.errors).toEqual([])
    expect(result.rows).toEqual([
      {
        first_name: 'Jane',
        last_name: 'Doe',
        employee_id: '12345',
        rank: 'Firefighter',
        station: 19,
        tour: 7,
        email: 'jane.doe@example.com',
        phone: '(415) 555-0123',
      },
    ])
  })
})
