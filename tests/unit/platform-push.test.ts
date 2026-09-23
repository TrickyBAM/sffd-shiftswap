// Push delivery (src/lib/push/server.ts) and POST /api/push/flush.
//
// The service-role client is the real supabase-js client with a fake fetch
// (so the exact PostgREST requests are checked); web-push is a fake.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { AppError } from '@/lib/errors'
import {
  authorizeFlush,
  buildPushPayload,
  endpointHost,
  flushPushQueue,
  pushTagFor,
  safePushUrl,
  secretsMatch,
  type WebPushClient,
  type WebPushSendOptions,
  type WebPushSubscription,
} from '@/lib/push/server'
import type { PushBatchRow } from '@/lib/types/database'

const U1 = '11111111-1111-4111-8111-111111111111'
const U2 = '22222222-2222-4222-8222-222222222222'
const SHIFT = '33333333-3333-4333-8333-333333333333'
const N = (i: number) => `aaaaaaaa-aaaa-4aaa-8aaa-${String(i).padStart(12, '0')}`
const S = (i: number) => `bbbbbbbb-bbbb-4bbb-8bbb-${String(i).padStart(12, '0')}`

const FCM = 'https://fcm.googleapis.com/fcm/send/SECRET-TOKEN-fcm'
const MOZ = 'https://updates.push.services.mozilla.com/wpush/v2/SECRET-TOKEN-moz'
const APPLE = 'https://web.push.apple.com/SECRET-TOKEN-apple'

const VAPID = { publicKey: 'pub-key', privateKey: 'priv-key', subject: 'mailto:admin@example.com' }

interface SubRow {
  id: string
  user_id: string
  endpoint: string
  p256dh: string
  auth: string
}

interface MetaRow {
  id: string
  type: string
  shift_id: string | null
  actor_id: string | null
}

interface FakeDbOptions {
  batches: PushBatchRow[][]
  subscriptions?: SubRow[]
  notifications?: MetaRow[]
  failSubscriptions?: boolean
  failClaim?: 'network'
}

function row(i: number, userId: string, extra: Partial<PushBatchRow> = {}): PushBatchRow {
  return { notification_id: N(i), user_id: userId, title: `Title ${i}`, body: `Body ${i}`, url: '/trades', ...extra }
}

function sub(i: number, userId: string, endpoint: string): SubRow {
  return { id: S(i), user_id: userId, endpoint, p256dh: `p256dh-${i}`, auth: `auth-${i}` }
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } })
}

/** `in.(a,b)` → ['a', 'b']. */
function inList(value: string | null): string[] {
  const match = /^in\.\((.*)\)$/.exec(value ?? '')
  return match ? match[1].split(',').map((v) => v.replace(/^"|"$/g, '')) : []
}

function fakeAdmin(options: FakeDbOptions) {
  const state = {
    batches: [...options.batches],
    subscriptions: [...(options.subscriptions ?? [])],
    notifications: [...(options.notifications ?? [])],
    claimLimits: [] as number[],
    deleted: [] as string[],
    touched: [] as Array<{ ids: string[]; body: unknown }>,
    released: [] as string[],
    requests: [] as string[],
  }

  const fetchImpl = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url)
    const method = init?.method ?? 'GET'
    const path = url.pathname.replace('/rest/v1/', '')
    const body = typeof init?.body === 'string' && init.body ? JSON.parse(init.body) : null
    state.requests.push(`${method} ${path}`)

    if (method === 'POST' && path === 'rpc/claim_push_batch') {
      if (options.failClaim === 'network') throw new TypeError('fetch failed')
      state.claimLimits.push(body.p_limit)
      return json(state.batches.shift() ?? [])
    }
    if (path === 'push_subscriptions' && method === 'GET') {
      if (options.failSubscriptions) return json({ message: 'boom', code: 'XX000' }, 500)
      const ids = inList(url.searchParams.get('user_id'))
      return json(state.subscriptions.filter((s) => ids.includes(s.user_id)))
    }
    if (path === 'push_subscriptions' && method === 'DELETE') {
      const ids = inList(url.searchParams.get('id'))
      state.deleted.push(...ids)
      state.subscriptions = state.subscriptions.filter((s) => !ids.includes(s.id))
      return new Response(null, { status: 204 })
    }
    if (path === 'push_subscriptions' && method === 'PATCH') {
      state.touched.push({ ids: inList(url.searchParams.get('id')), body })
      return new Response(null, { status: 204 })
    }
    if (path === 'notifications' && method === 'GET') {
      const ids = inList(url.searchParams.get('id'))
      return json(state.notifications.filter((n) => ids.includes(n.id)))
    }
    if (path === 'notifications' && method === 'PATCH') {
      state.released.push(...inList(url.searchParams.get('id')))
      expect(body).toEqual({ pushed_at: null })
      return new Response(null, { status: 204 })
    }
    return json({ message: `unexpected ${method} ${path}` }, 400)
  }

  const admin: SupabaseClient = createClient('https://abc.supabase.co', 'sb_secret_test', {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: fetchImpl },
  })
  return { admin, state }
}

