// GET /api/keepalive through the real supabase-js client with a stubbed global
// fetch: success, missing configuration, unreachable/paused database, a
// missing function, and the 8-second timeout. No network.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const URL_BASE = 'https://abc.supabase.co'

type FetchImpl = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } })
}

async function callKeepalive() {
  const { GET } = await import('@/app/api/keepalive/route')
  const res = await GET()
  return { status: res.status, body: await res.json(), headers: res.headers }
}

describe('GET /api/keepalive', () => {
  let calls: Array<{ url: string; method: string; headers: Headers; signal: AbortSignal | null | undefined }>

  function stubFetch(impl: FetchImpl) {
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      calls.push({ url, method: init?.method ?? 'GET', headers: new Headers(init?.headers), signal: init?.signal })
      return impl(input, init)
    })
  }

  beforeEach(() => {
    calls = []
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', URL_BASE)
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', 'sb_publishable_test')
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', '')
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('returns 200 {ok, db, at} after calling app_keepalive anonymously', async () => {
    stubFetch(async () => json({ ok: true }))
    const res = await callKeepalive()

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ ok: true, db: 'ok', at: expect.any(String) })
    expect(Number.isNaN(Date.parse(res.body.at))).toBe(false)
    expect(res.headers.get('cache-control')).toBe('no-store')

    expect(calls).toHaveLength(1)
    expect(calls[0].method).toBe('POST')
    expect(calls[0].url).toBe(`${URL_BASE}/rest/v1/rpc/app_keepalive`)
    expect(calls[0].headers.get('apikey')).toBe('sb_publishable_test')
    // No session: the only credential is the public key.
    expect(calls[0].headers.get('authorization') ?? 'Bearer sb_publishable_test').toBe('Bearer sb_publishable_test')
    expect(calls[0].signal).toBeInstanceOf(AbortSignal)
  })

  it('is 503 with a reason (not a crash) when Supabase is not configured', async () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', '')
    stubFetch(async () => json({ ok: true }))
    const res = await callKeepalive()

    expect(res.status).toBe(503)
    expect(res.body.ok).toBe(false)
    expect(res.body.reason).toContain('NEXT_PUBLIC_SUPABASE_URL')
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(calls).toHaveLength(0)
  })

  it('is 503 when the database cannot be reached', async () => {
    stubFetch(async () => {
      throw new TypeError('fetch failed')
    })
    const res = await callKeepalive()
    expect(res.status).toBe(503)
    expect(res.body).toMatchObject({ ok: false, reason: expect.stringMatching(/could not reach the database/i) })
  })

  it('is 503 when the project is paused (gateway error page)', async () => {
    stubFetch(async () => new Response('<html><body>Project paused</body></html>', { status: 540, headers: { 'content-type': 'text/html' } }))
    const res = await callKeepalive()
    expect(res.status).toBe(503)
    expect(res.body.ok).toBe(false)
  })

  it('is 503 with a friendly reason when the function is missing (migrations not applied)', async () => {
    stubFetch(async () => json({ code: 'PGRST202', message: 'Could not find the function public.app_keepalive' }, 404))
    const res = await callKeepalive()
    expect(res.status).toBe(503)
    expect(res.body.reason).toMatch(/isn't set up yet/)
    expect(res.body.reason).not.toContain('PGRST')
  })

  it('is 503 when the answer is not ok', async () => {
    stubFetch(async () => json({ ok: false }))
    const res = await callKeepalive()
    expect(res.status).toBe(503)
    expect(res.body.ok).toBe(false)
  })

  it('gives up after 8 seconds', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    // A request that never answers (until aborted).
    stubFetch(
      (_input, init) =>
        new Promise<Response>((_, reject) => {
          init?.signal?.addEventListener('abort', () => reject(init.signal?.reason))
        }),
    )
    const pending = callKeepalive()
    await vi.advanceTimersByTimeAsync(8_000)
    const res = await pending

    expect(res.status).toBe(503)
    expect(res.body.reason).toMatch(/within 8 seconds/)
  })
})
