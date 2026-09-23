// CSV writing for admin exports and the roster template.
//
// RFC 4180 quoting (fields with a comma, quote, CR or LF — or leading/trailing
// spaces — are wrapped in quotes with inner quotes doubled; records end with
// CRLF). Text that a spreadsheet would run as a formula (starting with = + - @
// tab or CR) is prefixed with an apostrophe so an exported name or note can
// never execute in Excel/Sheets.

/** Headers of the roster upload template, in order (see parseRosterCsv). */
export const ROSTER_TEMPLATE_HEADERS = [
  'first_name',
  'last_name',
  'employee_id',
  'rank',
  'station',
  'tour',
  'email',
  'phone',
] as const

/** The example row shown in the template. */
export const ROSTER_TEMPLATE_EXAMPLE = [
  'Jane',
  'Doe',
  '12345',
  'Firefighter',
  '19',
  '7',
  'jane.doe@example.com',
  '(415) 555-0123',
] as const

const FORMULA_START = /^[=+\-@\t\r]/
const NEEDS_QUOTES = /[",\r\n]|^\s|\s$/

/** One CSV field. null/undefined → empty; numbers and booleans as-is. */
export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : ''
  if (typeof value === 'boolean') return value ? 'yes' : 'no'
  let text = String(value)
  if (FORMULA_START.test(text)) text = `'${text}`
  return NEEDS_QUOTES.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

/** A whole CSV document: one line per row, CRLF line endings, trailing CRLF. */
export function toCsv(rows: ReadonlyArray<ReadonlyArray<unknown>>): string {
  return rows.map((row) => row.map(csvCell).join(',')).join('\r\n') + (rows.length ? '\r\n' : '')
}

/** The roster template: the header row plus one example row. */
export function rosterTemplateCsv(): string {
  return toCsv([ROSTER_TEMPLATE_HEADERS, ROSTER_TEMPLATE_EXAMPLE])
}

/**
 * Saves text as a file in the browser (Blob + temporary link). A UTF-8 BOM is
 * added so Excel reads accents correctly. Browser only.
 */
export function downloadTextFile(filename: string, text: string, type = 'text/csv;charset=utf-8'): void {
  const blob = new Blob(['\uFEFF', text], { type })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.rel = 'noopener'
  link.style.display = 'none'
  document.body.appendChild(link)
  link.click()
  link.remove()
  // Give Safari a moment to start the download before the URL is revoked.
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}