type Outcome = 'ok' | number | Error

function fakeWebPush(outcomeFor: (endpoint: string) => Outcome = () => 'ok') {
  const sends: Array<{ subscription: WebPushSubscription; payload: unknown; options: WebPushSendOptions }> = []
  const vapidCalls: string[][] = []
  const client: WebPushClient = {
    setVapidDetails: (subject, publicKey, privateKey) => {
      vapidCalls.push([subject, publicKey, privateKey])
    },
    sendNotification: async (subscription, payload, options) => {
      sends.push({ subscription, payload: JSON.parse(payload), options })
      const outcome = outcomeFor(subscription.endpoint)
      if (outcome === 'ok') return { statusCode: 201 }
      if (outcome instanceof Error) throw outcome
      throw Object.assign(new Error(`Received unexpected response code ${outcome}`), {
        statusCode: outcome,
        endpoint: subscription.endpoint,
      })
    },
  }
  return { client, sends, vapidCalls }
}

function quietLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}

// ---------------------------------------------------------------------------

describe('secretsMatch', () => {
  it('accepts only the exact configured secret', () => {
    expect(secretsMatch('s3cret-value', 's3cret-value')).toBe(true)
    expect(secretsMatch('  s3cret-value\n', 's3cret-value')).toBe(true)
    expect(secretsMatch('s3cret-valuE', 's3cret-value')).toBe(false)
    expect(secretsMatch('s3cret', 's3cret-value')).toBe(false)
  })

  it('never matches when either side is blank', () => {
    expect(secretsMatch('', '')).toBe(false)
    expect(secretsMatch(null, 'x')).toBe(false)
    expect(secretsMatch('x', undefined)).toBe(false)
    expect(secretsMatch('   ', '   ')).toBe(false)
  })
})

describe('authorizeFlush', () => {
  it('lets the webhook in with the right secret without checking a session', async () => {
    const getUserId = vi.fn(async () => null)
    await expect(authorizeFlush({ secretHeader: 'abc', webhookSecret: 'abc', getUserId })).resolves.toBe('webhook')
    expect(getUserId).not.toHaveBeenCalled()
  })

  it('lets a signed-in member in', async () => {
    await expect(
      authorizeFlush({ secretHeader: null, webhookSecret: 'abc', getUserId: async () => U1 }),
    ).resolves.toBe('member')
    await expect(
      authorizeFlush({ secretHeader: 'wrong', webhookSecret: 'abc', getUserId: async () => U1 }),
    ).resolves.toBe('member')
  })

  it('refuses a wrong secret, a missing session, an unconfigured secret and auth failures', async () => {
    await expect(authorizeFlush({ secretHeader: 'wrong', webhookSecret: 'abc', getUserId: async () => null })).resolves.toBeNull()
    await expect(authorizeFlush({ secretHeader: 'abc', webhookSecret: null, getUserId: async () => null })).resolves.toBeNull()
    await expect(authorizeFlush({ secretHeader: '', webhookSecret: '', getUserId: async () => null })).resolves.toBeNull()
    await expect(
      authorizeFlush({
        secretHeader: null,
        webhookSecret: 'abc',
        getUserId: async () => {
          throw new Error('auth down')
        },
      }),
    ).resolves.toBeNull()
  })
})

