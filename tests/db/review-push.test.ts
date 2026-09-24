// Adversarial review — push subscriptions (ARCHITECTURE §6.2, §6.5).
//
// Every test in this file demonstrates a defect found in review. They are
// expected to FAIL against the current migrations and to pass once fixed.

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createTestDb, unique, type TestDb } from './harness'

let t: TestDb

beforeAll(async () => {
  t = await createTestDb()
})

afterAll(async () => {
  await t?.close()
})

describe('review: push_subscriptions.endpoint is a URL the server will POST to', () => {
  // POST /api/push/flush hands every stored endpoint to web-push, which opens
  // an HTTPS request to whatever host:port the URL names (web-push-lib.js
  // uses https.request with url.parse(endpoint)). Members insert these rows
  // directly through the Data API, so the database is the gate.

  async function insertAs(userId: string, endpoint: string): Promise<boolean> {
    try {
      await t.asUser(userId, (q) =>
        q(`insert into public.push_subscriptions (endpoint, p256dh, auth) values ($1, 'p256dh-key', 'auth-secret')`, [
          endpoint,
        ]),
      )
      return true
    } catch {
      return false
    }
  }

  it('accepts real browser push-service endpoints', async () => {
    const m = await t.createMember()
    expect(await insertAs(m.id, `https://fcm.googleapis.com/fcm/send/${unique()}`)).toBe(true)
    expect(await insertAs(m.id, `https://web.push.apple.com/${unique()}`)).toBe(true)
    expect(await insertAs(m.id, `https://updates.push.services.mozilla.com/wpush/v2/${unique()}`)).toBe(true)
  })

  it('refuses endpoints that would make the server call internal or arbitrary hosts', async () => {
    const m = await t.createMember()
    const accepted: string[] = []
    for (const endpoint of [
      'http://169.254.169.254/latest/meta-data/',
      `https://127.0.0.1:5432/${unique()}`,
      `https://attacker.example.test/collect/${unique()}`,
      'not a url at all',
    ]) {
      if (await insertAs(m.id, endpoint)) accepted.push(endpoint)
    }
    expect(accepted).toEqual([])
  })
})
