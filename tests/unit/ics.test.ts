import { describe, expect, it } from 'vitest'
import { buildIcs, escapeIcsText, foldIcsLine, ICS_PRODID } from '@/lib/ics'

const NOW = new Date('2026-09-23T18:45:07.123Z')
const octets = (s: string) => new TextEncoder().encode(s).length

/** Undo RFC 5545 folding: CRLF followed by one space/tab joins lines. */
const unfold = (s: string) => s.replace(/\r\n[ \t]/g, '')

describe('escapeIcsText', () => {
  it('escapes backslash, semicolon, comma and newlines', () => {
    expect(escapeIcsText('a\\b;c,d\ne\r\nf\rg')).toBe('a\\\\b\\;c\\,d\\ne\\nf\\ng')
    expect(escapeIcsText('plain text: ok')).toBe('plain text: ok')
  })
})

describe('foldIcsLine', () => {
  it('leaves short lines alone', () => {
    const line = 'X'.repeat(75)
    expect(foldIcsLine(line)).toBe(line)
  })

  it('folds at 75 octets with CRLF + space continuation', () => {
    const line = `SUMMARY:${'a'.repeat(200)}`
    const folded = foldIcsLine(line)
    const physical = folded.split('\r\n')
    expect(physical.length).toBeGreaterThan(1)
    expect(octets(physical[0])).toBe(75)
    for (const l of physical.slice(1)) {
      expect(l.startsWith(' ')).toBe(true)
      expect(octets(l)).toBeLessThanOrEqual(75)
    }
    expect(unfold(folded)).toBe(line)
  })

  it('never splits a multi-byte character', () => {
    const line = `SUMMARY:${'é🚒'.repeat(40)}`
    const folded = foldIcsLine(line)
    for (const l of folded.split('\r\n')) {
      expect(octets(l)).toBeLessThanOrEqual(75)
      // Each physical line must be valid UTF-8 on its own (no lone surrogates).
      expect(l).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/)
    }
    expect(unfold(folded)).toBe(line)
  })
})

describe('buildIcs', () => {
  const ics = buildIcs({
    calendarName: 'ShiftSwap – John Smith',
    calendarDescription: 'Work days, trades',
    now: NOW,
    events: [
      { uid: 'work-2026-09-23@sffd-shiftswap', date: '2026-09-23', title: 'On duty (Tour 2)' },
      {
        uid: 'covering-abc@sffd-shiftswap',
        date: '2026-12-31',
        title: 'Covering for Smith, Jane; 24-Hour',
        description: 'Station 19\nReturn: Jan 5',
        url: 'https://shiftswap.example/trades/abc',
      },
    ],
  })

  it('uses CRLF everywhere and ends with CRLF', () => {
    expect(ics.endsWith('\r\n')).toBe(true)
    expect(ics.replace(/\r\n/g, '')).not.toMatch(/[\r\n]/)
  })

  it('has the calendar header and refresh hints', () => {
    const lines = unfold(ics).split('\r\n')
    expect(lines.slice(0, 11)).toEqual([
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      `PRODID:${ICS_PRODID}`,
      'CALSCALE:GREGORIAN',
      'METHOD:PUBLISH',
      'X-WR-CALNAME:ShiftSwap – John Smith',
      'X-WR-TIMEZONE:America/Los_Angeles',
      'X-WR-CALDESC:Work days\\, trades',
      'REFRESH-INTERVAL;VALUE=DURATION:PT12H',
      'X-PUBLISHED-TTL:PT12H',
      'BEGIN:VEVENT',
    ])
    expect(lines.at(-2)).toBe('END:VCALENDAR')
    expect(lines.at(-1)).toBe('')
  })

  it('writes all-day events with an exclusive DTEND', () => {
    const body = unfold(ics)
    expect(body).toContain(
      [
        'BEGIN:VEVENT',
        'UID:work-2026-09-23@sffd-shiftswap',
        'DTSTAMP:20260923T184507Z',
        'DTSTART;VALUE=DATE:20260923',
        'DTEND;VALUE=DATE:20260924',
        'SUMMARY:On duty (Tour 2)',
        'TRANSP:TRANSPARENT',
        'END:VEVENT',
      ].join('\r\n'),
    )
    expect(body).toContain('DTSTART;VALUE=DATE:20261231\r\nDTEND;VALUE=DATE:20270101')
    expect(body).toContain('SUMMARY:Covering for Smith\\, Jane\\; 24-Hour')
    expect(body).toContain('DESCRIPTION:Station 19\\nReturn: Jan 5')
    expect(body).toContain('URL:https://shiftswap.example/trades/abc')
  })

  it('keeps every physical line within 75 octets', () => {
    const long = buildIcs({
      calendarName: 'x',
      now: NOW,
      events: [{ uid: 'u1', date: '2026-09-23', title: 'Ñ'.repeat(120), description: 'word, '.repeat(60) }],
    })
    for (const line of long.split('\r\n')) expect(octets(line)).toBeLessThanOrEqual(75)
    expect(unfold(long)).toContain(`SUMMARY:${'Ñ'.repeat(120)}`)
  })

  it('handles an empty calendar', () => {
    const empty = buildIcs({ calendarName: 'Empty', events: [], now: NOW })
    expect(empty).not.toContain('BEGIN:VEVENT')
    expect(empty).toContain('END:VCALENDAR\r\n')
  })

  it('rejects invalid dates and strips line breaks from UIDs', () => {
    expect(() => buildIcs({ calendarName: 'x', now: NOW, events: [{ uid: 'u', date: '2026-02-30', title: 't' }] })).toThrow(
      RangeError,
    )
    const out = buildIcs({ calendarName: 'x', now: NOW, events: [{ uid: 'a\r\nb', date: '2026-09-23', title: 't' }] })
    expect(out).toContain('UID:a b\r\n')
  })
})