describe('payload helpers', () => {
  it('keeps only same-origin paths', () => {
    expect(safePushUrl('/trades/abc?x=1')).toBe('/trades/abc?x=1')
    expect(safePushUrl('https://evil.example/phish')).toBe('/alerts')
    expect(safePushUrl('//evil.example')).toBe('/alerts')
    expect(safePushUrl('/\\evil.example')).toBe('/alerts')
    expect(safePushUrl('/ok\nLocation: x')).toBe('/alerts')
    expect(safePushUrl(null)).toBe('/alerts')
    expect(safePushUrl('')).toBe('/alerts')
  })

  it('builds { title, body, url, tag? } and trims long text', () => {
    expect(buildPushPayload({ title: 'Hi', body: 'There', url: '/alerts' })).toEqual({ title: 'Hi', body: 'There', url: '/alerts' })
    expect(buildPushPayload({ title: '  ', body: '', url: 'javascript:alert(1)' }, 'tag-1')).toEqual({
      title: 'ShiftSwap',
      body: '',
      url: '/alerts',
      tag: 'tag-1',
    })
    const long = buildPushPayload({ title: 'T'.repeat(500), body: '🚒'.repeat(1000), url: '/x' })
    expect(Array.from(long.title)).toHaveLength(120)
    expect(Array.from(long.body)).toHaveLength(600)
    expect(long.body.endsWith('…')).toBe(true)
    expect(new TextEncoder().encode(JSON.stringify(long)).length).toBeLessThan(3500)
  })

  it('tags chat alerts per shift and sender only', () => {
    expect(pushTagFor({ type: 'message', shift_id: SHIFT, actor_id: U2 })).toBe(`message:${SHIFT}:${U2}`)
    expect(pushTagFor({ type: 'message', shift_id: null, actor_id: U2 })).toBeUndefined()
    expect(pushTagFor({ type: 'request_received', shift_id: SHIFT, actor_id: U2 })).toBeUndefined()
    expect(pushTagFor(null)).toBeUndefined()
  })

  it('reduces endpoints to their host for logs', () => {
    expect(endpointHost(FCM)).toBe('fcm.googleapis.com')
    expect(endpointHost('not a url')).toBe('unknown push service')
  })
})

