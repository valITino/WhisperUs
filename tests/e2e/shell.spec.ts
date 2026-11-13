import { expect, test, type BrowserContext } from '@playwright/test'
import { go, makeCouple, resetCloud, sealInBooth, tabs } from './ship.helpers'

// Things every screen shares: the bar at the bottom, sheets and the phone's back button.

const contexts: BrowserContext[] = []
test.afterEach(async () => {
  for (const context of contexts.splice(0)) await context.close()
})

test('the bar: two places and, between them, the seal that leads into the booth', async ({ browser, request }) => {
  await resetCloud(request)
  const { mia } = await makeCouple(browser, contexts)
  await mia.goto('/#/')
  const bar = tabs(mia)
  await expect(bar.getByRole('button')).toHaveCount(3)
  for (const name of ['Room', 'Us', 'Step into the booth']) await expect(bar.getByRole('button', { name, exact: true })).toBeVisible()
  await expect(bar.getByRole('button', { name: 'Room', exact: true })).toHaveAttribute('aria-current', 'page')

  await bar.getByRole('button', { name: 'Us', exact: true }).click()
  await expect(mia).toHaveURL(/#\/settings$/)
  await expect(mia.getByRole('heading', { level: 1, name: 'Us' })).toBeVisible()
  await expect(bar.getByRole('button', { name: 'Us', exact: true })).toHaveAttribute('aria-current', 'page')

  await bar.getByRole('button', { name: 'Step into the booth' }).click()
  await expect(mia).toHaveURL(/#\/booth$/)
  // The booth is a place to be alone with one's words: no bar, nothing else to tap.
  await expect(tabs(mia)).toHaveCount(0)
  // And the phone's back button leads out of it again.
  await mia.goBack()
  await expect(mia).toHaveURL(/#\/settings$/)
  await expect(tabs(mia)).toBeVisible()
})

test("Android's back button closes a sheet instead of leaving the page, and steps back in the booth", async ({ browser, request }) => {
  await resetCloud(request)
  const { mia } = await makeCouple(browser, contexts)
  const id = await sealInBooth(mia, { words: 'For the back button.' })
  await expect(mia).toHaveURL(new RegExp(`#/envelope/${id}$`))

  await mia.getByRole('button', { name: 'Open it for Leo' }).click()
  const sheet = mia.getByRole('dialog')
  await expect(sheet).toBeVisible()
  await mia.goBack()
  await expect(sheet).toBeHidden()
  await expect(mia).toHaveURL(new RegExp(`#/envelope/${id}$`))
  await expect(mia.getByTestId('envelope-mine')).toBeVisible()

  // Closed with its own button: no dead step is left in the history.
  await mia.getByRole('button', { name: 'Open it for Leo' }).click()
  await sheet.getByRole('button', { name: 'Not yet' }).click()
  await expect(sheet).toBeHidden()
  expect(await mia.evaluate(() => (window.history.state as { layer?: number } | null)?.layer)).toBeUndefined()

  // Open, back, open, back: the sheet answers every time.
  for (let round = 0; round < 2; round++) {
    await mia.getByRole('button', { name: 'Open it for Leo' }).click()
    await expect(sheet).toBeVisible()
    await mia.goBack()
    await expect(sheet).toBeHidden()
    await expect(mia).toHaveURL(new RegExp(`#/envelope/${id}$`))
  }

  // In the booth, back is the previous step before it is the way out.
  await go(mia, '/')
  await tabs(mia).getByRole('button', { name: 'Step into the booth' }).click()
  await mia.getByLabel('Your words').fill('Step by step.')
  await mia.getByRole('button', { name: 'Next', exact: true }).click()
  await expect(mia.getByTestId('booth-step')).toHaveText('Step 2 of 3')
  await mia.goBack()
  await expect(mia.getByTestId('booth-step')).toHaveText('Step 1 of 3')
  await expect(mia.getByLabel('Your words')).toHaveValue('Step by step.')
  await mia.goBack()
  await expect(mia.getByTestId('home')).toBeVisible()
})

test('an address that leads nowhere goes home', async ({ browser, request }) => {
  await resetCloud(request)
  const { leo } = await makeCouple(browser, contexts)
  await leo.goto('/#/no/such/page')
  await expect(leo).toHaveURL(/#\/$/)
  await expect(leo.getByTestId('home')).toBeVisible()
  await expect(leo.getByRole('heading', { level: 1 })).toContainText('Leo')
  await expect(tabs(leo)).toBeVisible()

  // An envelope that never existed says so, and offers the way back.
  await leo.goto('/#/envelope/0f8fad5b-d9cb-469f-a165-70867728950e')
  await expect(leo.getByTestId('envelope-gone')).toBeVisible()
  await leo.getByRole('button', { name: 'Back to the room' }).click()
  await expect(leo.getByTestId('home')).toBeVisible()
})
