import { expect, type APIRequestContext, type Browser, type BrowserContext, type Page } from '@playwright/test'

// Shared by the specs: phones, a room for two, and the way through the booth.
// Everything here talks to the dev server and its pretend cloud. Nothing leaves the machine.

export type Kit = {
  db: any
  store: any
  sync: any
  backend: any
  push: any
  actions: any
  navigate(path: string): void
  announceUpdate(): void
}

/** The app's development hooks, once the page has set them up. */
export async function kit(page: Page) {
  await page.waitForFunction(() => Boolean((window as unknown as { __whisperus?: Kit }).__whisperus))
  return page.evaluateHandle(() => (window as unknown as { __whisperus: Kit }).__whisperus)
}

/** The newest toast with exactly this text. */
export const toast = (page: Page, text: string | RegExp) => page.getByText(text, { exact: true }).last()
export const tabs = (page: Page) => page.getByRole('navigation', { name: /^(Main|Hauptnavigation)$/ })
export const next = (page: Page) => page.getByRole('button', { name: 'Next', exact: true }).click()

export const MIA = { name: 'Mia', pin: '271828', room: 'Room 12' }
export const LEO = { name: 'Leo', pin: '314159' }

export interface PhoneOptions {
  lang?: 'en' | 'de'
  theme?: 'light' | 'dark'
}

/** A fresh phone: its own storage, a microphone that hums, a clipboard. Closed again by the spec. */
export async function openPhone(browser: Browser, contexts: BrowserContext[], options: PhoneOptions = {}): Promise<Page> {
  const context = await browser.newContext({ permissions: ['microphone', 'clipboard-read', 'clipboard-write'] })
  contexts.push(context)
  await context.addInitScript(
    ([lang, theme]) => {
      if (!localStorage.getItem('whisperus.lang')) localStorage.setItem('whisperus.lang', lang)
      if (!localStorage.getItem('whisperus.theme')) localStorage.setItem('whisperus.theme', theme)
    },
    [options.lang ?? 'en', options.theme ?? 'light'] as const,
  )
  return context.newPage()
}

export const resetCloud = (request: APIRequestContext) => request.post('/__cloud/reset')

async function pin(page: Page, value: string): Promise<void> {
  await page.getByLabel('PIN', { exact: true }).fill(value)
  await page.getByLabel('Repeat PIN', { exact: true }).fill(value)
}

/** She opens the room through the wizard. Ends on "Your room is open" and returns the invite link. */
export async function openRoom(page: Page, who = MIA): Promise<string> {
  await page.goto('/#/')
  await page.getByRole('button', { name: 'Start from scratch' }).click()
  await page.getByLabel('Your name').fill(who.name)
  await page.getByLabel('Room name').fill(who.room)
  await next(page)
  await next(page)
  await pin(page, who.pin)
  await page.getByRole('button', { name: 'Open the room' }).click()
  await expect(page.getByRole('heading', { name: 'Your room is open' })).toBeVisible()
  return (await page.getByTestId('qr').getAttribute('data-qr-value')) ?? ''
}

/** He joins through her invite link. Ends inside the app. */
export async function joinByLink(page: Page, link: string, who = LEO): Promise<void> {
  await page.goto(link)
  await expect(page.getByTestId('invitation')).toBeVisible()
  await page.getByLabel('Your name').fill(who.name)
  await next(page)
  await next(page)
  await pin(page, who.pin)
  await page.getByRole('button', { name: 'Join the room' }).click()
  await expect(tabs(page)).toBeVisible()
}

/**
 * Two phones in one room in the pretend cloud: Mia opens it (so she is its admin), Leo
 * joins by her link. Reset the cloud first with resetCloud(request).
 */
export async function makeCouple(browser: Browser, contexts: BrowserContext[], options: PhoneOptions = {}): Promise<{ mia: Page; leo: Page }> {
  const mia = await openPhone(browser, contexts, options)
  const leo = await openPhone(browser, contexts, options)
  await joinByLink(leo, await openRoom(mia))
  await expect(mia.getByTestId('partner-joined')).toContainText('Leo is in')
  await mia.getByRole('button', { name: 'Done' }).click()
  await expect(tabs(mia)).toBeVisible()
  return { mia, leo }
}