describe('flushPushQueue', () => {
  it('sends every claimed alert to every device, removes gone devices and counts failures', async () => {
    const { admin, state } = fakeAdmin({
      batches: [[row(1, U1), row(2, U2, { url: 'https://evil.example' })], [row(3, U1)]],
      subscriptions: [sub(1, U1, FCM), sub(2, U1, MOZ), sub(3, U2, APPLE)],
      notifications: [{ id: N(3), type: 'message', shift_id: SHIFT, actor_id: U2 }],
    })
    const push = fakeWebPush((endpoint) => (endpoint === MOZ ? 410 : endpoint === APPLE ? 500 : 'ok'))
    const logger = quietLogger()

    const result = await flushPushQueue({ admin, webpush: push.client, vapid: VAPID, batchSize: 2, logger })

    expect(result).toEqual({ claimed: 3, sent: 2, failed: 1, removed: 1 })
    expect(push.vapidCalls).toEqual([[VAPID.subject, VAPID.publicKey, VAPID.privateKey]])
    // Full first batch → claimed again; the short second batch ends the loop.
    expect(state.claimLimits).toEqual([2, 2])
    expect(state.deleted).toEqual([S(2)])
    expect(state.touched.map((t) => t.ids)).toEqual([[S(1)], [S(1)]])
    expect(state.touched[0].body).toEqual({ last_success_at: expect.any(String) })

    expect(push.sends).toHaveLength(4)
    for (const send of push.sends) expect(send.options).toMatchObject({ TTL: 86400, urgency: 'high' })
    const fcmSends = push.sends.filter((s) => s.subscription.endpoint === FCM)
    expect(fcmSends.map((s) => s.payload)).toEqual([
      { title: 'Title 1', body: 'Body 1', url: '/trades' },
      { title: 'Title 3', body: 'Body 3', url: '/trades', tag: `message:${SHIFT}:${U2}` },
    ])
    expect(fcmSends[0].subscription).toEqual({ endpoint: FCM, keys: { p256dh: 'p256dh-1', auth: 'auth-1' } })
    const appleSend = push.sends.find((s) => s.subscription.endpoint === APPLE)
    expect(appleSend?.payload).toMatchObject({ url: '/alerts' })
  })

  it('never logs a full endpoint', async () => {
    const { admin } = fakeAdmin({ batches: [[row(1, U2)]], subscriptions: [sub(3, U2, APPLE)] })
    const push = fakeWebPush(() => new Error(`connect ETIMEDOUT for ${APPLE}`))
    const logger = quietLogger()

    const result = await flushPushQueue({ admin, webpush: push.client, vapid: VAPID, logger })

    expect(result).toEqual({ claimed: 1, sent: 0, failed: 1, removed: 0 })
    const logged = [...logger.warn.mock.calls, ...logger.info.mock.calls, ...logger.error.mock.calls].flat().join('\n')
    expect(logged).toContain('web.push.apple.com')
    expect(logged).not.toContain('SECRET-TOKEN')
  })

  it('stops when the queue is empty', async () => {
    const { admin, state } = fakeAdmin({ batches: [] })
    const push = fakeWebPush()
    const result = await flushPushQueue({ admin, webpush: push.client, vapid: VAPID })
    expect(result).toEqual({ claimed: 0, sent: 0, failed: 0, removed: 0 })
    expect(state.claimLimits).toEqual([200])
    expect(state.requests).toEqual(['POST rpc/claim_push_batch'])
  })

  it('keeps claiming full batches until the queue drains', async () => {
    const { admin, state } = fakeAdmin({ batches: [[row(1, U1)], [row(2, U1)], []] })
    const push = fakeWebPush()
    const result = await flushPushQueue({ admin, webpush: push.client, vapid: VAPID, batchSize: 1 })
    expect(result.claimed).toBe(2)
    expect(state.claimLimits).toEqual([1, 1, 1])
  })

  it('stops claiming once the time budget is spent', async () => {
    const { admin, state } = fakeAdmin({ batches: [[row(1, U1)], [row(2, U1)], [row(3, U1)]] })
    const push = fakeWebPush()
    let clock = 0
    const now = () => {
      const t = clock
      clock += 5_000
      return t
    }
    const result = await flushPushQueue({ admin, webpush: push.client, vapid: VAPID, batchSize: 1, now })
    // start = 0; after batch 1 → 5 s (< 8 s, go on); after batch 2 → 10 s (stop).
    expect(result.claimed).toBe(2)
    expect(state.claimLimits).toEqual([1, 1])
  })

  it('puts a claimed batch back in the queue when its devices cannot be loaded', async () => {
    const { admin, state } = fakeAdmin({
      batches: [[row(1, U1), row(2, U2)]],
      subscriptions: [sub(1, U1, FCM)],
      failSubscriptions: true,
    })
    const push = fakeWebPush()
    await expect(flushPushQueue({ admin, webpush: push.client, vapid: VAPID, logger: quietLogger() })).rejects.toBeInstanceOf(
      AppError,
    )
    expect(state.released.sort()).toEqual([N(1), N(2)].sort())
    expect(push.sends).toHaveLength(0)
  })

  it('refuses invalid VAPID keys before claiming anything', async () => {
    const { admin, state } = fakeAdmin({ batches: [[row(1, U1)]] })
    const push = fakeWebPush()
    push.client.setVapidDetails = () => {
      throw new Error('Vapid private key should be 32 bytes long when decoded.')
    }
    await expect(flushPushQueue({ admin, webpush: push.client, vapid: VAPID })).rejects.toMatchObject({
      name: 'AppError',
      message: expect.stringContaining('VAPID'),
    })
    expect(state.requests).toEqual([])
  })

  it('surfaces a claim failure as a NETWORK AppError', async () => {
    const { admin } = fakeAdmin({ batches: [], failClaim: 'network' })
    const push = fakeWebPush()
    await expect(flushPushQueue({ admin, webpush: push.client, vapid: VAPID })).rejects.toMatchObject({ code: 'NETWORK' })
  })
})

