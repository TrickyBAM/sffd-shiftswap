import { describe, expect, it } from 'vitest'
import { headerField, MAX_ROSTER_ROWS, parseCsv, parseRosterCsv, parseStation, parseTour } from '@/lib/roster/csv'

describe('parseCsv', () => {
  it('handles quotes, escaped quotes, embedded commas and newlines', () => {
    const text = 'a,b,c\n"x, y","he said ""hi""","line1\nline2"\n1,,3\n'
    expect(parseCsv(text)).toEqual([
      { line: 1, cells: ['a', 'b', 'c'] },
      { line: 2, cells: ['x, y', 'he said "hi"', 'line1\nline2'] },
      { line: 4, cells: ['1', '', '3'] },
    ])
  })

  it('handles CRLF, lone CR, a BOM and a missing trailing newline', () => {
    expect(parseCsv('﻿a,b\r\n1,2\r3,4')).toEqual([
      { line: 1, cells: ['a', 'b'] },
      { line: 2, cells: ['1', '2'] },
      { line: 3, cells: ['3', '4'] },
    ])
    expect(parseCsv('"multi\r\nline",x\r\nnext,y\r\n')).toEqual([
      { line: 1, cells: ['multi\r\nline', 'x'] },
      { line: 3, cells: ['next', 'y'] },
    ])
  })

  it('detects tab and semicolon delimiters from the header', () => {
    expect(parseCsv('First\tLast\nJohn\tSmith, Jr')[1].cells).toEqual(['John', 'Smith, Jr'])
    expect(parseCsv('First;Last\nJohn;Smith')[1].cells).toEqual(['John', 'Smith'])
    // A comma in the header wins.
    expect(parseCsv('First,Last\nJohn;X,Smith')[1].cells).toEqual(['John;X', 'Smith'])
  })

  it('keeps an unterminated quoted field instead of dropping it', () => {
    expect(parseCsv('a,"b\nc')).toEqual([{ line: 1, cells: ['a', 'b\nc'] }])
  })
})

describe('headerField', () => {
  it.each([
    ['First', 'first'],
    ['First Name', 'first'],
    ['firstname', 'first'],
    ['FIRST_NAME', 'first'],
    ['Last', 'last'],
    ['Last Name', 'last'],
    ['Surname', 'last'],
    ['Name', 'name'],
    ['Full Name', 'name'],
    ['Employee ID', 'employee_id'],
    ['Emp ID', 'employee_id'],
    ['ID', 'employee_id'],
    ['Emp #', 'employee_id'],
    ['Rank', 'rank'],
    ['Station', 'station'],
    ['Stn', 'station'],
    ['Tour', 'tour'],
    ['E-mail', 'email'],
    ['Email Address', 'email'],
    ['Phone', 'phone'],
    ['Cell Phone', 'phone'],
    ['Favorite Color', null],
  ])('%s → %s', (header, field) => {
    expect(headerField(header)).toBe(field)
  })
})

describe('parseStation / parseTour', () => {
  it('parses station spellings', () => {
    expect(parseStation('19')).toBe(19)
    expect(parseStation(' Station 19 ')).toBe(19)
    expect(parseStation('Stn. 19')).toBe(19)
    expect(parseStation('S19')).toBe(19)
    expect(parseStation('#19')).toBe(19)
    expect(parseStation('19.0')).toBe(19)
    expect(parseStation('101')).toBe(101)
    expect(parseStation('Airport 1')).toBe(101)
    expect(parseStation('Airport Station 2')).toBe(102)
    expect(parseStation('AP3')).toBe(103)
    expect(parseStation('27')).toBeNull() // no Station 27
    expect(parseStation('Airport 4')).toBeNull()
    expect(parseStation('Nineteen')).toBeNull()
    expect(parseStation('')).toBeNull()
  })

  it('parses tours; blank/relief means no tour', () => {
    expect(parseTour('7')).toBe(7)
    expect(parseTour('07')).toBe(7)
    expect(parseTour('Tour 31')).toBe(31)
    expect(parseTour('T5')).toBe(5)
    expect(parseTour('')).toBeUndefined()
    expect(parseTour('N/A')).toBeUndefined()
    expect(parseTour('Relief')).toBeUndefined()
    expect(parseTour('none')).toBeUndefined()
    expect(parseTour('0')).toBeNull()
    expect(parseTour('32')).toBeNull()
    expect(parseTour('abc')).toBeNull()
  })
})

