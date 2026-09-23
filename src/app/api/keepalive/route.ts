// GET /api/keepalive — public health check and database "activity" ping.
//
// Called daily by Vercel Cron (vercel.json) and by the GitHub Actions backup
// (.github/workflows/keepalive.yml). Calling app_keepalive() counts as database
// activity, which stops the Supabase free tier from pausing the project after
// a week without traffic. It uses a plain publishable-key client (no cookies,
// no session) and gives up after 8 seconds.
//
//   200 {ok: true,  db: 'ok', at}
//   503 {ok: false, reason, at}   not configured, unreachable/paused, timed out
//
// Never throws, never cached, and works even when Supabase env vars are missing.

import { NextResponse } from 'next/server'
import { appKeepalive } from '@/lib/api'
import { isMissingEnvError } from '@/lib/env'
import { toAppError } from '@/lib/errors'
import { createPublicClient, isTimeoutError, withTimeout } from '../_lib/public-client'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const TIMEOUT_MS = 8_000

function reply(body: Record<string, unknown>, status: number): NextResponse {
  return NextResponse.json({ ...body, at: new Date().toISOString() }, { status, headers: { 'Cache-Control': 'no-store' } })
}

function failure(reason: string): NextResponse {
  return reply({ ok: false, reason }, 503)
}

export async function GET(): Promise<NextResponse> {
  let supabase
  try {
    supabase = createPublicClient({ timeoutMs: TIMEOUT_MS })
  } catch (error) {
    // Names the missing variables (never values).
    if (isMissingEnvError(error)) return failure(error.message)
    return failure('Could not create the database client.')
  }

  try {
    const result = await withTimeout(appKeepalive(supabase), TIMEOUT_MS)
    if (!result.ok) return failure('The database answered but did not report healthy.')
    return reply({ ok: true, db: 'ok' }, 200)
  } catch (error) {
    const appError = toAppError(error)
    console.error(`[keepalive] ${appError.code} ${appError.details ?? appError.message}`)
    // Our own backstop, or supabase-js reporting the aborted fetch.
    if (isTimeoutError(error) || /TimeoutError|AbortError|timed out|aborted/i.test(appError.details ?? '')) {
      return failure(`The database did not answer within ${TIMEOUT_MS / 1000} seconds (it may be paused or down).`)
    }
    if (appError.isNetwork) return failure('Could not reach the database (it may be paused or down).')
    return failure(appError.message)
  }
}
