// Roster CSV import (admin → admin_import_roster, ARCHITECTURE §6.3).
//
// Tolerant of the things real exports contain: a UTF-8 BOM, CRLF/LF/CR line
// endings, quoted fields with embedded commas, quotes ("") and newlines,
// comma/tab/semicolon delimiters (pasting from a spreadsheet gives tabs), and
// many spellings of the column headers. Every row is validated here so the
// admin sees problems before anything is sent to the database.

import { parseRank, type Rank } from '@/lib/sffd/ranks'
import { isStation } from '@/lib/sffd/stations'
import { isTour } from '@/lib/sffd/tours'
import { cleanName, nameKey, splitFullName } from './normalize'

/** One roster row, shaped exactly like an element of admin_import_roster(p_rows). */
export interface RosterRowInput {
  first_name: string
  last_name: string
  employee_id?: string
  rank?: Rank
  station?: number
  tour?: number
  email?: string
  phone?: string
}

export interface RosterCsvError {
  /** 1-based line number in the file where the offending record starts (header = 1). */
  line: number
  message: string
}

export interface RosterCsvResult {
  rows: RosterRowInput[]
  errors: RosterCsvError[]
}

/** Largest roster accepted in one upload (SFFD has well under this many members). */
export const MAX_ROSTER_ROWS = 5000

type Field = 'first' | 'last' | 'name' | 'employee_id' | 'rank' | 'station' | 'tour' | 'email' | 'phone'

// Header spellings, keyed by the header lower-cased with everything except
// a–z, 0–9 and '#' removed ('First Name' → 'firstname', 'Emp #' → 'emp#').
const HEADER_ALIASES: Readonly<Record<string, Field>> = {
  first: 'first', firstname: 'first', fname: 'first', givenname: 'first', given: 'first',
  last: 'last', lastname: 'last', lname: 'last', surname: 'last', familyname: 'last',
  name: 'name', fullname: 'name', membername: 'name', employeename: 'name', member: 'name',
  id: 'employee_id', employeeid: 'employee_id', empid: 'employee_id', emp: 'employee_id',
  'emp#': 'employee_id', 'employee#': 'employee_id', 'id#': 'employee_id',
  empno: 'employee_id', employeeno: 'employee_id', employeenumber: 'employee_id', empnumber: 'employee_id',
  rank: 'rank', title: 'rank', position: 'rank', classification: 'rank',
  station: 'station', stn: 'station', sta: 'station', 'station#': 'station', 'stn#': 'station',
  stationnumber: 'station', stationno: 'station', house: 'station',
  tour: 'tour', 'tour#': 'tour', tournumber: 'tour', tourno: 'tour',
  email: 'email', emailaddress: 'email', mail: 'email',
  phone: 'phone', phonenumber: 'phone', cell: 'phone', cellphone: 'phone', mobile: 'phone',
  mobilephone: 'phone', telephone: 'phone',
}

/** Maps a raw header cell to a known field, or null. Exported for tests/UI hints. */
export function headerField(header: string): Field | null {
  const key = header.toLowerCase().replace(/[^a-z0-9#]/g, '')
  return HEADER_ALIASES[key] ?? null
}

// ---------------------------------------------------------------------------
// Low-level CSV tokenising
// ---------------------------------------------------------------------------

interface CsvRecord {
  line: number
  cells: string[]
}

function detectDelimiter(text: string): string {
  // Look only at the first line outside quotes.
  let inQuotes = false
  const counts: Record<string, number> = { ',': 0, '\t': 0, ';': 0 }
  for (const ch of text) {
    if (ch === '"') inQuotes = !inQuotes
    else if (!inQuotes && (ch === '\n' || ch === '\r')) break
    else if (!inQuotes && ch in counts) counts[ch]++
  }
  if (counts[','] > 0) return ','
  if (counts['\t'] > 0) return '\t'
  if (counts[';'] > 0) return ';'
  return ','
}

/** RFC 4180-style parser that also accepts LF/CR line endings and a BOM. */
export function parseCsv(input: string, delimiter?: string): CsvRecord[] {
  const text = input.replace(/^﻿/, '')
  const delim = delimiter ?? detectDelimiter(text)
  const records: CsvRecord[] = []
  let cells: string[] = []
  let cell = ''
  let inQuotes = false
  let line = 1
  let recordLine = 1

  const endCell = () => {
    cells.push(cell)
    cell = ''
  }
  const endRecord = () => {
    endCell()
    records.push({ line: recordLine, cells })
    cells = []
  }

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"'
          i++
        } else {
          inQuotes = false
        }
      } else {
        if (ch === '\n' || (ch === '\r' && text[i + 1] !== '\n')) line++
        cell += ch
      }
      continue
    }
    if (ch === '"' && cell.trim() === '') {
      // Opening quote (whitespace before it is ignored).
      cell = ''
      inQuotes = true
    } else if (ch === delim) {
      endCell()
    } else if (ch === '\r' || ch === '\n') {
      if (ch === '\r' && text[i + 1] === '\n') i++
      endRecord()
      line++
      recordLine = line
    } else {
      cell += ch
    }
  }
  if (cell !== '' || cells.length > 0 || inQuotes) endRecord()
  return records
}

// ---------------------------------------------------------------------------
// Field parsing
// ---------------------------------------------------------------------------

