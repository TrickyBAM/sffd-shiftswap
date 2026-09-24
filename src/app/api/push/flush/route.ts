// POST /api/push/flush — deliver pending push alerts (ARCHITECTURE §6.5).
//
// Called by the database webhook (header x-webhook-secret = PUSH_WEBHOOK_SECRET,
// sent by pg_net from private.app_config) and, fire-and-forget, by the app after
// any action that notifies someone (signed-in member's cookies). The proxy lets
// this path through without a session; authorization happens here.
//
// Responses (JSON, never cached):
//   401 {error}                            neither a valid secret nor a signed-in member
//   200 {skipped: 'push not configured'}   VAPID keys missing (e.g. preview deploys)
//   200 {claimed, sent, failed, removed}   done
//   503/500 {error}                        database unreachable / server misconfigured

import { NextResponse, type NextRequest } from 'next/server'
import webpush from 'web-push'
import { getVapidConfig, isPushConfigured } from '@/lib/env'
import { toAppError } from '@/lib/errors'
import { authorizeFlush, flushPushQueue } from '@/lib/push/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
// The flush stops claiming after ~8 s; leave room to finish the last batch.
export const maxDuration = 30

function json(body: unknown, status = 200): NextResponse {
  return NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } })
}

/** The signed-in member's id from the request cookies (verified with the Auth server). */
async function signedInUserId(): Promise<string | null> {
  const supabase = await createClient()
  const { data, error } = await supabase.auth.getUser()
  if (error) return null
  return data.user?.id ?? null
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const caller = await authorizeFlush({
    secretHeader: request.headers.get('x-webhook-secret'),
    webhookSecret: process.env.PUSH_WEBHOOK_SECRET,
    getUserId: signedInUserId,
  })
  if (!caller) return json({ error: 'Not authorized.' }, 401)

  if (!isPushConfigured()) return json({ skipped: 'push not configured' })

  let admin
  try {
    admin = createAdminClient()
  } catch (error) {
    // MissingEnvError names the missing variable (never a value).
    console.error(`[push/flush] ${error instanceof Error ? error.message : 'service client unavailable'}`)
    return json({ error: 'Push delivery is not set up on the server yet.' }, 503)
  }

  try {
    const result = await flushPushQueue({ admin, webpush, vapid: getVapidConfig() })
    if (result.claimed > 0) {
      console.info(
        `[push/flush] ${caller}: claimed ${result.claimed}, sent ${result.sent}, failed ${result.failed}, removed ${result.removed}`,
      )
    }
    return json(result)
  } catch (error) {
    const appError = toAppError(error)
    console.error(`[push/flush] ${caller}: ${appError.code} ${appError.details ?? appError.message}`)
    return json({ error: appError.message }, appError.isNetwork ? 503 : 500)
  }
}
