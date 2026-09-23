// GET /api/calendar/[token] (the subscribable ICS feed) and its helpers in
// src/app/api/_lib/calendar.ts.
//
// The route runs with the real supabase-js clients and a stubbed global fetch,
// so the exact PostgREST requests are checked: calendar_feed through the
// public (publishable-key) client and the first-name lookup through the
// service-role client. No network.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import {
  calendarNameFor,
  feedToEvents,
  firstNameOf,
  normalizeCalendarToken,
} from '@/app/api/_lib/calendar'
import type { CalendarFeedRow } from '@/lib/types/database'

const URL_BASE = 'https://abc.supabase.co'
const PUBLIC_KEY = 'sb_publishable_test'
const SECRET_KEY = 'sb_secret_test'
const TOKEN = '5f0c1d2e-3a4b-4c5d-8e6f-7a8b9c0d1e2f'

const ROWS: CalendarFeedRow[] = [
  {
    date: '2026-09-23',
    kind: 'work',
    title: 'On duty (Tour 2)',
    details: 'Station 19 · your tour day. ShiftSwap is unofficial: TeleStaff is the official schedule.',
  },
  {
    date: '2026-09-26',
    kind: 'covering',
    title: 'Covering Mike Jones (24-Hour)',
    details: 'Station 3 · 24-Hour · 24 hours. Traded in ShiftSwap: make sure it is approved in TeleStaff.',
  },
  {
    date: '2026-10-01',
    kind: 'covered_for_me',
    title: 'Off: Sam Lee covering you (PM)',
    details: 'Station 19 · PM · 16 hours · SwapMatch. Traded in ShiftSwap: make sure it is approved in TeleStaff.',
  },
]

/** Undo RFC 5545 folding: CRLF followed by one space joins lines. */
const unfold = (s: string) => s.replace(/\r\n[ \t]/g, '')

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } })
}

interface Call {
  method: string
  path: string
  search: URLSearchParams
  headers: Headers
  body: unknown
}

interface FakeBackend {
  rows?: CalendarFeedRow[]
  /** Full name returned by the service-role profile lookup (null = no match). */
  fullName?: string | null
  feed?: 'network-error' | 'paused'
  profiles?: 'error'
}