const NO_TOUR = new Set(['', 'none', 'na', 'n/a', '-', '--', 'no', 'notour', 'relief', 'detail', '40hr', '40hour', 'x'])
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** '19', 'Station 19', 'Stn 19', 'S19', '19.0', 'Airport 1', 'Airport Station 2', 'AP3', '101'. */
export function parseStation(input: string): number | null {
  const s = input.trim().toLowerCase()
  if (!s) return null
  const airport = /^(?:airport|sfo|ap|a)\s*(?:station|stn|sta)?\s*#?\s*([123])$/.exec(s)
  if (airport) return 100 + Number(airport[1])
  const plain = /^(?:station|stn|sta|st|s)?\.?\s*#?\s*(\d{1,3})(?:\.0+)?$/.exec(s)
  if (!plain) return null
  const n = Number(plain[1])
  return isStation(n) ? n : null
}

/** '7', 'Tour 7', 'T7', '07'. Returns undefined for "no tour" values, null if invalid. */
export function parseTour(input: string): number | null | undefined {
  const s = input.trim().toLowerCase()
  if (NO_TOUR.has(s.replace(/\s+/g, ''))) return undefined
  const m = /^(?:tour|t)?\.?\s*#?\s*(\d{1,2})(?:\.0+)?$/.exec(s)
  if (!m) return null
  const n = Number(m[1])
  return isTour(n) ? n : null
}

// ---------------------------------------------------------------------------
// Roster parsing
// ---------------------------------------------------------------------------

/**
 * Parses and validates a roster CSV. The first non-blank record must be a
 * header row naming at least first + last name columns, or a single full-name
 * column ('Last, First' or 'First Last'). Blank rows are skipped. Rows with
 * problems are reported in `errors` and left out of `rows`.
 */
export function parseRosterCsv(text: string): RosterCsvResult {
  const errors: RosterCsvError[] = []
  const rows: RosterRowInput[] = []
  const records = parseCsv(text ?? '').filter((r) => r.cells.some((c) => c.trim() !== ''))

  if (records.length === 0) {
    return { rows, errors: [{ line: 1, message: 'The file is empty.' }] }
  }

  // Map columns. The first matching column wins for each field.
  const header = records[0]
  const columns = new Map<Field, number>()
  header.cells.forEach((cell, index) => {
    const field = headerField(cell)
    if (field && !columns.has(field)) columns.set(field, index)
  })
  const hasSplitName = columns.has('first') && columns.has('last')
  if (!hasSplitName && !columns.has('name')) {
    return {
      rows,
      errors: [
        {
          line: header.line,
          message:
            'Could not find name columns. The first row must be headers, e.g. "First Name, Last Name, Employee ID, Rank, Station, Tour, Email, Phone" (or a single "Name" column).',
        },
      ],
    }
  }

  const body = records.slice(1)
  if (body.length > MAX_ROSTER_ROWS) {
    return {
      rows,
      errors: [{ line: header.line, message: `Too many rows (${body.length}). The limit is ${MAX_ROSTER_ROWS} per upload.` }],
    }
  }

  const seen = new Map<string, number>()
  for (const record of body) {
    const get = (field: Field): string => {
      const index = columns.get(field)
      return index === undefined ? '' : (record.cells[index] ?? '').trim()
    }
    const problems: string[] = []

    // Name
    let first = hasSplitName ? cleanName(get('first')) : ''
    let last = hasSplitName ? cleanName(get('last')) : ''
    if ((!first || !last) && columns.has('name')) {
      const split = splitFullName(get('name'))
      if (split) {
        first ||= split.first
        last ||= split.last
      }
    }
    if (!first || !last) problems.push('missing first or last name')
    else if (!nameKey(first) || !nameKey(last)) problems.push(`name "${first} ${last}" has no letters`)
    else if (first.length > 80 || last.length > 80) problems.push('name is too long')

    const row: RosterRowInput = { first_name: first, last_name: last }

    // Employee ID
    const employeeId = get('employee_id').replace(/^#/, '').trim()
    if (employeeId) {
      if (employeeId.length > 40) problems.push('employee ID is too long')
      else row.employee_id = employeeId
    }

    // Rank
    const rankText = get('rank')
    if (rankText) {
      const rank = parseRank(rankText)
      if (rank) row.rank = rank
      else problems.push(`unknown rank "${rankText}"`)
    }

    // Station
    const stationText = get('station')
    if (stationText) {
      const station = parseStation(stationText)
      if (station !== null) row.station = station
      else problems.push(`"${stationText}" is not an SFFD station`)
    }

    // Tour
    const tourText = get('tour')
    const tour = parseTour(tourText)
    if (tour === null) problems.push(`tour "${tourText}" must be 1–31 (or blank for no tour)`)
    else if (tour !== undefined) row.tour = tour

    // Email
    const email = get('email').toLowerCase()
    if (email) {
      if (EMAIL_RE.test(email) && email.length <= 254) row.email = email
      else problems.push(`"${get('email')}" is not a valid email`)
    }

    // Phone
    const phone = cleanName(get('phone'))
    if (phone) {
      if (phone.length > 30) problems.push('phone number is too long')
      else row.phone = phone
    }

    if (problems.length) {
      errors.push({ line: record.line, message: capitalize(problems.join('; ')) + '.' })
      continue
    }

    // Duplicates use the same identity as the database upsert key.
    const identity = `${nameKey(last)}|${nameKey(first)}|${(row.employee_id ?? '').toLowerCase()}`
    const firstLine = seen.get(identity)
    if (firstLine !== undefined) {
      errors.push({ line: record.line, message: `Duplicate of line ${firstLine} (${first} ${last}).` })
      continue
    }
    seen.set(identity, record.line)
    rows.push(row)
  }

  return { rows, errors }
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}
