export const dynamic = 'force-dynamic'

// Pinged daily by Vercel Cron (vercel.json) and a GitHub Actions backup.
// A real PostgREST query counts as project activity, which stops the
// Supabase free tier from pausing the database after 7 idle days.
export async function GET() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (!url || !key) {
    return Response.json(
      { ok: false, error: 'Supabase env vars missing' },
      { status: 500 }
    )
  }

  const results: Record<string, number | string> = {}
  let ok = true

  try {
    const headers = {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
    }
    const rpc = await fetch(`${url}/rest/v1/rpc/app_keepalive`, {
      method: 'POST',
      headers,
      body: '{}',
      cache: 'no-store',
    })

    if (rpc.ok) {
      results.db = rpc.status
    } else {
      const rpcBody = await rpc.text()
      const rpcMissing = rpc.status === 404 && (
        rpcBody.includes('PGRST202') || rpcBody.includes('app_keepalive')
      )

      if (!rpcMissing) {
        results.db = rpc.status
        ok = false
      } else {
        // Deployment-safe fallback until migration 001 is applied. Phase 002
        // removes anonymous shift reads only after this route is live.
        const legacy = await fetch(`${url}/rest/v1/shifts?select=id&limit=1`, {
          headers,
          cache: 'no-store',
        })
        results.db = legacy.status
        if (!legacy.ok) ok = false
      }
    }
  } catch {
    results.db = 'unreachable'
    ok = false
  }

  try {
    const auth = await fetch(`${url}/auth/v1/health`, {
      headers: { apikey: key },
      cache: 'no-store',
    })
    results.auth = auth.status
    if (!auth.ok) ok = false
  } catch {
    results.auth = 'unreachable'
    ok = false
  }

  return Response.json(
    { ok, ...results, at: new Date().toISOString() },
    { status: ok ? 200 : 503 }
  )
}