describe('parseRosterCsv', () => {
  it('parses a typical export with split names', () => {
    const csv = [
      'First Name,Last Name,Employee ID,Rank,Station,Tour,Email,Phone',
      'John,Smith,12345,FF,19,7,John.Smith@Example.com,(415) 555-0100',
      'María,Núñez,,Capt,Airport 2,,,',
      '"Mary Ann","O\'Brien-Smith",A-77,FF-PM,Stn 2,Tour 31,,415-555-0199',
    ].join('\r\n')
    expect(parseRosterCsv(csv)).toEqual({
      rows: [
        {
          first_name: 'John',
          last_name: 'Smith',
          employee_id: '12345',
          rank: 'Firefighter',
          station: 19,
          tour: 7,
          email: 'john.smith@example.com',
          phone: '(415) 555-0100',
        },
        { first_name: 'María', last_name: 'Núñez', rank: 'Captain', station: 102 },
        {
          first_name: 'Mary Ann',
          last_name: "O'Brien-Smith",
          employee_id: 'A-77',
          rank: 'Paramedic',
          station: 2,
          tour: 31,
          phone: '415-555-0199',
        },
      ],
      errors: [],
    })
  })

  it('accepts a single name column in either order', () => {
    const csv = '﻿Name,Rank,Station\n"Smith, John",Lt,19\nJane Q. Doe,BC,1\n'
    expect(parseRosterCsv(csv).rows).toEqual([
      { first_name: 'John', last_name: 'Smith', rank: 'Lieutenant', station: 19 },
      { first_name: 'Jane', last_name: 'Doe', rank: 'Battalion Chief', station: 1 },
    ])
  })

  it('falls back to the name column when split columns are blank', () => {
    const csv = 'First,Last,Full Name\n,,"Doe, Jane"\nJohn,Smith,ignored\n'
    expect(parseRosterCsv(csv).rows).toEqual([
      { first_name: 'Jane', last_name: 'Doe' },
      { first_name: 'John', last_name: 'Smith' },
    ])
  })

  it('accepts tab-separated text pasted from a spreadsheet', () => {
    const tsv = 'First\tLast\tRank\tStation\tTour\nJohn\tSmith\tFirefighter\t19\t7\n'
    expect(parseRosterCsv(tsv)).toEqual({
      rows: [{ first_name: 'John', last_name: 'Smith', rank: 'Firefighter', station: 19, tour: 7 }],
      errors: [],
    })
  })

  it('reports row errors with line numbers and keeps the good rows', () => {
    const csv = [
      'First,Last,Rank,Station,Tour,Email',
      'John,Smith,FF,19,7,',
      ',Lonely,FF,19,7,', // missing first name
      'Bad,Rank,Chief,19,7,',
      'Bad,Station,FF,27,7,',
      'Bad,Tour,FF,19,40,',
      'Bad,Email,FF,19,7,not-an-email',
      '"Multi',
      'Line",Person,FF,19,7,',
      'Two,Problems,EMT,99,7,',
      '',
      'John,Smith,FF,19,7,', // duplicate of line 2
      '1234,5678,FF,19,7,',
    ].join('\n')
    const result = parseRosterCsv(csv)
    expect(result.rows.map((r) => `${r.first_name} ${r.last_name}`)).toEqual(['John Smith', 'Multi Line Person'])
    expect(result.errors).toEqual([
      { line: 3, message: 'Missing first or last name.' },
      { line: 4, message: 'Unknown rank "Chief".' },
      { line: 5, message: '"27" is not an SFFD station.' },
      { line: 6, message: 'Tour "40" must be 1–31 (or blank for no tour).' },
      { line: 7, message: '"not-an-email" is not a valid email.' },
      { line: 10, message: 'Unknown rank "EMT"; "99" is not an SFFD station.' },
      { line: 12, message: 'Duplicate of line 2 (John Smith).' },
      { line: 13, message: 'Name "1234 5678" has no letters.' },
    ])
  })

  it('treats the same name with different employee IDs as different people', () => {
    const csv = 'First,Last,ID\nJohn,Smith,1\nJohn,Smith,2\nJOHN,SMITH,1\n'
    const result = parseRosterCsv(csv)
    expect(result.rows).toHaveLength(2)
    expect(result.errors).toEqual([{ line: 4, message: 'Duplicate of line 2 (JOHN SMITH).' }])
  })

  it('rejects files without usable headers', () => {
    expect(parseRosterCsv('')).toEqual({ rows: [], errors: [{ line: 1, message: 'The file is empty.' }] })
    expect(parseRosterCsv('\n\n  \n').errors[0].message).toBe('The file is empty.')
    const noHeader = parseRosterCsv('John,Smith,19\nJane,Doe,1\n')
    expect(noHeader.rows).toEqual([])
    expect(noHeader.errors).toHaveLength(1)
    expect(noHeader.errors[0]).toMatchObject({ line: 1 })
    expect(noHeader.errors[0].message).toMatch(/Could not find name columns/)
    // Only a first-name column is not enough.
    expect(parseRosterCsv('First,Rank\nJohn,FF').errors[0].message).toMatch(/Could not find name columns/)
  })

  it('skips blank rows and rows of empty cells', () => {
    const csv = 'First,Last\n\n,\nJohn,Smith\n , \n'
    expect(parseRosterCsv(csv)).toEqual({ rows: [{ first_name: 'John', last_name: 'Smith' }], errors: [] })
  })

  it('ignores unknown columns and uses the first of duplicate headers', () => {
    const csv = 'Last,First,Notes,Station,Stn\nSmith,John,likes dogs,19,20\n'
    expect(parseRosterCsv(csv).rows).toEqual([{ first_name: 'John', last_name: 'Smith', station: 19 }])
  })

  it('limits the number of rows', () => {
    const lines = ['First,Last']
    for (let i = 0; i <= MAX_ROSTER_ROWS; i++) lines.push(`A${i},B`)
    const result = parseRosterCsv(lines.join('\n'))
    expect(result.rows).toEqual([])
    expect(result.errors[0].message).toMatch(/Too many rows/)
  })
})