/** Wait until everything this device changed has reached the cloud, voice notes included. */
export async function settle(page: Page): Promise<void> {
  const k = await kit(page)
  await expect
    .poll(
      () =>
        k.evaluate(async (app) => {
          await app.sync.sync()
          return (await app.db.outbox.count()) + (await app.db.blobs.where('pending').equals(1).count())
        }),
      { timeout: 30_000 },
    )
    .toBe(0)
}

/** Run one sync pass now, instead of waiting for the next one. */
export const syncNow = async (page: Page) => (await kit(page)).evaluate((app) => app.sync.sync())

export interface BoothOptions {
  words?: string
  /** Record a short voice note with the pretend microphone. */
  voice?: boolean
  /** Heat 1 to 5, and how easy it was to say, 1 to 5. */
  heat?: number
  ease?: number
  /** Reasons to tap, by their words. */
  why?: string[]
  ownWord?: string
  teaser?: string
  wants?: RegExp
  when?: 'When I say' | 'At a time' | 'Right away'
  once?: boolean
}

/**
 * Go to a page of the app the way a tap on a button does: through the app's own router.
 * Nothing is asked of the server, so it works offline too, and no page holds it back
 * (an address typed by hand can be: a form with unsaved words asks first).
 */
export async function go(page: Page, path: string): Promise<void> {
  const k = await kit(page)
  await k.evaluate((app, to) => app.navigate(to), path)
}

/** Go through the booth on this phone and seal. Ends on the envelope's own page and returns its id. */
export async function sealInBooth(page: Page, options: BoothOptions = {}): Promise<string> {
  await go(page, '/booth')
  await expect(page.getByTestId('booth-say')).toBeVisible()
  if (options.words !== undefined) await page.getByLabel('Your words').fill(options.words)
  if (options.voice) {
    await page.getByRole('button', { name: 'Record', exact: true }).click()
    // The recorder counts the seconds: wait for the first one to show, then stop.
    await expect(page.getByTestId('recorder')).toContainText('0:01', { timeout: 15_000 })
    await page.getByRole('button', { name: 'Stop', exact: true }).click()
    await expect(page.getByTestId('player')).toBeVisible()
  }
  await next(page)
  await expect(page.getByTestId('booth-feel')).toBeVisible()
  if (options.heat) await page.getByRole('radio', { name: new RegExp(`^${options.heat}:`) }).click()
  if (options.ease) await page.getByRole('radio', { name: new RegExp(`^${options.ease} / 5`) }).click()
  for (const reason of options.why ?? []) await page.getByRole('button', { name: reason, exact: true }).click()
  if (options.ownWord) {
    await page.getByLabel('In your own words').fill(options.ownWord)
    await page.getByRole('button', { name: 'Add', exact: true }).click()
  }
  await next(page)
  await expect(page.getByTestId('booth-seal')).toBeVisible()
  if (options.teaser !== undefined) await page.getByLabel('A line on the envelope').fill(options.teaser)
  if (options.wants) await page.getByRole('radio', { name: options.wants }).click()
  if (options.when) await page.getByRole('radio', { name: options.when, exact: true }).click()
  if (options.once) await page.getByRole('radio', { name: 'One opening', exact: true }).click()
  await page.getByRole('button', { name: 'Seal it', exact: true }).click()
  await expect(page.getByTestId('envelope-mine')).toBeVisible({ timeout: 15_000 })
  const id = /#\/envelope\/([0-9a-f-]{36})/.exec(page.url())?.[1]
  if (!id) throw new Error(`sealing did not land on an envelope page: ${page.url()}`)
  return id
}

/** Everything the pretend cloud holds about one row, as text: for "is it in there anywhere?". */
export async function cloudHolds(request: APIRequestContext, table: string, id: string): Promise<string> {
  const answer = await request.get(`/__cloud/peek?table=${table}&id=${id}`)
  return answer.text()
}
