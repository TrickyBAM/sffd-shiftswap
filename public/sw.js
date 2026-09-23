/*
 * SFFD ShiftSwap service worker (ARCHITECTURE §8).
 *
 * What it does:
 * - Precaches the /offline page (plus the CSS/JS it needs) and the app icons.
 * - Serves /_next/static/* and /icons/* cache-first (content-hashed / versioned files).
 * - Page navigations always go to the network; if that fails, it shows /offline.
 *   Page HTML is never cached: pages contain signed-in members' data.
 * - Never touches API routes, Supabase or any other cross-origin request.
 * - Shows push notifications and opens the right screen when one is tapped.
 *
 * Versioning: the page registers `/sw.js?v=<deploy version>`, so every deploy installs a
 * new worker whose caches are named after that version; old caches are deleted when it
 * activates. The new worker waits until the page asks it to take over (SKIP_WAITING,
 * sent from the "New version available" toast).
 */

const VERSION = new URL(self.location.href).searchParams.get('v') || 'dev'
const CACHE_PREFIX = 'shiftswap-'
const STATIC_CACHE = `${CACHE_PREFIX}static-${VERSION}`
const OFFLINE_URL = '/offline'
const DEFAULT_URL = '/alerts'
const ICON = '/icons/icon-192.png'
const BADGE = '/icons/badge-96.png'

const PRECACHE_URLS = [
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/icon-maskable-192.png',
  '/icons/icon-maskable-512.png',
  BADGE,
]

// Caches written by the pre-v1 worker, which stored page HTML. Their presence means an
// old worker is in control, so the new one activates immediately to stop that.
const LEGACY_PAGE_CACHE_PREFIX = 'shiftswap-pages-'

/** Cache /offline and the same-origin /_next/static assets its HTML references. */
async function precacheOfflinePage(cache) {
  const response = await fetch(OFFLINE_URL, { cache: 'reload', credentials: 'same-origin' })
  if (!response.ok) throw new Error(`Offline page returned ${response.status}`)
  const html = await response.clone().text()
  await cache.put(OFFLINE_URL, response)

  const assets = new Set()
  const pattern = /(?:src|href)="(\/_next\/static\/[^"]+)"/g
  let match
  while ((match = pattern.exec(html)) !== null) {
    assets.add(match[1].replace(/&amp;/g, '&'))
  }
  // Best effort: a missing chunk only means a less pretty offline page.
  await Promise.all(
    Array.from(assets).map((url) =>
      fetch(url, { credentials: 'same-origin' })
        .then((res) => (res.ok ? cache.put(url, res) : undefined))
        .catch(() => undefined),
    ),
  )
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(STATIC_CACHE)
      await Promise.all([
        cache.addAll(PRECACHE_URLS).catch(() => undefined),
        precacheOfflinePage(cache),
      ])
      const keys = await caches.keys()
      if (keys.some((key) => key.startsWith(LEGACY_PAGE_CACHE_PREFIX))) {
        await self.skipWaiting()
      }
    })(),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys()
      await Promise.all(
        keys
          .filter((key) => key.startsWith(CACHE_PREFIX) && key !== STATIC_CACHE)
          .map((key) => caches.delete(key)),
      )
      await self.clients.claim()
    })(),
  )
})

self.addEventListener('message', (event) => {
  const type = event.data && event.data.type
  if (type === 'SKIP_WAITING') {
    self.skipWaiting()
  } else if (type === 'CLEAR_CACHES') {
    // Sign-out: drop everything this origin has cached.
    event.waitUntil(caches.keys().then((keys) => Promise.all(keys.map((key) => caches.delete(key)))))
  }
})

function isCacheableStatic(url) {
  return url.pathname.startsWith('/_next/static/') || url.pathname.startsWith('/icons/')
}

