import { readFileSync, writeFileSync } from 'node:fs'
import { expect, pageVersion, ROOM, seedRoom, test, theWorker, workerInCharge } from './fixtures'

// The app as an installed app: it opens without a connection, and it says so when a new
// version has been deployed. Run against the production build (see playwright.pwa.config.ts).

test('opens with no connection once it has been opened online', async ({ page, context }) => {
  await page.goto('./')
  await expect(page.getByTestId('welcome')).toBeVisible()
  const version = await pageVersion(page)
  expect(version).toMatch(/^[0-9a-f]{16}$/)
  const worker = await theWorker(page)

  // Only the app itself is saved: one shelf, every file from this site, nothing from a cloud.
  const shelf = await page.evaluate(async () => {
    const names = await caches.keys()
    const urls = (await Promise.all(names.map(async (name) => (await (await caches.open(name)).keys()).map((r) => r.url)))).flat()
    return { names, urls }
  })
  expect(shelf.names).toEqual([`whisperus-shell-${version}`])
  const home = new URL(page.url())
  expect(shelf.urls.length).toBeGreaterThan(10)
  expect(shelf.urls.filter((url) => !url.startsWith(`${home.origin}${home.pathname}`))).toEqual([])
  expect(shelf.urls.filter((url) => /__cloud|supabase|\.map$/.test(url))).toEqual([])
  for (const file of ['index.html', 'manifest.webmanifest', 'icons/icon-192.png', 'icons/maskable-512.png']) {
    expect(shelf.urls, file).toContain(`${home.origin}${home.pathname}${file}`)
  }

  await context.setOffline(true)
  // Really offline, for the page and for the worker: neither can fetch anything now.
  const unreachable = () => fetch(`./?${Math.random()}`, { cache: 'no-store' }).then(() => false, () => true)
  expect(await worker.evaluate(unreachable)).toBe(true)
  expect(await page.evaluate(() => fetch('./not-saved.txt', { cache: 'no-store' }).then(() => false, () => true))).toBe(true)

  await page.reload()
  await expect(page.getByTestId('welcome')).toBeVisible()
  await expect(page.getByRole('heading', { level: 1, name: 'WhisperUs' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Start from scratch' })).toBeVisible()
  // Styles and fonts came along, not just the page.
  expect(await page.evaluate(() => document.fonts.ready.then(() => [...document.fonts].filter((f) => f.status === 'loaded').length))).toBeGreaterThan(0)
  expect(await page.evaluate(() => getComputedStyle(document.body).fontFamily)).toContain('Figtree')
  expect(await pageVersion(page)).toBe(version)

})

test('a phone that is logged in opens its room with no connection, deep links included', async ({ page, context }) => {
  await page.goto('./')
  await expect(page.getByTestId('welcome')).toBeVisible()
  await workerInCharge(page)
  await seedRoom(page)

  await context.setOffline(true)
  await page.reload()
  await expect(page.getByTestId('home')).toBeVisible()
  await expect(page.getByTestId('for-me').getByTestId('envelope-row')).toContainText('About Saturday')
  // Straight to a page inside, as a tapped notification would.
  await page.goto(`./#/envelope/${ROOM.envelope}`)
  await page.reload()
  await expect(page.getByTestId('waiting-line')).toHaveText('It opens when Mia is ready.')
  await page.goto('./#/settings')
  await page.reload()
  await expect(page.getByRole('heading', { level: 1, name: 'Us' })).toBeVisible()
  await expect(page.getByTestId('sync-words')).toContainText('Offline')
})

test('a connection that hangs does not keep the app from opening', async ({ page, context }) => {
  await page.goto('./')
  await expect(page.getByTestId('welcome')).toBeVisible()
  await workerInCharge(page)

  // The server takes far too long to hand out the page. The worker waits a moment for a
  // fresh one, then opens the app from its saved copy.
  let held = 0
  await context.route(
    (url) => url.pathname.endsWith('/WhisperUs/'),
    async (route) => {
      held += 1
      await new Promise((resolve) => setTimeout(resolve, 20_000))
      await route.abort().catch(() => undefined)
    },
  )
  const started = Date.now()
  await page.reload()
  await expect(page.getByTestId('welcome')).toBeVisible()
  expect(held).toBeGreaterThan(0)
  expect(Date.now() - started).toBeLessThan(10_000)
})

test.describe('a new version', () => {
  // Stand in for a deploy: the same app under a new version, written over the build the
  // preview server hands out. Put back afterwards.
  const files = ['dist/sw.js', 'dist/index.html']
  let originals: string[] = []
  test.beforeEach(() => {
    originals = files.map((file) => readFileSync(file, 'utf8'))
  })
  test.afterEach(() => {
    files.forEach((file, i) => writeFileSync(file, originals[i]))
  })
  const deploy = (from: string, to: string) => files.forEach((file, i) => writeFileSync(file, originals[i].replaceAll(from, to)))

  test('shows a note with a reload button, and never reloads by itself', async ({ page }) => {
    await page.goto('./')
    await expect(page.getByTestId('welcome')).toBeVisible()
    await workerInCharge(page)
    const before = (await pageVersion(page)) as string
    const after = 'feedfacecafe2026'
    const note = page.getByTestId('update-note')
    await expect(note).toBeHidden()

    // Something the person is in the middle of. A reload would wipe it.
    await page.evaluate(() => Object.assign(window, { inTheMiddleOfSomething: true }))

    deploy(before, after)
    await page.evaluate(async () => (await navigator.serviceWorker.getRegistration())?.update())

    await expect(note).toBeVisible()
    await expect(note).toContainText('A new version is ready.')
    // The new version waits. The page is still the old one, untouched.
    expect(await page.evaluate(() => (window as unknown as { inTheMiddleOfSomething?: boolean }).inTheMiddleOfSomething)).toBe(true)
    expect(await pageVersion(page)).toBe(before)
    expect(await page.evaluate(async () => Boolean((await navigator.serviceWorker.getRegistration())?.waiting))).toBe(true)

    await note.getByRole('button', { name: 'Reload' }).click()
    // (The page is reloading while we look, so a look can come back empty-handed.)
    await expect.poll(() => pageVersion(page).catch(() => null)).toBe(after)
    await expect(page.getByTestId('welcome')).toBeVisible()
    await expect(note).toBeHidden()
    expect(await page.evaluate(() => (window as unknown as { inTheMiddleOfSomething?: boolean }).inTheMiddleOfSomething)).toBeUndefined()
    // The old shelf is gone, the new one is in.
    await expect.poll(() => page.evaluate(() => caches.keys())).toEqual([`whisperus-shell-${after}`])
  })

  test('says nothing when the page is already the new version', async ({ page }) => {
    await page.goto('./')
    await expect(page.getByTestId('welcome')).toBeVisible()
    await workerInCharge(page)
    const before = (await pageVersion(page)) as string
    const after = 'cafe2026feedface'

    // Deployed while the app was closed. Opening it online fetches the new page straight
    // away, while the worker that saved the old version is still in charge.
    deploy(before, after)
    await page.reload()
    await expect(page.getByTestId('welcome')).toBeVisible()
    expect(await pageVersion(page)).toBe(after)

    // The matching worker takes over quietly: no note, no reload.
    await expect.poll(() => page.evaluate(() => caches.keys())).toEqual([`whisperus-shell-${after}`])
    await expect(page.getByTestId('update-note')).toBeHidden()
  })

  test('"Later" puts the note away and the new version waits for the next start', async ({ page }) => {
    await page.goto('./')
    await expect(page.getByTestId('welcome')).toBeVisible()
    await workerInCharge(page)
    const before = (await pageVersion(page)) as string
    const note = page.getByTestId('update-note')

    deploy(before, 'beef2026cafefeed')
    await page.evaluate(async () => (await navigator.serviceWorker.getRegistration())?.update())
    await expect(note).toBeVisible()
    await note.getByRole('button', { name: 'Later' }).click()
    await expect(note).toBeHidden()
    expect(await pageVersion(page)).toBe(before)
    expect(await page.evaluate(async () => Boolean((await navigator.serviceWorker.getRegistration())?.waiting))).toBe(true)
  })
})
