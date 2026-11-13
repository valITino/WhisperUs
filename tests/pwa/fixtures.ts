import { test as base, expect, type Page, type Worker } from '@playwright/test'

// Shared by the installed-app tests. A production build talks to a real cloud, so every
// browser here is fenced in: a request that does not go to the preview server is cut off
// before it leaves the machine. (The build under test is made with an address that leads
// nowhere anyway: npm run build:test.)

export const test = base.extend({
  context: async ({ context, baseURL }, use) => {
    const home = new URL(baseURL as string).host
    await context.route(
      (url) => url.host !== home,
      (route) => route.abort('blockedbyclient'),
    )
    await context.addInitScript(() => {
      if (!localStorage.getItem('whisperus.lang')) localStorage.setItem('whisperus.lang', 'en')
      if (!localStorage.getItem('whisperus.theme')) localStorage.setItem('whisperus.theme', 'light')
    })
    await use(context)
  },
})

export { expect }

/** The build this page belongs to, as written into index.html. */
export const pageVersion = (page: Page): Promise<string | null> => page.evaluate(() => document.querySelector('meta[name="app-version"]')?.getAttribute('content') ?? null)

/** Wait until the service worker has saved the app and is in charge of this page. */
export async function workerInCharge(page: Page): Promise<void> {
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready
    if (!navigator.serviceWorker.controller) await new Promise((resolve) => navigator.serviceWorker.addEventListener('controllerchange', resolve, { once: true }))
  })
}

/** The service worker itself, to look around inside it. */
export async function theWorker(page: Page): Promise<Worker> {
  const context = page.context()
  await workerInCharge(page)
  const found = context.serviceWorkers().find((w) => w.url().endsWith('/sw.js'))
  return found ?? context.waitForEvent('serviceworker')
}

export const ROOM = {
  household: '11111111-1111-4111-8111-111111111111',
  mia: '22222222-2222-4222-8222-222222222222',
  leo: '33333333-3333-4333-8333-333333333333',
  envelope: '0f8fad5b-d9cb-469f-a165-70867728950e',
}

/**
 * Put a room on this phone the way a login would have left it: Leo is logged in, Mia is
 * the other one, and one envelope of hers waits for her hand. No cloud is needed for
 * that (there is none here), and a paired phone starts from its own copy. The page has to
 * be open once before, so the app has made its database. Ends inside the app.
 */
export async function seedRoom(page: Page): Promise<void> {
  await page.evaluate(async (room) => {
    const request = indexedDB.open('whisperus')
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    const at = new Date().toISOString()
    const row = { householdId: room.household, createdAt: at, updatedAt: at, deletedAt: null }
    const person = { ...row, color: 'candle', accessory: null, status: null, prefs: {}, isAdmin: false, disabledAt: null }
    const writes: [store: string, value: unknown][] = [
      ['meta', { key: 'me.householdId', value: room.household }],
      ['meta', { key: 'me.memberId', value: room.leo }],
      ['households', { id: room.household, name: 'Room 12', createdAt: at, updatedAt: at, deletedAt: null }],
      ['members', { ...person, id: room.mia, name: 'Mia', avatar: 'moon', isAdmin: true }],
      ['members', { ...person, id: room.leo, name: 'Leo', avatar: 'sun', color: 'plum' }],
      ['envelopes', { ...row, id: room.envelope, authorId: room.mia, kind: 'confession', teaser: 'About Saturday', heatOutside: null, wants: 'listen', keep: 'keep', openMode: 'hand', opensAt: null, layers: {}, seen: {}, reply: null }],
    ]
    const tx = db.transaction([...new Set(writes.map(([store]) => store))], 'readwrite')
    for (const [store, value] of writes) tx.objectStore(store).put(value)
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
    db.close()
  }, ROOM)
  await page.reload()
  await expect(page.getByRole('navigation', { name: /^(Main|Hauptnavigation)$/ })).toBeVisible()
}