describe('GET /api/calendar/[token]', () => {
  let calls: Call[]

  function stubBackend(backend: FakeBackend) {
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url)
      const method = init?.method ?? 'GET'
      const path = url.pathname.replace('/rest/v1/', '')
      const body = typeof init?.body === 'string' && init.body ? JSON.parse(init.body) : null
      calls.push({ method, path, search: url.searchParams, headers: new Headers(init?.headers), body })

      if (method === 'POST' && path === 'rpc/calendar_feed') {
        if (backend.feed === 'network-error') throw new TypeError('fetch failed')
        if (backend.feed === 'paused') {
          return new Response('<html><body>Project paused</body></html>', {
            status: 540,
            headers: { 'content-type': 'text/html' },
          })
        }
        const token = (body as { p_token?: string } | null)?.p_token
        return json(token === TOKEN ? (backend.rows ?? []) : [])
      }
      if (method === 'GET' && path === 'profiles') {
        if (backend.profiles === 'error') return json({ code: 'XX000', message: 'boom' }, 500)
        const name = backend.fullName
        return json(name && url.searchParams.get('calendar_token') === `eq.${TOKEN}` ? [{ full_name: name }] : [])
      }
      return json({ message: `unexpected ${method} ${path}` }, 400)
    })
  }

  async function getCalendar(token: string) {
    const { GET } = await import('@/app/api/calendar/[token]/route')
    const request = new NextRequest(`https://sffd-shiftswap.vercel.app/api/calendar/${token}`)
    const res = await GET(request, { params: Promise.resolve({ token }) })
    return { status: res.status, headers: res.headers, text: await res.text() }
  }

  beforeEach(() => {
    calls = []
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', URL_BASE)
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', PUBLIC_KEY)
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', '')
    vi.stubEnv('SUPABASE_URL', '')
    vi.stubEnv('SUPABASE_SECRET_KEY', SECRET_KEY)
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', '')
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('serves one all-day event per feed row with calendar headers', async () => {
    stubBackend({ rows: ROWS, fullName: 'Brian Machado' })
    const res = await getCalendar(TOKEN)

    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('text/calendar; charset=utf-8')
    expect(res.headers.get('content-disposition')).toBe('inline; filename="shiftswap.ics"')
    expect(res.headers.get('cache-control')).toBe('private, max-age=900')

    const ics = unfold(res.text)
    expect(res.text.startsWith('BEGIN:VCALENDAR\r\nVERSION:2.0\r\n')).toBe(true)
    expect(res.text.endsWith('END:VCALENDAR\r\n')).toBe(true)
    expect(ics).toContain('X-WR-CALNAME:ShiftSwap - Brian\r\n')

    const events = ics.split('BEGIN:VEVENT').slice(1)
    expect(events).toHaveLength(3)
    expect(events[0]).toContain('UID:2026-09-23-work@sffd-shiftswap\r\n')
    expect(events[0]).toContain('DTSTART;VALUE=DATE:20260923\r\n')
    expect(events[0]).toContain('DTEND;VALUE=DATE:20260924\r\n')
    expect(events[0]).toContain('SUMMARY:On duty (Tour 2)\r\n')
    expect(events[0]).toContain(
      'DESCRIPTION:Station 19 · your tour day. ShiftSwap is unofficial: TeleStaff is the official schedule.\r\n',
    )
    expect(events[1]).toContain('UID:2026-09-26-covering@sffd-shiftswap\r\n')
    expect(events[1]).toContain('SUMMARY:Covering Mike Jones (24-Hour)\r\n')
    expect(events[2]).toContain('UID:2026-10-01-covered_for_me@sffd-shiftswap\r\n')
    expect(events[2]).toContain('DTSTART;VALUE=DATE:20261001\r\n')
    expect(events[2]).toContain('URL:https://sffd-shiftswap.vercel.app/calendar\r\n')
  })

  it('keeps personal data out of the calendar header (first name only)', async () => {
    stubBackend({ rows: ROWS, fullName: 'Brian Machado' })
    const res = await getCalendar(TOKEN)
    const header = unfold(res.text).split('BEGIN:VEVENT')[0]

    expect(header).toContain('X-WR-CALNAME:ShiftSwap - Brian')
    expect(header).not.toContain('Machado')
    expect(header).not.toContain(TOKEN)
    expect(header).not.toMatch(/@|Station|Tour/)
  })

  it('reads the feed anonymously with the public key and the name with the service key', async () => {
    stubBackend({ rows: ROWS, fullName: 'Brian Machado' })
    await getCalendar(TOKEN)

    const feed = calls.find((c) => c.path === 'rpc/calendar_feed')
    expect(feed?.method).toBe('POST')
    expect(feed?.body).toEqual({ p_token: TOKEN })
    expect(feed?.headers.get('apikey')).toBe(PUBLIC_KEY)
    // No member session: the only credential is the public key.
    expect(feed?.headers.get('authorization') ?? `Bearer ${PUBLIC_KEY}`).toBe(`Bearer ${PUBLIC_KEY}`)
    expect(feed?.headers.get('cookie')).toBeNull()

    const lookup = calls.find((c) => c.path === 'profiles')
    expect(lookup?.headers.get('apikey')).toBe(SECRET_KEY)
    expect(lookup?.search.get('select')).toBe('full_name')
    expect(lookup?.search.get('calendar_token')).toBe(`eq.${TOKEN}`)
    expect(lookup?.search.get('status')).toBe('eq.approved')
  })

  it('returns an empty but valid calendar for an unknown token', async () => {
    stubBackend({ rows: ROWS, fullName: 'Brian Machado' })
    const other = '0b8a6c4e-2d1f-4a3b-9c5d-6e7f8a9b0c1d'
    const res = await getCalendar(other)

    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('text/calendar; charset=utf-8')
    expect(res.text).toContain('BEGIN:VCALENDAR\r\n')
    expect(res.text).toContain('X-WR-CALNAME:ShiftSwap\r\n')
    expect(res.text).not.toContain('BEGIN:VEVENT')
    expect(res.text.endsWith('END:VCALENDAR\r\n')).toBe(true)
    // Every line ends in CRLF.
    expect(res.text.replace(/\r\n/g, '')).not.toMatch(/[\r\n]/)
  })

  it('is 404 for a token that is not a UUID, without touching the database', async () => {
    stubBackend({ rows: ROWS, fullName: 'Brian Machado' })
    for (const bad of ['not-a-token', '12345', `${TOKEN}x`, "' or 1=1 --", '%E0%A4%A']) {
      const res = await getCalendar(bad)
      expect(res.status).toBe(404)
      expect(res.headers.get('content-type')).toBe('text/plain; charset=utf-8')
    }
    expect(calls).toHaveLength(0)
  })

  it('accepts an upper-case token and a trailing .ics', async () => {
    stubBackend({ rows: ROWS, fullName: 'Brian Machado' })
    const res = await getCalendar(`${TOKEN.toUpperCase()}.ics`)
    expect(res.status).toBe(200)
    expect(res.text).toContain('UID:2026-09-23-work@sffd-shiftswap')
    expect(calls.find((c) => c.path === 'rpc/calendar_feed')?.body).toEqual({ p_token: TOKEN })
  })

  it('still serves the feed (named "ShiftSwap") when the name lookup fails or the service key is missing', async () => {
    stubBackend({ rows: ROWS, profiles: 'error' })
    let res = await getCalendar(TOKEN)
    expect(res.status).toBe(200)
    expect(res.text).toContain('X-WR-CALNAME:ShiftSwap\r\n')
    expect(res.text.split('BEGIN:VEVENT')).toHaveLength(4)

    vi.stubEnv('SUPABASE_SECRET_KEY', '')
    calls = []
    stubBackend({ rows: ROWS, fullName: 'Brian Machado' })
    res = await getCalendar(TOKEN)
    expect(res.status).toBe(200)
    expect(res.text).toContain('X-WR-CALNAME:ShiftSwap\r\n')
    expect(calls.map((c) => c.path)).toEqual(['rpc/calendar_feed'])
  })

  it('is 503 (so calendar apps keep their copy) when the database is unreachable, and never logs the token', async () => {
    for (const feed of ['network-error', 'paused'] as const) {
      stubBackend({ rows: ROWS, fullName: 'Brian Machado', feed })
      const res = await getCalendar(TOKEN)
      expect(res.status).toBe(503)
      expect(res.headers.get('content-type')).toBe('text/plain; charset=utf-8')
      expect(res.headers.get('retry-after')).toBe('900')
      expect(res.headers.get('cache-control')).toBe('no-store')
      expect(res.text).not.toContain('BEGIN:VCALENDAR')
    }
    const logged = vi.mocked(console.error).mock.calls.flat().join('\n')
    expect(logged).not.toContain(TOKEN)
  })

  it('is 503 (not a crash) when Supabase is not configured', async () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', '')
    stubBackend({ rows: ROWS })
    const res = await getCalendar(TOKEN)
    expect(res.status).toBe(503)
    expect(calls).toHaveLength(0)
  })
})

