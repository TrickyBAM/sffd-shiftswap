// Roster upload preview: what parseRosterCsv (src/lib/roster/csv.ts) accepted
// and rejected, line by line, so the admin sees every problem before anything
// is sent to admin_import_roster.

import { parseCsv, parseRosterCsv, type RosterRowInput } from '@/lib/roster/csv'

export interface PreviewLine {
  /** 1-based line in the file where the record starts (the header is line 1). */
  line: number
  /** The row that will be imported, or null when the line has a problem. */
  row: RosterRowInput | null
  /** What's wrong with the line, or null when it's fine. */
  error: string | null
}

export interface RosterPreview {
  /** A problem with the whole file (empty, no name columns, too many rows). Nothing can be imported. */
  fatal: string | null
  /** Every data line in file order, good and bad. */
  lines: PreviewLine[]
  /** The rows that will be sent, in file order. */
  rows: RosterRowInput[]
  /** File line of rows[i] (to explain server-side errors, which count rows from 1). */
  rowLines: number[]
  /** Lines with problems (left out of `rows`). */
  errorCount: number
}

const EMPTY: RosterPreview = { fatal: null, lines: [], rows: [], rowLines: [], errorCount: 0 }

/** Parses pasted or uploaded roster text into a line-by-line preview. */
export function buildRosterPreview(text: string): RosterPreview {
  if (!text.trim()) return EMPTY
  const parsed = parseRosterCsv(text)
  const records = parseCsv(text).filter((record) => record.cells.some((cell) => cell.trim() !== ''))

  if (records.length === 0) {
    return { ...EMPTY, fatal: parsed.errors[0]?.message ?? 'The file is empty.' }
  }
  const headerLine = records[0].line
  const headerProblem = parsed.errors.find((error) => error.line === headerLine)
  if (headerProblem) return { ...EMPTY, fatal: headerProblem.message }

  const errorByLine = new Map<number, string>()
  for (const error of parsed.errors) errorByLine.set(error.line, error.message)

  const bodyLines = records.slice(1).map((record) => record.line)
  const goodLines = bodyLines.filter((line) => !errorByLine.has(line))
  // parseRosterCsv keeps rows in file order and leaves out exactly the lines it
  // reported, so the good lines line up with its rows one to one.
  const rowLines =
    goodLines.length === parsed.rows.length ? goodLines : parsed.rows.map((_, index) => headerLine + index + 1)

  const lines: PreviewLine[] = [
    ...parsed.rows.map((row, index) => ({ line: rowLines[index], row, error: null })),
    ...parsed.errors.map((error) => ({ line: error.line, row: null, error: error.message })),
  ].sort((a, b) => a.line - b.line)

  return { fatal: null, lines, rows: parsed.rows, rowLines, errorCount: parsed.errors.length }
}

/** Server-side import errors (1-based `row` within the rows sent) with their file line. */
export function importErrorsWithLines(
  errors: readonly { row: number; message: string }[],
  rowLines: readonly number[],
): { line: number | null; message: string }[] {
  return errors.map((error) => ({
    line: Number.isInteger(error.row) ? (rowLines[error.row - 1] ?? null) : null,
    message: error.message,
  }))
}

/** "Jane Doe" for a roster row. */
export function rosterRowName(row: Pick<RosterRowInput, 'first_name' | 'last_name'>): string {
  return `${row.first_name} ${row.last_name}`.trim()
}