// ---------------------------------------------------------------------------
// The route handler
// ---------------------------------------------------------------------------

const routeMocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  admin: null as unknown,
  webpush: {
    setVapidDetails: vi.fn(),
    sendNotification: vi.fn(async () => ({ statusCode: 201 })),
  },
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ auth: { getUser: routeMocks.getUser } }),
}))
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => {
    if (!routeMocks.admin) throw Object.assign(new Error('Server is not configured: missing SUPABASE_SECRET_KEY'), { name: 'MissingEnvError' })
    return routeMocks.admin
  },
}))
vi.mock('web-push', () => ({ default: routeMocks.webpush }))

describe('POST /api/push/flush', () => {
  beforeEach(() => {
    vi.stubEnv('PUSH_WEBHOOK_SECRET', 'hook-secret-123')
    vi.stubEnv('NEXT_PUBLIC_VAPID_PUBLIC_KEY', 'pub')
    vi.stubEnv('VAPID_PRIVATE_KEY', 'priv')
    vi.stubEnv('VAPID_SUBJECT', 'mailto:admin@example.com')
    routeMocks.getUser.mockReset()
    routeMocks.getUser.mockResolvedValue({ data: { user: null }, error: { name: 'AuthSessionMissingError' } })
    routeMocks.admin = fakeAdmin({ batches: [] }).admin
    routeMocks.webpush.setVapidDetails.mockClear()
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    vi.spyOn(console, 'info').mockImplementation(() => undefined)
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  async function post(headers: Record<string, string> = {}) {
    const { POST } = await import('@/app/api/push/flush/route')
    const { NextRequest } = await import('next/server')
    const res = await POST(new NextRequest('http://localhost/api/push/flush', { method: 'POST', headers }))
    return { status: res.status, body: await res.json(), headers: res.headers }
  }

  it('is 401 without the secret or a signed-in member', async () => {
    const res = await post()
    expect(res.status).toBe(401)
    expect(res.body).toEqual({ error: 'Not authorized.' })
    expect(res.headers.get('cache-control')).toBe('no-store')
  })

  it('is 401 with a wrong secret', async () => {
    const res = await post({ 'x-webhook-secret': 'hook-secret-124' })
    expect(res.status).toBe(401)
  })

  it('flushes for the database webhook', async () => {
    routeMocks.admin = fakeAdmin({ batches: [[row(1, U1)]], subscriptions: [sub(1, U1, FCM)] }).admin
    const res = await post({ 'x-webhook-secret': 'hook-secret-123' })
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ claimed: 1, sent: 1, failed: 0, removed: 0 })
    expect(routeMocks.getUser).not.toHaveBeenCalled()
    expect(routeMocks.webpush.setVapidDetails).toHaveBeenCalledWith('mailto:admin@example.com', 'pub', 'priv')
  })

  it('flushes for a signed-in member', async () => {
    routeMocks.getUser.mockResolvedValue({ data: { user: { id: U1 } }, error: null })
    const res = await post()
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ claimed: 0, sent: 0, failed: 0, removed: 0 })
  })

  it('skips (200) when push is not configured', async () => {
    vi.stubEnv('VAPID_PRIVATE_KEY', '')
    const res = await post({ 'x-webhook-secret': 'hook-secret-123' })
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ skipped: 'push not configured' })
  })

  it('checks authorization before reporting configuration', async () => {
    vi.stubEnv('VAPID_PRIVATE_KEY', '')
    const res = await post()
    expect(res.status).toBe(401)
  })

  it('is 503 when the service key is missing or the database is unreachable', async () => {
    routeMocks.admin = null
    expect((await post({ 'x-webhook-secret': 'hook-secret-123' })).status).toBe(503)

    routeMocks.admin = fakeAdmin({ batches: [], failClaim: 'network' }).admin
    const res = await post({ 'x-webhook-secret': 'hook-secret-123' })
    expect(res.status).toBe(503)
    expect(res.body.error).toMatch(/connection/i)
  })
})
