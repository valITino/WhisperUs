// The service worker. Three jobs:
//
//   1. Offline: it saves the app itself (page, scripts, styles, fonts, icons, manifest)
//      the first time the app is opened online, and answers from that copy afterwards.
//      The room's data is not its business (that lives in IndexedDB), and calls to
//      the cloud never pass through it.
//   2. Updates: a new version installs next to the running one and waits. The page shows
//      a note; the new version takes over when the person taps "Reload" or the next time
//      the app is opened. It never swaps versions under a page that is in use.
//   3. Notifications: it shows what the cloud pushes, and opens the right page on tap.
//
// The list of files and the version are filled in at build time (tools/serviceWorkerPlugin.ts).

import { addressOf, pickWindow, readMessage, safeRoute } from './notify'
import { answerFor, neverChanges, PAGE } from './shell'

declare const self: ServiceWorkerGlobalScope
declare const __SW_FILES__: string[]
declare const __SW_VERSION__: string

const VERSION = __SW_VERSION__
const FILES = __SW_FILES__
const PREFIX = 'whisperus-shell-'
const CACHE = PREFIX + VERSION
/** How long opening the app waits for a fresh page before it uses the saved one. */
const PATIENCE_MS = 3000

const scope = self.registration.scope
const files = new Set(FILES)
const at = (file: string) => new URL(file, scope).href

// ------------------------------------------------------------------ offline --

async function saveShell(): Promise<void> {
  const cache = await caches.open(CACHE)
  await Promise.all(
    FILES.map(async (file) => {
      const url = at(file)
      if (neverChanges(file)) {
        // Already saved by the version before this one (or by an earlier try): keep it.
        const kept = await caches.match(url)
        if (kept) return cache.put(url, kept)
      }
      // "reload" skips the browser's own cache, so a new version never saves an old page.
      const fresh = await fetch(new Request(url, { cache: neverChanges(file) ? 'default' : 'reload' }))
      if (!fresh.ok) throw new Error(`${file}: ${fresh.status}`)
      await cache.put(url, fresh)
    }),
  )
}

self.addEventListener('install', (event) => {
  // No skipWaiting here: a running page keeps the version it started with.
  event.waitUntil(saveShell())
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const name of await caches.keys()) {
        if (name.startsWith(PREFIX) && name !== CACHE) await caches.delete(name)
      }
      await self.clients.claim()
    })(),
  )
})

const saved = async (file: string): Promise<Response | undefined> => (await caches.open(CACHE)).match(at(file))

/** Opening the app: the newest page when the network answers in time, else the saved one. */
async function page(request: Request): Promise<Response> {
  const copy = await saved(PAGE)
  if (!copy) return fetch(request)
  try {
    const fresh = await new Promise<Response>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('slow')), PATIENCE_MS)
      fetch(request.url, { cache: 'no-cache' }).then(
        (response) => {
          clearTimeout(timer)
          resolve(response)
        },
        (error: unknown) => {
          clearTimeout(timer)
          reject(error instanceof Error ? error : new Error(String(error)))
        },
      )
    })
    return fresh.ok ? fresh : copy
  } catch {
    return copy
  }
}

self.addEventListener('fetch', (event) => {
  const answer = answerFor(event.request, scope, files)
  if (answer.kind === 'pass') return
  if (answer.kind === 'page') return event.respondWith(page(event.request))
  const { file } = answer
  event.respondWith(saved(file).then((copy) => copy ?? fetch(event.request)))
})

// ------------------------------------------------------------------ updates --

self.addEventListener('message', (event) => {
  const type = (event.data as { type?: string } | null)?.type
  // The page asks which version this worker carries.
  if (type === 'version') event.ports[0]?.postMessage(VERSION)
  // The person tapped "Reload" (or the page already runs this version): take over now.
  if (type === 'activate') void self.skipWaiting()
})

// ------------------------------------------------------------ notifications --

self.addEventListener('push', (event) => {
  let data: unknown = null
  try {
    data = event.data?.json()
  } catch {
    /* not ours, or not readable: the fallback is shown */
  }
  const message = readMessage(data)
  const options: NotificationOptions & { renotify: boolean } = {
    body: message.body,
    icon: at('icons/icon-192.png'),
    badge: at('icons/badge-96.png'),
    tag: message.tag,
    // A newer notification about the same envelope replaces the older one, and still rings.
    renotify: true,
    data: { route: message.route },
  }
  event.waitUntil(self.registration.showNotification(message.title, options))
})

async function openApp(route: string): Promise<void> {
  const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
  const open = windows[pickWindow(windows, scope)]
  if (!open) {
    await self.clients.openWindow(addressOf(route, scope))
    return
  }
  // The running app goes to the page itself, so its own "back" keeps working.
  open.postMessage({ type: 'open', route })
  await open.focus().catch(() => undefined)
}

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const route = safeRoute((event.notification.data as { route?: unknown } | null)?.route)
  event.waitUntil(openApp(route))
})
