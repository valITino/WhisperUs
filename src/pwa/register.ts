// Registers the service worker (production builds only, see main.tsx) and watches for
// new versions.
//
// The rule for updates: the page never reloads by itself. When a newer version has been
// installed and is waiting, the app shows a note with a "Reload" button. Only that tap,
// or closing and reopening the app, switches versions.
//
// One wrinkle: opening the app online always fetches the newest page (the worker prefers
// a fresh page over its saved one). So right after a deploy the page can already be the
// new version while the worker that saved the old one is still in charge. Then there is
// nothing to tell the person: the page quietly lets the matching worker take over.

import { navigate } from '../app/router'
import { announceUpdate, pageVersion } from './update'

/** Ask a worker which version it carries. Null when it does not answer. */
function versionOf(worker: ServiceWorker): Promise<string | null> {
  return new Promise((resolve) => {
    const channel = new MessageChannel()
    const giveUp = setTimeout(() => resolve(null), 3000)
    channel.port1.onmessage = (event) => {
      clearTimeout(giveUp)
      resolve(typeof event.data === 'string' ? event.data : null)
    }
    worker.postMessage({ type: 'version' }, [channel.port2])
  })
}

export function startServiceWorker(): void {
  if (!('serviceWorker' in navigator)) return
  const workers = navigator.serviceWorker
  const mine = pageVersion()
  /** True once the person tapped "Reload": the next change of worker reloads the page. */
  let reloadAsked = false

  workers.addEventListener('controllerchange', () => {
    if (reloadAsked) return window.location.reload()
    // Another window switched versions under this one: offer the same step here.
    const now = workers.controller
    if (now) void versionOf(now).then((theirs) => theirs !== mine && announceUpdate())
  })

  // A tap on a notification while the app is open: the worker asks us to show the page.
  workers.addEventListener('message', (event) => {
    const data = event.data as { type?: string; route?: unknown } | null
    if (data?.type === 'open' && typeof data.route === 'string') navigate(data.route)
  })

  const base = import.meta.env.BASE_URL
  void workers
    .register(`${base}sw.js`, { scope: base, updateViaCache: 'none' })
    .then((registration) => {
      const look = async () => {
        const waiting = registration.waiting
        if (!waiting) return
        if ((await versionOf(waiting)) === mine) {
          // This page is already the new version: nothing to reload, just hand over.
          waiting.postMessage({ type: 'activate' })
          return
        }
        announceUpdate(() => {
          const next = registration.waiting
          if (!next) return window.location.reload()
          reloadAsked = true
          next.postMessage({ type: 'activate' })
          // Should the hand-over get stuck, reload anyway: the tap must do something.
          setTimeout(() => window.location.reload(), 4000)
        })
      }

      void look()
      registration.addEventListener('updatefound', () => {
        const next = registration.installing
        next?.addEventListener('statechange', () => {
          if (next.state === 'installed') void look()
        })
      })

      // The browser checks for a new version when the app is opened. An app that stays
      // open for days checks again whenever it comes back to the front.
      let lastCheck = Date.now()
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState !== 'visible' || !navigator.onLine || Date.now() - lastCheck < 60_000) return
        lastCheck = Date.now()
        void registration.update().catch(() => undefined)
      })
    })
    .catch(() => {
      /* no service worker (private window, old browser): the app still works online */
    })
}
