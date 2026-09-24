// GET /api/calendar/[token] — a member's subscribable calendar (ICS).
//
// Profile ▸ "Add to my calendar" gives members a webcal:// link to this route.
// The token (profiles.calendar_token) is the only secret: calendar apps can't
// sign in. The feed rows come from calendar_feed() through a cookie-less
// public-key client; unknown tokens (or members who aren't approved) get an
// empty but valid calendar. The calendar's name is "ShiftSwap - <first name>";
// no other personal data goes in the calendar header.
//
//   404 text/plain    the token isn't a UUID
//   200 text/calendar the feed (possibly empty)
//   503 text/plain    the database couldn't be reached — calendar apps keep
//                     their copy and retry, instead of wiping every event

import type { NextRequest } from 'next/server'
import { getCalendarFeed } from '@/lib/api'
import { buildIcs } from '@/lib/ics'
import { createAdminClient } from '@/lib/supabase/admin'
import { toAppError } from '@/lib/errors'
import type { CalendarFeedRow } from '@/lib/types/database'
import { CALENDAR_DESCRIPTION, calendarNameFor, feedToEvents, normalizeCalendarToken } from '../../_lib/calendar'
import { createPublicClient, withTimeout } from '../../_lib/public-client'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const FEED_TIMEOUT_MS = 10_000
const NAME_TIMEOUT_MS = 4_000

function text(body: string, status: number, extra: Record<string, string> = {}): Response {
  return new Response(body, {
    status,
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', ...extra },
  })
}

/**
 * The member's full name for the calendar title, read with the service-role
 * client (calendar_feed returns no name and anonymous callers can't read
 * profiles). Best effort: null when not configured, slow or failing.
 */
async function memberName(token: string): Promise<string | null> {
  try {
    const admin = createAdminClient()
    const query = admin
      .from('profiles')
      .select('full_name')
      .eq('calendar_token', token)
      .eq('status', 'approved')
      .maybeSingle()
    const { data, error } = await withTimeout(Promise.resolve(query), NAME_TIMEOUT_MS)
    if (error) return null
    const name = (data as { full_name?: unknown } | null)?.full_name
    return typeof name === 'string' ? name : null
  } catch {
    return null
  }
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ token: string }> }): Promise<Response> {
  const { token: rawToken } = await params
  const token = normalizeCalendarToken(rawToken)
  if (!token) return text('Calendar not found.', 404)

  let feed: { rows: CalendarFeedRow[]; fullName: string | null }
  try {
    const supabase = createPublicClient({ timeoutMs: FEED_TIMEOUT_MS })
    const [rows, fullName] = await Promise.all([
      withTimeout(getCalendarFeed(supabase, token), FEED_TIMEOUT_MS),
      memberName(token),
    ])
    feed = { rows, fullName }
  } catch (error) {
    // Never log the token: it is the member's calendar password.
    const appError = toAppError(error)
    console.error(`[calendar] feed unavailable: ${appError.code}`)
    return text('The ShiftSwap calendar is temporarily unavailable. Your calendar app will try again later.', 503, {
      'Retry-After': '900',
    })
  }

  const ics = buildIcs({
    calendarName: calendarNameFor(feed.fullName),
    calendarDescription: CALENDAR_DESCRIPTION,
    events: feedToEvents(feed.rows, new URL('/calendar', request.url).toString()),
  })

  return new Response(ics, {
    status: 200,
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': 'inline; filename="shiftswap.ics"',
      'Cache-Control': 'private, max-age=900',
    },
  })
}
