import { expect, test, type BrowserContext, type Page } from '@playwright/test'
import { go, kit, makeCouple, resetCloud, sealInBooth, settle, toast, type Kit } from './ship.helpers'

// Two phones that are never online at the same moment. Everything is written on the
// phone first and travels when it can: an envelope sealed in a tunnel, a voice note, an
// answer typed on a plane.

const contexts: BrowserContext[] = []
test.afterEach(async () => {
  for (const context of contexts.splice(0)) await context.close()
})

const offline = (page: Page, yes: boolean) => page.context().setOffline(yes)
const waiting = async (page: Page) => (await kit(page)).evaluate(async (app: Kit) => (await app.db.outbox.count()) + (await app.db.blobs.where('pending').equals(1).count()))
const rows = (page: Page) => page.getByTestId('envelope-row')

test('two phones stay in step, even when one is offline and they are never online together', async ({ browser, request }) => {
  test.setTimeout(120_000)
  await resetCloud(request)
  const { mia, leo } = await makeCouple(browser, contexts)
  await leo.goto('/#/')
  let id = ''

  await test.step('her phone has no connection: she seals words and a voice note all the same', async () => {
    await offline(mia, true)
    id = await sealInBooth(mia, { words: 'Written in a tunnel.', voice: true, teaser: 'From the train', wants: /Tell me what it did to you/, when: 'Right away' })
    await expect(toast(mia, 'Sealed')).toBeVisible()
    await expect(mia.getByTestId('mine-line')).toHaveText('Open for Leo.')
    expect(await waiting(mia)).toBeGreaterThan(0)
    // Nothing has reached him, of course.
    await expect(rows(leo)).toHaveCount(0)
  })

  await test.step('"Us" says in plain words that it is offline and that nothing is lost', async () => {
    await go(mia, '/settings')
    await expect(mia.getByTestId('sync-words')).toContainText('Offline. Changes are saved on this device')
    await mia.getByTestId('sync-section').getByRole('button', { name: /^Sync details/ }).click()
    await expect(mia.getByTestId('sync-advice')).toContainText('no connection right now')
  })

  await test.step('his phone goes dark before hers comes back: everything goes up to the cloud', async () => {
    await offline(leo, true)
    await offline(mia, false)
    await settle(mia)
    expect(await waiting(mia)).toBe(0)
    await offline(mia, true)
  })

  await test.step('his phone wakes up while hers is off: the envelope is there, words, voice and all', async () => {
    await offline(leo, false)
    await expect(rows(leo)).toHaveCount(1, { timeout: 20_000 })
    await expect(rows(leo)).toContainText('From the train')
    await expect(rows(leo)).toContainText('Open for you')
    await rows(leo).click()
    await leo.getByRole('button', { name: 'Break the seal' }).click()
    await expect(leo.getByTestId('inside-words')).toContainText('Written in a tunnel.')
    await expect(leo.getByTestId('player')).toBeVisible({ timeout: 20_000 })
  })

  await test.step('he answers with no connection either', async () => {
    await offline(leo, true)
    const form = leo.getByTestId('reply-form')
    await form.getByRole('button', { name: /Tell me more/ }).click()
    await form.getByLabel('A sentence more, if you like').fill('Read on a plane.')
    await form.getByRole('button', { name: 'Send answer' }).click()
    await expect(leo.getByTestId('reply')).toContainText('Read on a plane.')
    expect(await waiting(leo)).toBeGreaterThan(0)
  })

  await test.step('his answer goes out when he lands, and reaches her when she is back', async () => {
    await offline(leo, false)
    await settle(leo)
    await offline(leo, true)

    await offline(mia, false)
    await go(mia, `/envelope/${id}`)
    await expect(mia.getByTestId('reply')).toContainText('Read on a plane.', { timeout: 20_000 })
    await go(mia, '/')
    await expect(mia.getByTestId('from-me').getByTestId('envelope-row')).toContainText('Leo answered')
  })

  await test.step('after closing and reopening the app, everything is still there', async () => {
    await offline(leo, false)
    await leo.reload()
    await expect(leo.getByTestId('inside-words')).toContainText('Written in a tunnel.')
    await expect(leo.getByTestId('player')).toBeVisible()
    await mia.reload()
    await expect(mia.getByTestId('from-me').getByTestId('envelope-row')).toHaveCount(1)
  })
})

test('a new answer is marked on the room until she has looked at it', async ({ browser, request }) => {
  await resetCloud(request)
  const { mia, leo } = await makeCouple(browser, contexts)
  const id = await sealInBooth(mia, { words: 'Short and sweet.', teaser: 'A small one', wants: /Tell me what it did to you/, when: 'Right away' })
  await settle(mia)
  await go(mia, '/')

  await leo.goto(`/#/envelope/${id}`)
  await leo.getByRole('button', { name: 'Break the seal' }).click()
  await leo.getByTestId('reply-form').getByRole('button', { name: /I melt/ }).click()
  await leo.getByTestId('reply-form').getByRole('button', { name: 'Send answer' }).click()
  await expect(toast(leo, 'Sent')).toBeVisible()

  const row = mia.getByTestId('from-me').getByTestId('envelope-row')
  await expect(row).toContainText('Leo answered', { timeout: 20_000 })
  await expect(row).toContainText('New')
  await row.click()
  await expect(mia.getByTestId('reply')).toContainText('I melt')
  await go(mia, '/')
  await expect(row).toContainText('Leo answered')
  await expect(row).not.toContainText('New')
})

test('something that opened for him shows as a number on the room, from any tab', async ({ browser, request }) => {
  await resetCloud(request)
  const { mia, leo } = await makeCouple(browser, contexts)
  await leo.goto('/#/settings')
  await sealInBooth(mia, { words: 'Look at the room.', when: 'Right away' })
  await settle(mia)
  await expect(leo.getByRole('navigation').getByRole('button', { name: 'Room, 1 new' })).toBeVisible({ timeout: 20_000 })
  await leo.getByRole('navigation').getByRole('button', { name: 'Room, 1 new' }).click()
  await leo.getByTestId('envelope-row').click()
  await leo.getByRole('button', { name: 'Break the seal' }).click()
  await expect(leo.getByTestId('inside-words')).toContainText('Look at the room.')
  await go(leo, '/settings')
  await expect(leo.getByRole('navigation').getByRole('button', { name: 'Room', exact: true })).toBeVisible()
})
