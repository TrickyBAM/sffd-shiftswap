// New-deploy detection for installed apps (src/lib/pwa/update-check.ts, NEXT-05).

import { describe, expect, it, vi } from 'vitest'
import {
  APP_VERSION_HEADER,
  createDeployCheck,
  isUpdateForRunningPage,
  workerScriptUrl,
  workerVersion,
} from '@/lib/pwa/update-check'

const worker = (v: string | null) => ({ scriptURL: v ? `https://app.test/sw.js?v=${v}` : 'https://app.test/sw.js' }) as ServiceWorker

function registration(overrides: Partial<ServiceWorkerRegistration> = {}): ServiceWorkerRegistration {
  return {
    installing: null,
    waiting: null,
    active: worker('old'),
    update: vi.fn(async () => undefined),
    ...overrides,
  } as unknown as ServiceWorkerRegistration
}

function headResponse(version: string | null, ok = true): Response {
  return new Response(null, { status: ok ? 200 : 404, headers: version ? { [APP_VERSION_HEADER]: version } : {} })
}

describe('worker versions', () => {
  it('reads and builds the ?v= script URL', () => {
    expect(workerVersion(worker('abc123'))).toBe('abc123')
    expect(workerVersion(worker(null))).toBeNull()
    expect(workerVersion(null)).toBeNull()
    expect(workerScriptUrl('abc 1')).toBe('/sw.js?v=abc%201')
    expect(workerScriptUrl(undefined)).toBe('/sw.js')
  })

  it('only prompts for a worker from a different build than the running page', () => {
    expect(isUpdateForRunningPage(worker('new'), 'old')).toBe(true)
    // A fresh page load after the deploy already runs "new": no pointless reload prompt.
    expect(isUpdateForRunningPage(worker('new'), 'new')).toBe(false)
    expect(isUpdateForRunningPage(worker(null), 'new')).toBe(true)
    expect(isUpdateForRunningPage(worker('new'), undefined)).toBe(true)
  })
})

describe('createDeployCheck', () => {
  it('registers the new script URL when the server reports a newer deploy', async () => {
    const reg = registration()
    const register = vi.fn(async () => reg)
    const fetchImpl = vi.fn(async () => headResponse('new'))
    const check = createDeployCheck({ runningVersion: 'old', getRegistration: () => reg, register, fetchImpl, now: () => 0 })
    await expect(check()).resolves.toBe('registered')
    expect(fetchImpl).toHaveBeenCalledWith('/sw.js', { method: 'HEAD', cache: 'no-store', credentials: 'same-origin' })
    expect(register).toHaveBeenCalledWith('/sw.js?v=new')
    expect(reg.update).not.toHaveBeenCalled()
  })

  it('does not register again while that version is already installing or waiting', async () => {
    const reg = registration({ waiting: worker('new') })
    const register = vi.fn()
    const check = createDeployCheck({
      runningVersion: 'old',
      getRegistration: () => reg,
      register,
      fetchImpl: async () => headResponse('new'),
      now: () => 0,
    })
    await expect(check()).resolves.toBe('none')
    expect(register).not.toHaveBeenCalled()
  })

  it('same version or no header: falls back to registration.update()', async () => {
    const reg = registration()
    const check = createDeployCheck({
      runningVersion: 'old',
      getRegistration: () => reg,
      register: vi.fn(),
      fetchImpl: async () => headResponse('old'),
      now: () => 0,
    })
    await expect(check()).resolves.toBe('updated')
    expect(reg.update).toHaveBeenCalledTimes(1)
  })

  it('is throttled and quiet offline', async () => {
    let t = 0
    const reg = registration()
    const fetchImpl = vi.fn(async () => {
      throw new TypeError('Failed to fetch')
    })
    const check = createDeployCheck({
      runningVersion: 'old',
      getRegistration: () => reg,
      register: vi.fn(),
      fetchImpl,
      now: () => t,
      minIntervalMs: 60_000,
    })
    await expect(check()).resolves.toBe('none')
    t = 30_000
    await expect(check()).resolves.toBe('skipped')
    t = 61_000
    await expect(check()).resolves.toBe('none')
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it('does nothing before the worker is registered', async () => {
    const fetchImpl = vi.fn()
    const check = createDeployCheck({ runningVersion: 'old', getRegistration: () => undefined, register: vi.fn(), fetchImpl })
    await expect(check()).resolves.toBe('skipped')
    expect(fetchImpl).not.toHaveBeenCalled()
  })
})