async function cacheFirst(request) {
  const cached = await caches.match(request)
  if (cached) return cached
  const response = await fetch(request)
  // Only cache complete same-origin successes (never opaque or partial responses).
  if (response.ok && response.status === 200 && response.type === 'basic') {
    const copy = response.clone()
    caches
      .open(STATIC_CACHE)
      .then((cache) => cache.put(request, copy))
      .catch(() => undefined)
  }
  return response
}

async function networkOnlyNavigation(request) {
  try {
    return await fetch(request)
  } catch {
    const offline = await caches.match(OFFLINE_URL)
    return (
      offline ||
      new Response('You are offline. Reconnect and try again.', {
        status: 503,
        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      })
    )
  }
}

self.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET') return

  const url = new URL(request.url)
  // Cross-origin (Supabase auth/data/realtime, push services): browser handles it.
  if (url.origin !== self.location.origin) return
  // API routes (keepalive, push flush, calendar feed): never intercepted or cached.
  if (url.pathname.startsWith('/api/')) return

  if (request.mode === 'navigate') {
    event.respondWith(networkOnlyNavigation(request))
    return
  }

  if (isCacheableStatic(url)) {
    event.respondWith(cacheFirst(request))
  }
  // Everything else (RSC payloads, manifest, images, …) goes straight to the network.
})

// ------------------------------------------------------------------ push

/** Only allow same-origin deep links from a push payload. */
function safeUrl(raw) {
  try {
    const url = new URL(typeof raw === 'string' && raw ? raw : DEFAULT_URL, self.location.origin)
    return url.origin === self.location.origin ? url.href : new URL(DEFAULT_URL, self.location.origin).href
  } catch {
    return new URL(DEFAULT_URL, self.location.origin).href
  }
}

/*
 * Payload (JSON, sent by src/lib/push/server.ts):
 *   { title, body, url?, tag? }
 * `tag` collapses repeats (e.g. several chat messages about one shift) into one alert.
 */
self.addEventListener('push', (event) => {
  let payload = {}
  if (event.data) {
    try {
      payload = event.data.json() || {}
    } catch {
      payload = { body: event.data.text() }
    }
  }

  const title = typeof payload.title === 'string' && payload.title ? payload.title : 'ShiftSwap'
  const options = {
    body: typeof payload.body === 'string' ? payload.body : '',
    icon: ICON,
    badge: BADGE,
    data: { url: safeUrl(payload.url) },
  }
  if (typeof payload.tag === 'string' && payload.tag) {
    options.tag = payload.tag
    // A replaced alert should still buzz the phone.
    options.renotify = true
  }

  event.waitUntil(self.registration.showNotification(title, options))
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const target = safeUrl(event.notification.data && event.notification.data.url)

  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      const existing = windows.find((client) => new URL(client.url).origin === self.location.origin)

      if (existing) {
        const focused = await existing.focus().catch(() => existing)
        try {
          // Full navigation to the deep link (works when this worker controls the window).
          if ('navigate' in focused && focused.url !== target) await focused.navigate(target)
        } catch {
          // Uncontrolled window: ask the page to route itself (handled by PWARegister).
          focused.postMessage({ type: 'NAVIGATE', url: target })
        }
        return
      }

      if (self.clients.openWindow) await self.clients.openWindow(target)
    })(),
  )
})

/*
 * The browser rotated the push subscription. Re-subscribe with the same key so alerts
 * keep arriving; the app re-saves it to the database next time it opens
 * (resyncPushSubscription). Pages that are open are told right away.
 */
self.addEventListener('pushsubscriptionchange', (event) => {
  const old = event.oldSubscription
  const key = old && old.options && old.options.applicationServerKey
  if (!key) return
  event.waitUntil(
    self.registration.pushManager
      .subscribe({ userVisibleOnly: true, applicationServerKey: key })
      .then(() => self.clients.matchAll({ type: 'window' }))
      .then((windows) => windows.forEach((client) => client.postMessage({ type: 'PUSH_SUBSCRIPTION_CHANGED' })))
      .catch(() => undefined),
  )
})
