import type { CDPSession, Page } from '@playwright/test'
import { expect, ROOM, seedRoom, test, theWorker, workerInCharge } from './fixtures'

// What the service worker does with a push: show it, and open the right page on a tap.
// A real push service cannot be reached from a test, so its last step is played by the
// browser's own developer tools: they hand the worker a push message as the push service
// would. The message is what supabase/functions/push writes (tests/unit/push.*.test.ts).

const ENVELOPE = ROOM.envelope

interface Shown {
  title: string
  body: string
  tag: string
  icon: string
  data: unknown
}

async function openApp(page: Page): Promise<CDPSession> {
  await page.context().grantPermissions(['notifications'])
  await page.goto('./')
  await expect(page.getByTestId('welcome')).toBeVisible()
  await workerInCharge(page)
  // A phone that is logged in: a full app with its room, and no cloud to talk to.
  await seedRoom(page)
  const tools = await page.context().newCDPSession(page)
  return tools
}

/** Hand the worker a push message, the way the push service does. */
async function push(page: Page, tools: CDPSession, data: unknown): Promise<void> {
  const registration = new Promise<string>((resolve) => {
    tools.on('ServiceWorker.workerRegistrationUpdated', (event: { registrations: { registrationId: string; scopeURL: string }[] }) => {
      const mine = event.registrations.find((r) => page.url().startsWith(r.scopeURL))
      if (mine) resolve(mine.registrationId)
    })
  })
  await tools.send('ServiceWorker.enable')
  await tools.send('ServiceWorker.deliverPushMessage', { origin: new URL(page.url()).origin, registrationId: await registration, data: typeof data === 'string' ? data : JSON.stringify(data) })
  await tools.send('ServiceWorker.disable')
}

/**
 * Hand the worker a message and wait for what should come of it. The developer tools are
 * not the push service: a worker that is just starting can miss what they hand it (seen
 * once on the build server, on the first message of a fresh browser). So the message is
 * handed over again until its notification is there. Every message carries a tag, and the
 * same tag replaces itself: handed over twice, it is still one notification.
 */
async function pushed(page: Page, tools: CDPSession, data: unknown, there: () => Promise<void>): Promise<void> {
  await expect(async () => {
    await push(page, tools, data)
    await there()
  }).toPass({ timeout: 20_000 })
}

/** How long one handing-over gets before the next one. */
const SOON = { timeout: 2500 }

const shown = (page: Page): Promise<Shown[]> =>
  page.evaluate(async () => {
    const registration = await navigator.serviceWorker.ready
    return (await registration.getNotifications()).map((n) => ({ title: n.title, body: n.body, tag: n.tag, icon: n.icon, data: n.data as unknown }))
  })

/** Tap the notification with this tag (the tap itself is played inside the worker). */
async function tap(page: Page, tag: string): Promise<void> {
  const worker = await theWorker(page)
  await worker.evaluate(async (wanted) => {
    const scope = self as unknown as ServiceWorkerGlobalScope
    const [notification] = await scope.registration.getNotifications({ tag: wanted })
    scope.dispatchEvent(new NotificationEvent('notificationclick', { notification }))
  }, tag)
}

