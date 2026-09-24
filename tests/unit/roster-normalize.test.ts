import { readFileSync } from 'node:fs'
import path from 'node:path'
import type { PGlite } from '@electric-sql/pglite'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { cleanName, nameKey, splitFullName } from '@/lib/roster/normalize'
import { extractSqlFunction, pgWithFunctions } from './helpers/sql-functions'

// Shared with the database tests: SQL public.name_key() must agree on every case.
const shared: { cases: Array<{ input: string; key: string }> } = JSON.parse(
  readFileSync(path.resolve(__dirname, '../fixtures/name-keys.json'), 'utf8'),
)

describe('nameKey', () => {
  it.each(shared.cases)('nameKey($input) = "$key"', ({ input, key }) => {
    expect(nameKey(input)).toBe(key)
  })

  it('handles null/undefined', () => {
    expect(nameKey(null)).toBe('')
    expect(nameKey(undefined)).toBe('')
  })

  it('output is always a–z only', () => {
    const samples = ['Ab¢d€f', 'x\u0000y', '🔥Fire🔥', 'Ⅻ', 'ǅ', 'Σίσυφος', 'Иван']
    for (const s of samples) expect(nameKey(s)).toMatch(/^[a-z]*$/)
  })
})

describe('cleanName', () => {
  it('trims and collapses whitespace', () => {
    expect(cleanName('  Mary   Ann \t Smith ')).toBe('Mary Ann Smith')
    expect(cleanName(null)).toBe('')
  })
})

describe('splitFullName', () => {
  it.each([
    ['John Smith', { first: 'John', middle: '', last: 'Smith' }],
    ['John Q. Smith', { first: 'John', middle: 'Q.', last: 'Smith' }],
    ['John Quincy Adams Smith', { first: 'John', middle: 'Quincy Adams', last: 'Smith' }],
    ['  john   smith  ', { first: 'john', middle: '', last: 'smith' }],
    ['Smith, John', { first: 'John', middle: '', last: 'Smith' }],
    ['Smith,John', { first: 'John', middle: '', last: 'Smith' }],
    ['Smith, John Q.', { first: 'John', middle: 'Q.', last: 'Smith' }],
    ['De La Cruz, Maria', { first: 'Maria', middle: '', last: 'De La Cruz' }],
    ["O'Brien-Smith, Mary Ann", { first: 'Mary', middle: 'Ann', last: "O'Brien-Smith" }],
    ['John Smith Jr.', { first: 'John', middle: '', last: 'Smith' }],
    ['John Smith III', { first: 'John', middle: '', last: 'Smith' }],
    ['Smith Jr., John', { first: 'John', middle: '', last: 'Smith' }],
    ['Smith, John, Jr.', { first: 'John', middle: '', last: 'Smith' }],
    ['Smith, Jr., John', { first: 'John', middle: '', last: 'Smith' }],
    ['John Jr', { first: 'John', middle: '', last: 'Jr' }],
    ['Cher', { first: 'Cher', middle: '', last: '' }],
    ['Smith,', { first: 'Smith', middle: '', last: '' }],
    [', John Smith', { first: 'John', middle: '', last: 'Smith' }],
  ])('%s', (input, expected) => {
    expect(splitFullName(input)).toEqual(expected)
  })

  it('returns null for blank input', () => {
    expect(splitFullName('')).toBeNull()
    expect(splitFullName('   ')).toBeNull()
    expect(splitFullName(null)).toBeNull()
    expect(splitFullName(',')).toBeNull()
  })
})

// SQL public.name_key must agree with nameKey() on every shared case.
const nameKeySql = extractSqlFunction('public.name_key')

describe('SQL public.name_key', () => {
  it('is defined in supabase/migrations', () => {
    expect(nameKeySql).not.toBeNull()
  })

  describe.skipIf(!nameKeySql)('parity with nameKey()', () => {
    let pg: PGlite
    beforeAll(async () => {
      pg = await pgWithFunctions([nameKeySql!])
    })
    afterAll(async () => {
      await pg?.close()
    })

    it('returns the same key for every shared case', async () => {
      const inputs = shared.cases.map((c) => c.input)
      const { rows } = await pg.query<{ input: string; key: string }>(
        `select input, public.name_key(input) as key from unnest($1::text[]) as u(input)`,
        [inputs],
      )
      expect(rows).toHaveLength(inputs.length)
      for (const { input, key } of rows) {
        expect(key, JSON.stringify(input)).toBe(nameKey(input))
      }
    })

    it('maps null to an empty string', async () => {
      const { rows } = await pg.query<{ key: string }>(`select public.name_key(null) as key`)
      expect(rows[0].key).toBe(nameKey(null))
    })
  })
})
