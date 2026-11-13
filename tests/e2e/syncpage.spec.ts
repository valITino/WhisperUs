import { expect, test, type BrowserContext, type Page } from '@playwright/test'
import { kit, makeCouple, resetCloud, settle, toast, type Kit } from './ship.helpers'

// The Sync page: what is going on, in words a person can act on, and the two ways out
// for a change the cloud refused. Played by two devices against the pretend cloud.
// Whatever goes wrong, the page never shows anything from an envelope: only what kind
// of thing it was.

const contexts: BrowserContext[] = []
test.afterEach(async () => {
  for (const context of contexts.splice(0)) await context.close()
})

const refused = (page: Page) => page.getByTestId('refused-change')
const advice = (page: Page) => page.getByTestId('sync-advice')
const LINE = 'A line nobody else should read'

/** An envelope the cloud will refuse: it claims to belong to another room. Returns its id. */
async function smuggle(page: Page, teaser = LINE): Promise<string> {
  const k = await kit(page)
  return k.evaluate(async (app: Kit, line: string) => {
    const at = new Date().toISOString()
    const id = crypto.randomUUID()
    const authorId = await app.store.memberId()
    await app.store.put('envelopes', { id, householdId: crypto.randomUUID(), authorId, kind: 'confession', teaser: line, heatOutside: null, wants: 'listen', keep: 'keep', openMode: 'hand', opensAt: null, layers: {}, seen: {}, reply: null, createdAt: at, updatedAt: at, deletedAt: null })
    await app.sync.sync()
    return id
  }, teaser)
}