describe('calendar helpers', () => {
  it('normalizes tokens', () => {
    expect(normalizeCalendarToken(TOKEN)).toBe(TOKEN)
    expect(normalizeCalendarToken(` ${TOKEN.toUpperCase()} `)).toBe(TOKEN)
    expect(normalizeCalendarToken(`${TOKEN}.ICS`)).toBe(TOKEN)
    expect(normalizeCalendarToken(encodeURIComponent(TOKEN))).toBe(TOKEN)
    expect(normalizeCalendarToken('')).toBeNull()
    expect(normalizeCalendarToken(null)).toBeNull()
    expect(normalizeCalendarToken('%zz')).toBeNull()
    expect(normalizeCalendarToken(`${TOKEN}.ics.ics`)).toBeNull()
  })

  it('uses only the first name in the calendar name', () => {
    expect(firstNameOf('  Brian   Machado ')).toBe('Brian')
    expect(firstNameOf('')).toBeNull()
    expect(firstNameOf(null)).toBeNull()
    expect(Array.from(firstNameOf('A'.repeat(100)) ?? '')).toHaveLength(40)
    expect(calendarNameFor('Brian Machado')).toBe('ShiftSwap - Brian')
    expect(calendarNameFor('   ')).toBe('ShiftSwap')
    expect(calendarNameFor(undefined)).toBe('ShiftSwap')
  })

  it('builds stable <date>-<kind> UIDs, skips malformed dates and de-duplicates', () => {
    const events = feedToEvents(
      [
        ...ROWS,
        { date: '2026-13-45', kind: 'work', title: 'bad', details: '' },
        { date: '2026-09-23', kind: 'work', title: 'again', details: '' },
      ],
      'https://example.test/calendar',
    )
    expect(events.map((e) => e.uid)).toEqual([
      '2026-09-23-work@sffd-shiftswap',
      '2026-09-26-covering@sffd-shiftswap',
      '2026-10-01-covered_for_me@sffd-shiftswap',
      '2026-09-23-work-2@sffd-shiftswap',
    ])
    expect(events[0]).toEqual({
      uid: '2026-09-23-work@sffd-shiftswap',
      date: '2026-09-23',
      title: 'On duty (Tour 2)',
      description: ROWS[0].details,
      url: 'https://example.test/calendar',
    })
    // Empty details → no DESCRIPTION.
    expect(events[3].description).toBeNull()
    // Same input, same UIDs (calendar apps update events in place).
    expect(feedToEvents(ROWS).map((e) => e.uid)).toEqual(events.slice(0, 3).map((e) => e.uid))
  })
})