test('a push becomes a notification with title, words, icon and one tag per envelope', async ({ page }) => {
  const tools = await openApp(page)
  const home = new URL('./', page.url()).href
  const sealed = { type: 'sealed', title: 'Something is waiting for you', body: 'Mia sealed something. It opens tonight at 22:00.', tag: `envelope-${ENVELOPE}`, url: `/envelope/${ENVELOPE}` }

  await pushed(page, tools, sealed, () => expect.poll(() => shown(page), SOON).toEqual([
    { title: sealed.title, body: sealed.body, tag: sealed.tag, icon: `${home}icons/icon-192.png`, data: { route: `/envelope/${ENVELOPE}` } },
  ]))

  // News about the same envelope replaces what is on screen; another envelope gets its own.
  await pushed(page, tools, { type: 'opened', title: 'It is open', body: "Mia's envelope is open for you now.", tag: `envelope-${ENVELOPE}`, url: `/envelope/${ENVELOPE}` }, () => expect.poll(async () => (await shown(page)).map((n) => n.title), SOON).toEqual(['It is open']))
  await pushed(page, tools, { type: 'answered', title: 'An answer for you', body: 'Mia answered your envelope.', tag: 'envelope-another', url: '/envelope/another' }, () => expect.poll(async () => (await shown(page)).map((n) => n.title).sort(), SOON).toEqual(['An answer for you', 'It is open']))

  // The icons it points to are part of the app.
  for (const icon of ['icons/icon-192.png', 'icons/badge-96.png']) {
    expect(await page.evaluate(async (url) => (await fetch(url)).headers.get('content-type'), `${home}${icon}`)).toBe('image/png')
  }
})

test('a message it cannot read still shows something discreet, and opens the app at home', async ({ page }) => {
  const tools = await openApp(page)
  await pushed(page, tools, 'not json at all', () => expect.poll(() => shown(page), SOON).toMatchObject([{ title: 'WhisperUs', body: 'Something is waiting for you.', data: { route: '/' } }]))
  await pushed(page, tools, { title: 'Hi', body: 'There', tag: 'x', url: 'https://evil.example/' }, () => expect.poll(async () => (await shown(page)).find((n) => n.title === 'Hi')?.data, SOON).toEqual({ route: '/' }))
})

test('tapping the notification takes the open app to the envelope and puts the notification away', async ({ page }) => {
  const tools = await openApp(page)
  const route = `/envelope/${ENVELOPE}`
  await pushed(page, tools, { type: 'sealed', title: 'Something is waiting for you', body: 'Mia sealed something. It opens when Mia is ready.', tag: 'envelope-tap', url: route }, () => expect.poll(async () => (await shown(page)).length, SOON).toBe(1))

  await tap(page, 'envelope-tap')
  await expect(page).toHaveURL(new RegExp(`#${route}$`))
  await expect(page.getByTestId('envelope-theirs')).toBeVisible()
  await expect.poll(async () => (await shown(page)).length).toBe(0)
  // The app got there by itself: its own "back" still leads home.
  await page.goBack()
  await expect(page).toHaveURL(/\/(#\/)?$/)
  await expect(page.getByRole('navigation', { name: /^(Main|Hauptnavigation)$/ })).toBeVisible()
})

test('a locked phone shows the notification, and the tap leads to the lock, not past it', async ({ page }) => {
  const tools = await openApp(page)
  // This device has an app lock.
  await page.goto('./#/settings/lock')
  await page.getByLabel('Code', { exact: true }).fill('864213')
  await page.getByLabel('Repeat code').fill('864213')
  await page.getByRole('button', { name: 'Turn on the app lock' }).click()
  await expect(page.getByTestId('lock-settings')).toHaveAttribute('data-lock', 'on')
  await page.getByRole('button', { name: 'Lock now' }).click()
  await expect(page.getByTestId('lock-screen')).toBeVisible()

  const route = `/envelope/${ENVELOPE}`
  await pushed(page, tools, { type: 'sealed', title: 'Something is waiting for you', body: 'Mia sealed something. It opens when Mia is ready.', tag: 'envelope-locked', url: route }, () => expect.poll(async () => (await shown(page)).length, SOON).toBe(1))
  await tap(page, 'envelope-locked')
  await expect(page).toHaveURL(new RegExp(`#${route}$`))
  // Whoever tapped still has to know the code.
  await expect(page.getByTestId('lock-screen')).toBeVisible()
  await expect(page.getByTestId('envelope-theirs')).toHaveCount(0)
  await page.getByLabel('Code', { exact: true }).fill('864213')
  await expect(page.getByTestId('envelope-theirs')).toBeVisible()
})
