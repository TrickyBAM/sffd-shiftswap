// Finding new deploys from an installed app that stays open for days (NEXT-05).
//
// Every deploy registers `/sw.js?v=<version>`, but the bytes of public/sw.js
// don't change between deploys, so registration.update() (which re-fetches the
// *old* URL and compares bytes) never finds a new worker. Instead, on resume the
// page asks the server which version is deployed (next.config.ts serves /sw.js
// with an `X-App-Version` header) and, when it differs from the running build,
// registers the new script URL. The new worker installs and waits, and the page
// shows "New version available".
//
// A waiting worker whose version IS the running build (the page was freshly
// loaded after a deploy, so it already runs the new code) is told to take over
// quietly instead: prompting a reload there would be a pointless second reload.

/** The deploy version in a worker's script URL (`/sw.js?v=<version>`), or null. */
export function workerVersion(worker: Pick<ServiceWorker, 'scriptURL'> | null | undefined): string | null {
  if (!worker?.scriptURL) return null
  try {
    return new URL(worker.scriptURL, 'https://placeholder.invalid').searchParams.get('v')
  } catch {
    return null
  }
}

/** The script URL for a deploy version. */
export function workerScriptUrl(version: string | null | undefined): string {
  return version ? `/sw.js?v=${encodeURIComponent(version)}` : '/sw.js'
}

/**
 * Should a waiting worker be offered with "New version available"? False when
 * it belongs to the build this page already runs (let it take over silently).
 */
export function isUpdateForRunningPage(worker: Pick<ServiceWorker, 'scriptURL'>, runningVersion: string | null | undefined): boolean {
  const version = workerVersion(worker)
  return !runningVersion || !version || version !== runningVersion
}

export interface DeployCheckDeps {
  /** NEXT_PUBLIC_APP_VERSION of the running bundle. */
  runningVersion: string | null | undefined
  /** The page's registration once known. */
  getRegistration: () => ServiceWorkerRegistration | undefined
  /** navigator.serviceWorker.register */
  register: (url: string) => Promise<unknown>
  /** fetch (injectable for tests). */
  fetchImpl?: typeof fetch
  /** Date.now (injectable for tests). */
  now?: () => number
  /** Least time between two checks (default one minute). */
  minIntervalMs?: number
}

/** Header next.config.ts puts on /sw.js with the deployed version. */
export const APP_VERSION_HEADER = 'x-app-version'

/**
 * Returns a throttled check() to call when the app comes back to the
 * foreground. Never throws. Resolves to what it did, for tests and logging.
 */
export function createDeployCheck(deps: DeployCheckDeps): () => Promise<'skipped' | 'registered' | 'updated' | 'none'> {
  const now = deps.now ?? Date.now
  const minInterval = deps.minIntervalMs ?? 60_000
  let last = Number.NEGATIVE_INFINITY
  let running = false

  return async () => {
    const registration = deps.getRegistration()
    if (!registration || running || now() - last < minInterval) return 'skipped'
    running = true
    last = now()
    try {
      let deployed: string | null = null
      try {
        const fetchImpl = deps.fetchImpl ?? fetch
        const res = await fetchImpl('/sw.js', { method: 'HEAD', cache: 'no-store', credentials: 'same-origin' })
        deployed = res.ok ? res.headers.get(APP_VERSION_HEADER) : null
      } catch {
        // Offline: nothing to learn right now.
        return 'none'
      }

      if (deployed && deps.runningVersion && deployed !== deps.runningVersion) {
        const known = [registration.installing, registration.waiting, registration.active].some(
          (worker) => workerVersion(worker) === deployed,
        )
        if (known) return 'none'
        await deps.register(workerScriptUrl(deployed))
        return 'registered'
      }

      // Same version (or no header): still let the browser re-check the worker bytes.
      await registration.update()
      return 'updated'
    } catch {
      return 'none'
    } finally {
      running = false
    }
  }
}