async function openSync(page: Page): Promise<void> {
  await page.goto('/#/settings')
  await page.getByTestId('sync-section').getByRole('button', { name: /^Sync details/ }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Sync' })).toBeVisible()
}

test('refused changes are listed in plain words, with "Try again" and "Discard"', async ({ browser, request }) => {
  test.setTimeout(120_000)
  await resetCloud(request)
  const { mia, leo } = await makeCouple(browser, contexts)
  await settle(mia)
  const k = await kit(mia)

  await test.step('all is well: it says so, and what that means', async () => {
    await openSync(mia)
    await expect(advice(mia)).toHaveText('Everything you did is in the cloud. Your partner gets it the next time their app is open.')
    await expect(mia.getByTestId('sync-stuck')).toHaveText('0')
    await expect(mia.getByTestId('refused')).toHaveCount(0)
    await expect(mia.getByText('No names, nothing from an envelope.')).toBeVisible()
  })

  let envelopeId = ''
  await test.step('the cloud says no twice: a new envelope and a change to the profile', async () => {
    envelopeId = await smuggle(mia)
    await k.evaluate(async (app: Kit) => {
      const me = await app.store.memberId()
      await app.store.patch('members', me, { status: 'h'.repeat(61) })
      await app.sync.sync()
    })
    // "Us" points at it.
    await mia.goto('/#/settings')
    await expect(mia.getByTestId('sync-words')).toHaveText('2 changes were refused and wait for you.')
    await mia.getByTestId('sync-section').getByRole('button', { name: /^Sync details/ }).click()

    await expect(advice(mia)).toContainText('The cloud said no to 2 changes.')
    await expect(mia.getByTestId('sync-stuck')).toHaveText('2')
    await expect(refused(mia)).toHaveCount(2)
    await expect(refused(mia).nth(0)).toContainText('A new envelope')
    await expect(refused(mia).nth(0)).toContainText(/Refused: Today, \d\d:\d\d/)
    await expect(refused(mia).nth(1)).toContainText('A change to your profile')
    await expect(mia.getByTestId('refused')).toContainText('"Try again" sends a change once more. "Discard" gives up on it for good.')
    // What kind of thing it was, and not a word of it.
    await expect(mia.getByTestId('sync-page')).not.toContainText(LINE)
    // The refused envelope is still on this device, and Leo has never seen it.
    expect(await k.evaluate((app: Kit, id: string) => app.db.envelopes.get(id).then((e: { teaser: string }) => e?.teaser), envelopeId)).toBe(LINE)
  })

  await test.step('"Try again" while the reason is still there: the change comes back, nothing is lost', async () => {
    await mia.getByRole('button', { name: 'Try again: A new envelope' }).click()
    await expect(toast(mia, 'Trying again')).toBeVisible()
    await expect.poll(() => k.evaluate((app: Kit) => app.db.outbox.count())).toBe(0)
    await expect(refused(mia)).toHaveCount(2)
    await expect(mia.getByTestId('refused')).toContainText('A new envelope')
  })

  await test.step('"Try again" once the reason is gone: it reaches the cloud and the partner', async () => {
    await k.evaluate(async (app: Kit, id: string) => app.db.envelopes.update(id, { householdId: await app.store.householdId() }), envelopeId)
    await mia.getByRole('button', { name: 'Try again: A new envelope' }).click()
    await expect(refused(mia)).toHaveCount(1)
    await expect(mia.getByTestId('sync-stuck')).toHaveText('1')
    const his = await kit(leo)
    await expect
      .poll(async () => {
        await his.evaluate((app: Kit) => app.sync.sync())
        return his.evaluate((app: Kit, id: string) => app.db.envelopes.get(id).then((e: { teaser: string } | undefined) => e?.teaser ?? null), envelopeId)
      })
      .toBe(LINE)
  })

  await test.step('"Discard" asks first, says what happens, and then the change is gone', async () => {
    await mia.getByRole('button', { name: 'Discard: A change to your profile' }).click()
    const sheet = mia.getByRole('dialog', { name: 'Discard this change?' })
    await expect(sheet).toContainText('A change to your profile')
    await expect(sheet).toContainText('The change is dropped for good. Everything else stays as you see it now.')
    await sheet.getByRole('button', { name: 'Keep it' }).click()
    await expect(sheet).toBeHidden()
    await expect(refused(mia)).toHaveCount(1)

    await mia.getByRole('button', { name: 'Discard: A change to your profile' }).click()
    await sheet.getByRole('button', { name: 'Discard change' }).click()
    await expect(toast(mia, 'Discarded')).toBeVisible()
    await expect(mia.getByTestId('refused')).toHaveCount(0)
    await expect(advice(mia)).toContainText('Everything you did is in the cloud.')
  })

  await test.step('discarding something new needs the cloud: offline it stays, online it leaves this device', async () => {
    const ghost = await smuggle(mia, 'A ghost of a line')
    await expect(refused(mia)).toHaveCount(1)
    await mia.context().setOffline(true)
    await mia.getByRole('button', { name: 'Discard: A new envelope' }).click()
    const sheet = mia.getByRole('dialog', { name: 'Discard this change?' })
    await expect(sheet).toContainText('It never reached the cloud, so your partner has not seen it.')
    await sheet.getByRole('button', { name: 'Discard change' }).click()
    await expect(mia.getByTestId('pairing-error')).toHaveText('Discarding needs a connection, so the cloud can be asked what it has. Go online and try again.')
    await expect(refused(mia)).toHaveCount(1)
    expect(await k.evaluate((app: Kit, id: string) => app.db.envelopes.get(id).then(Boolean), ghost)).toBe(true)

    await mia.context().setOffline(false)
    await mia.getByRole('button', { name: 'Discard: A new envelope' }).click()
    await sheet.getByRole('button', { name: 'Discard change' }).click()
    await expect(toast(mia, 'Discarded')).toBeVisible()
    await expect(mia.getByTestId('refused')).toHaveCount(0)
    expect(await k.evaluate((app: Kit, id: string) => app.db.envelopes.get(id).then(Boolean), ghost)).toBe(false)
  })

  await test.step('"Copy details" has what support needs and nothing a person typed', async () => {
    await smuggle(mia, 'Top secret line')
    await expect(refused(mia)).toHaveCount(1)
    await mia.getByRole('button', { name: 'Copy details' }).click()
    await expect(toast(mia, 'Copied')).toBeVisible()
    const report = await mia.evaluate(() => navigator.clipboard.readText())
    expect(report).toMatch(/^WhisperUs sync report\nApp: \d+\.\d+\.\d+ \(fake\)\n/)
    expect(report).toMatch(/State: (idle|syncing)/)
    expect(report).toMatch(/Last sync: \d{4}-\d\d-\d\dT/)
    expect(report).toContain('Changes waiting: 0')
    expect(report).toContain('Refused changes: 1')
    expect(report).toContain('Last error: none')
    expect(report).toMatch(/Rows: households 1, members 2, envelopes \d+, keys \d+, media \d+/)
    expect(report).toMatch(/Refused: put envelopes, forbidden, \d{4}-/)
    for (const personal of ['Top secret line', LINE, 'ghost', 'Leo', 'Mia', 'Room 12']) expect(report).not.toContain(personal)
  })
})

test('waiting changes and being offline are explained', async ({ browser, request }) => {
  await resetCloud(request)
  const { mia } = await makeCouple(browser, contexts)
  await settle(mia)
  await openSync(mia)

  await mia.context().setOffline(true)
  const k = await kit(mia)
  await k.evaluate(async (app: Kit) => {
    const draft = { feel: null, voice: null, teaser: null, heatOutside: null, wants: 'listen', keep: 'keep', openMode: 'hand', opensAt: null, release: ['feel', 'words', 'voice'] }
    await app.actions.sealEnvelope({ ...draft, words: 'One.' })
    await app.actions.sealEnvelope({ ...draft, words: 'Two.' })
    await app.sync.sync()
  })
  await expect(mia.getByTestId('sync-pending')).toHaveText('2')
  await expect(advice(mia)).toHaveText('This device has no connection right now. Carry on as usual: everything is saved here and goes out by itself once you are back online.')
  await mia.getByRole('button', { name: 'Sync now' }).click()
  await expect(toast(mia, 'Still offline. Your changes are safe on this device.')).toBeVisible()

  await mia.context().setOffline(false)
  await expect(mia.getByTestId('sync-pending')).toHaveText('0')
  await expect(advice(mia)).toContainText('Everything you did is in the cloud.')
})
