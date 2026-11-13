import { expect, test, workerInCharge } from './fixtures'

// What Chrome needs to offer "Install app": a manifest it can read without complaints,
// under the right address, with icons that exist, and a service worker in charge.

test('Chrome finds the app installable: manifest, icons and worker are in order', async ({ page, context }) => {
  await page.goto('./')
  await expect(page.getByTestId('welcome')).toBeVisible()
  await workerInCharge(page)
  const home = new URL('./', page.url()).href

  const tools = await context.newCDPSession(page)
  const seen = (await tools.send('Page.getAppManifest')) as { url: string; errors: unknown[]; data?: string }
  expect(seen.url).toBe(`${home}manifest.webmanifest`)
  expect(seen.errors).toEqual([])
  // The only thing in the way is the test itself: its browser window is a private one.
  const { installabilityErrors } = (await tools.send('Page.getInstallabilityErrors')) as { installabilityErrors: { errorId: string }[] }
  expect(installabilityErrors.map((e) => e.errorId).filter((id) => id !== 'in-incognito')).toEqual([])
  // Installed, it is this app and no other on the same site.
  expect(((await tools.send('Page.getAppId')) as { appId?: string }).appId).toBe(home)

  const manifest = (await (await page.request.get(`${home}manifest.webmanifest`)).json()) as {
    name: string
    short_name: string
    start_url: string
    scope: string
    display: string
    theme_color: string
    background_color: string
    icons: { src: string; sizes: string; type: string; purpose: string }[]
  }
  expect(manifest).toMatchObject({ name: 'WhisperUs', short_name: 'WhisperUs', display: 'standalone' })
  // Start and scope sit under the app's own path, wherever it is hosted.
  expect(new URL(manifest.start_url, seen.url).href).toBe(home)
  expect(new URL(manifest.scope, seen.url).href).toBe(home)
  // The colour of the room after dark, from the design tokens: the splash screen and the
  // bar on top are quiet, whatever the time of day.
  expect(manifest.background_color.toLowerCase()).toBe('#1b1220')
  expect(manifest.theme_color.toLowerCase()).toBe('#1b1220')

  expect(manifest.icons.map((icon) => `${icon.purpose} ${icon.sizes}`).sort()).toEqual(['any 192x192', 'any 512x512', 'maskable 192x192', 'maskable 512x512'])
  for (const icon of manifest.icons) {
    const size = await page.evaluate(async (url) => {
      const image = await createImageBitmap(await (await fetch(url)).blob())
      return `${image.width}x${image.height}`
    }, new URL(icon.src, seen.url).href)
    expect(size, icon.src).toBe(icon.sizes)
  }
})

// Discretion: the installed app keeps to itself. It does not offer itself in other apps'
// share sheets, has no shortcuts that say what is in it, and asks search engines to stay away.
test('the installed app keeps to itself', async ({ page }) => {
  await page.goto('./')
  await expect(page.getByTestId('welcome')).toBeVisible()
  const home = new URL('./', page.url()).href
  const manifest = (await (await page.request.get(`${home}manifest.webmanifest`)).json()) as Record<string, unknown>
  for (const loud of ['share_target', 'shortcuts', 'screenshots', 'related_applications', 'protocol_handlers', 'file_handlers']) expect(manifest, loud).not.toHaveProperty(loud)
  expect(String(manifest.description)).toBe('A private room for two.')
  expect(await page.locator('meta[name="robots"]').getAttribute('content')).toContain('noindex')
  expect(await page.title()).toBe('WhisperUs')
})
