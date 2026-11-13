import { expect, test, type BrowserContext } from '@playwright/test'
import { cloudHolds, kit, makeCouple, openPhone, openRoom, resetCloud, sealInBooth, settle, toast, type Kit } from './ship.helpers'

// The heart of the app, played by two phones: she says something in the booth, seals it,
// decides when it opens, he breaks the seal and answers. And the promises around it:
// nothing of the inside leaves her phone before she says so, one opening means one, and
// what is taken back is gone.

const contexts: BrowserContext[] = []
test.afterEach(async () => {
  for (const context of contexts.splice(0)) await context.close()
})

const WORDS = 'I keep thinking about the weekend at the lake. I did not say it then, but I loved every second.'

test('from the booth to his answer: sealed by her hand, opened in two parts', async ({ browser, request }) => {
  test.setTimeout(120_000)
  await resetCloud(request)
  const { mia, leo } = await makeCouple(browser, contexts)
  let id = ''

  await test.step('she says it, says how it felt and why, and seals it', async () => {
    id = await sealInBooth(mia, {
      words: WORDS,
      voice: true,
      heat: 4,
      ease: 2,
      why: ['It turned me on', 'Afraid you will see me differently'],
      ownWord: 'greedy',
      teaser: 'About Saturday',
      wants: /Tell me what it did to you/,
    })
    await expect(toast(mia, 'Sealed')).toBeVisible()
    await expect(mia.getByTestId('mine-line')).toHaveText('Sealed. Nothing of it has left this phone.')
    await expect(mia.getByTestId('mine-layers')).toContainText('With you')
  })

  await test.step('the cloud knows an envelope is waiting, and nothing of what is in it', async () => {
    await settle(mia)
    const stored = await cloudHolds(request, 'envelopes', id)
    expect(stored).toContain('About Saturday')
    expect(stored).toContain('"layers":{}')
    for (const inside of ['lake', 'loved', 'greedy', 'said.aroused', 'seen-differently']) expect(stored).not.toContain(inside)
    // No key and no sound has gone out either.
    const k = await kit(mia)
    expect(await k.evaluate(async (app: Kit) => ({ keys: await app.db.keys.count(), media: await app.db.media.count(), held: await app.db.vault.count() }))).toEqual({ keys: 0, media: 0, held: 3 })
  })

  await test.step('he sees it waiting, with her line on it, and cannot open it', async () => {
    await leo.goto('/#/')
    const row = leo.getByTestId('for-me').getByTestId('envelope-row')
    await expect(row).toHaveCount(1)
    await expect(row).toContainText('About Saturday')
    await expect(row).toContainText('Opens when Mia is ready')
    await row.click()
    await expect(leo.getByTestId('envelope-theirs')).toBeVisible()
    await expect(leo.getByTestId('waiting-line')).toHaveText('It opens when Mia is ready.')
    await expect(leo.getByRole('button', { name: 'Break the seal' })).toHaveCount(0)
    await expect(leo.getByTestId('inside')).toHaveCount(0)
  })

  await test.step('she opens her words and how it felt, and keeps her voice to herself for now', async () => {
    await mia.getByRole('button', { name: 'Open it for Leo' }).click()
    const sheet = mia.getByRole('dialog', { name: 'Open it for Leo?' })
    await expect(sheet).toContainText('From that moment Leo can read it. That cannot be taken back.')
    await sheet.getByRole('switch', { name: 'Your voice' }).click()
    await sheet.getByRole('button', { name: 'Open it', exact: true }).click()
    await expect(toast(mia, 'It is open')).toBeVisible()
    await expect(mia.getByTestId('mine-line')).toHaveText('Open for Leo.')
    await expect(mia.getByTestId('mine-layers')).toContainText('With you')
    await expect(mia.getByRole('button', { name: 'Open more for Leo' })).toBeVisible()
  })

  await test.step('his page notices by itself: he breaks the seal and reads', async () => {
    await expect(leo.getByRole('button', { name: 'Break the seal' })).toBeVisible({ timeout: 20_000 })
    await leo.getByRole('button', { name: 'Break the seal' }).click()
    await expect(leo.getByTestId('inside-words')).toContainText(WORDS)
    await expect(leo.getByTestId('wants')).toContainText('Mia would love to know what it did to you.')
    await expect(leo.getByTestId('inside')).toContainText('How it felt for Mia')
    const feel = leo.getByTestId('inside-feel')
    await expect(feel).toContainText('It turned me on')
    await expect(feel).toContainText('Afraid you will see me differently')
    await expect(feel).toContainText('greedy')
    await expect(feel).toContainText('Took courage')
    // What she kept back has not left her phone. His does not even know there is more.
    await expect(leo.getByTestId('still-sealed')).toHaveCount(0)
    await expect(leo.getByTestId('player')).toHaveCount(0)
    const his = await kit(leo)
    expect(await his.evaluate(async (app: Kit) => Object.keys((await app.db.envelopes.toArray())[0].layers).sort())).toEqual(['feel', 'words'])
  })

  await test.step('he answers: two taps, how hot, and his why', async () => {
    const form = leo.getByTestId('reply-form')
    await form.getByRole('button', { name: /I am here/ }).click()
    await form.getByRole('button', { name: /So hot/ }).click()
    await form.getByRole('radio', { name: /^5:/ }).click()
    await form.getByRole('button', { name: 'You are safe with me', exact: true }).click()
    await form.getByLabel('A sentence more, if you like').fill('Nothing about you changes for me.')
    await form.getByRole('button', { name: 'Send answer' }).click()
    await expect(toast(leo, 'Sent')).toBeVisible()
    await expect(leo.getByTestId('reply')).toContainText('You are safe with me')
  })

  await test.step('his answer reaches her page by itself', async () => {
    const answer = mia.getByTestId('reply')
    await expect(answer).toBeVisible({ timeout: 20_000 })
    await expect(answer).toContainText("Leo's answer")
    await expect(answer).toContainText('I am here')
    await expect(answer).toContainText('You are safe with me')
    await expect(answer).toContainText('Nothing about you changes for me.')
  })

  await test.step('later she opens her voice too, and he can listen', async () => {
    await mia.getByRole('button', { name: 'Open more for Leo' }).click()
    await mia.getByRole('dialog').getByRole('button', { name: 'Open it', exact: true }).click()
    await expect(toast(mia, 'It is open')).toBeVisible()
    await settle(mia)

    await expect(leo.getByRole('button', { name: 'Break the seal' })).toBeVisible({ timeout: 20_000 })
    await leo.getByRole('button', { name: 'Break the seal' }).click()
    const player = leo.getByTestId('player')
    await expect(player).toBeVisible({ timeout: 20_000 })
    await expect(player.getByRole('button', { name: 'Play' })).toBeVisible()
    await expect(leo.getByTestId('still-sealed')).toHaveCount(0)
    // What reached his phone is real sound, opened with her key.
    const k = await kit(leo)
    const sound = await k.evaluate(async (app: Kit) => {
      const envelope = (await app.db.envelopes.toArray())[0]
      const voice = await app.actions.readLayer(envelope, 'voice')
      const blob: Blob | null = voice ? await app.actions.readVoice(envelope, voice) : null
      return blob ? { type: blob.type.split(';')[0], bytes: blob.size } : null
    })
    expect(sound?.type).toMatch(/^audio\//)
    expect(sound?.bytes).toBeGreaterThan(500)
  })

  await test.step('the sound in the cloud is sealed: not a recording anybody could play', async () => {
    const k = await kit(mia)
    const media = await k.evaluate(async (app: Kit) => (await app.db.media.toArray())[0])
    const stored = await cloudHolds(request, 'media', media.id)
    expect(stored).toContain(media.id)
    const head = await k.evaluate(async (app: Kit, path: string) => {
      const sealed: Blob = await app.backend.downloadBlob(path)
      return [...new Uint8Array(await sealed.arrayBuffer()).slice(0, 4)]
    }, `${media.householdId}/${media.id}.bin`)
    expect(head).toHaveLength(4)
    // A WebM file starts with 1A 45 DF A3, an Ogg file with "OggS". Sealed bytes start with neither.
    expect(head).not.toEqual([0x1a, 0x45, 0xdf, 0xa3])
    expect(head).not.toEqual([0x4f, 0x67, 0x67, 0x53])
  })

  await test.step('both can come back to it after closing the app', async () => {
    await leo.reload()
    await expect(leo.getByTestId('inside-words')).toContainText(WORDS)
    await expect(leo.getByTestId('reply')).toContainText('Nothing about you changes for me.')
    await mia.reload()
    await mia.getByRole('button', { name: 'Read it again' }).click()
    await expect(mia.getByTestId('inside-words')).toContainText(WORDS)
    await leo.goto('/#/')
    await expect(leo.getByTestId('for-me').getByTestId('envelope-row')).toContainText('Opened, and answered')
    await mia.goto('/#/')
    await expect(mia.getByTestId('from-me').getByTestId('envelope-row')).toContainText('Leo answered')
  })
})

test('one opening: he reads it once, then it is gone from his phone and from the cloud', async ({ browser, request }) => {
  await resetCloud(request)
  const { mia, leo } = await makeCouple(browser, contexts)
  const id = await sealInBooth(mia, { words: 'Read this once and keep it in your head.', when: 'Right away', once: true })
  await settle(mia)
  expect(await cloudHolds(request, 'envelopes', id)).toContain('"words":{')

  await leo.goto(`/#/envelope/${id}`)
  await expect(leo.getByTestId('envelope-theirs')).toContainText('This one opens once.')
  await leo.getByRole('button', { name: 'Break the seal' }).click()
  await expect(leo.getByTestId('inside-words')).toContainText('Read this once and keep it in your head.')
  await settle(leo)

  // He can stay as long as he likes. Leaving is what ends it.
  await leo.goto('/#/')
  await expect(leo.getByTestId('home')).toBeVisible()
  await leo.goto(`/#/envelope/${id}`)
  await expect(leo.getByTestId('envelope-theirs')).toContainText('You opened this once. It is gone now, as promised.')
  await expect(leo.getByTestId('inside-words')).toHaveCount(0)
  const k = await kit(leo)
  expect(await k.evaluate(async (app: Kit) => ({ keys: await app.db.keys.count(), layers: Object.keys((await app.db.envelopes.toArray())[0].layers) }))).toEqual({ keys: 0, layers: [] })
  expect(await cloudHolds(request, 'envelopes', id)).toContain('"layers":{}')

  // Hers stays where she sealed it.
  await mia.reload()
  await expect(mia.getByTestId('mine-layers')).toContainText('Opened once, gone', { timeout: 20_000 })
  await mia.getByRole('button', { name: 'Read it again' }).click()
  await expect(mia.getByTestId('inside-words')).toContainText('Read this once and keep it in your head.')
})

test('at a time: the envelope leaves her phone sealed and opens by itself, not a second earlier', async ({ browser, request }) => {
  await resetCloud(request)
  const { mia, leo } = await makeCouple(browser, contexts)

  // Sealed through the app's own action, so the test can choose a moment a few seconds ahead.
  const k = await kit(mia)
  const id: string = await k.evaluate(
    (app: Kit) =>
      app.actions.sealEnvelope({
        feel: null,
        words: 'It is ten o clock.',
        voice: null,
        teaser: 'For tonight',
        heatOutside: null,
        wants: 'listen',
        keep: 'keep',
        openMode: 'at',
        opensAt: new Date(Date.now() + 6000).toISOString(),
        release: ['feel', 'words', 'voice'],
      }),
  )
  await settle(mia)

  await leo.goto(`/#/envelope/${id}`)
  await expect(leo.getByTestId('waiting-line')).toContainText(/It opens (today|tonight|tomorrow) at \d\d:\d\d\./)
  // The sealed words are on his phone already. The key is not: the cloud keeps it until the time.
  const his = await kit(leo)
  expect(await his.evaluate(async (app: Kit) => ({ keys: await app.db.keys.count(), sealed: Object.keys((await app.db.envelopes.toArray())[0].layers) }))).toEqual({ keys: 0, sealed: ['words'] })
  await expect(leo.getByRole('button', { name: 'Break the seal' })).toHaveCount(0)

  // Nobody touches anything. When the moment comes, his page offers the seal.
  await expect(leo.getByRole('button', { name: 'Break the seal' })).toBeVisible({ timeout: 30_000 })
  await leo.getByRole('button', { name: 'Break the seal' }).click()
  await expect(leo.getByTestId('inside-words')).toContainText('It is ten o clock.')
  await expect(leo.getByTestId('wants')).toContainText('Mia asks you to just take it in. No answer needed.')
  // "Just take it in": no form is pushed at him, only a quiet way to answer anyway.
  await expect(leo.getByTestId('reply-form')).toHaveCount(0)
  await expect(leo.getByRole('button', { name: 'Answer anyway' })).toBeVisible()
})

test('taking it back: gone on both phones, and the cloud forgets what was inside', async ({ browser, request }) => {
  await resetCloud(request)
  const { mia, leo } = await makeCouple(browser, contexts)
  const id = await sealInBooth(mia, { words: 'On second thought.', teaser: 'Maybe', when: 'Right away' })
  await settle(mia)
  await leo.goto(`/#/envelope/${id}`)
  await expect(leo.getByRole('button', { name: 'Break the seal' })).toBeVisible()

  await mia.getByRole('button', { name: 'Take it back' }).click()
  const sheet = mia.getByRole('dialog', { name: 'Take this envelope back?' })
  await expect(sheet).toContainText('It disappears for both of you, and the cloud forgets what was inside.')
  await sheet.getByRole('button', { name: 'Keep it' }).click()
  await expect(sheet).toBeHidden()
  await mia.getByTestId('envelope-mine').getByRole('button', { name: 'Take it back' }).click()
  await mia.getByRole('dialog').getByRole('button', { name: 'Take it back' }).click()
  await expect(toast(mia, 'Taken back')).toBeVisible()
  await expect(mia.getByTestId('home')).toBeVisible()
  await expect(mia.getByTestId('envelope-row')).toHaveCount(0)

  await expect(leo.getByTestId('envelope-gone')).toBeVisible({ timeout: 20_000 })
  await expect(leo.getByRole('heading', { name: 'This envelope is gone' })).toBeVisible()
  await leo.getByRole('button', { name: 'Back to the room' }).click()
  await expect(leo.getByTestId('envelope-row')).toHaveCount(0)
  const stored = await cloudHolds(request, 'envelopes', id)
  expect(stored).toContain('"layers":{}')
  expect(stored).not.toContain('Maybe')
})

test('the booth: a first line to borrow, a draft that survives, and a kind question before leaving', async ({ browser, request }) => {
  await resetCloud(request)
  const { mia } = await makeCouple(browser, contexts)

  await test.step('from the room, the seal in the middle of the bar leads into the booth', async () => {
    await mia.goto('/#/')
    await mia.getByRole('navigation').getByRole('button', { name: 'Step into the booth' }).click()
    await expect(mia).toHaveURL(/#\/booth$/)
    await expect(mia.getByTestId('booth-step')).toHaveText('Step 1 of 3')
    await expect(mia.getByTestId('booth-say')).toContainText('Nothing leaves this phone until you seal it')
  })

  await test.step('a starter puts the first words down for her', async () => {
    await mia.getByTestId('starters').getByRole('button', { name: 'I loved it when you' }).click()
    await expect(mia.getByLabel('Your words')).toHaveValue(/^I loved it when you/)
    await mia.getByLabel('Your words').pressSequentially('looked at me.')
  })

  await test.step('an empty envelope cannot be sealed, and the page says what to do', async () => {
    await mia.getByLabel('Your words').fill('')
    await mia.getByRole('button', { name: 'Next', exact: true }).click()
    await mia.getByRole('button', { name: 'Next', exact: true }).click()
    await mia.getByRole('button', { name: 'Seal it', exact: true }).click()
    await expect(mia.getByRole('alert')).toContainText('The envelope is still empty')
    await mia.getByRole('button', { name: 'Back', exact: true }).click()
    await mia.getByRole('button', { name: 'Back', exact: true }).click()
    await mia.getByLabel('Your words').fill('I loved it when you looked at me.')
  })

  await test.step('the draft survives a reload, on the step she was on', async () => {
    await mia.getByRole('button', { name: 'Next', exact: true }).click()
    await mia.getByRole('radio', { name: /^3:/ }).click()
    await mia.getByRole('button', { name: 'Shy', exact: true }).click()
    await mia.reload()
    await expect(mia.getByTestId('booth-step')).toHaveText('Step 2 of 3')
    await expect(mia.getByRole('radio', { name: /^3:/ })).toBeChecked()
    await expect(mia.getByRole('button', { name: 'Shy', exact: true })).toHaveAttribute('aria-pressed', 'true')
    await mia.getByRole('button', { name: 'Back', exact: true }).click()
    await expect(mia.getByLabel('Your words')).toHaveValue('I loved it when you looked at me.')
  })

  await test.step('leaving keeps her words for a day: she can come back and finish', async () => {
    await mia.getByRole('button', { name: 'Back', exact: true }).click()
    await expect(mia.getByTestId('home')).toBeVisible()
    await mia.goto('/#/booth')
    await expect(mia.getByLabel('Your words')).toHaveValue('I loved it when you looked at me.')
  })

  await test.step('a recording is never kept, so leaving with one asks first', async () => {
    await mia.getByRole('button', { name: 'Record', exact: true }).click()
    await expect(mia.getByTestId('recorder')).toContainText('0:01', { timeout: 15_000 })
    await mia.getByRole('button', { name: 'Stop', exact: true }).click()
    await expect(mia.getByTestId('player')).toBeVisible()

    await mia.getByRole('button', { name: 'Back', exact: true }).click()
    const sheet = mia.getByRole('dialog', { name: 'Leave the booth?' })
    await expect(sheet).toContainText('Your words stay on this phone for a day')
    await expect(sheet).toContainText('A recording is not kept.')
    await sheet.getByRole('button', { name: 'Stay' }).click()
    await expect(mia.getByTestId('player')).toBeVisible()
    // Neither the draft nor anything else on the phone holds the sound.
    expect(await mia.evaluate(() => JSON.stringify({ ...localStorage }))).not.toMatch(/audio|webm|blob:/)
  })

  await test.step('"Throw the draft away" really does', async () => {
    await mia.getByRole('button', { name: 'Throw the draft away' }).click()
    await expect(toast(mia, 'Draft thrown away')).toBeVisible()
    await expect(mia.getByLabel('Your words')).toHaveValue('')
    await expect(mia.getByTestId('player')).toHaveCount(0)
    expect(await mia.evaluate(() => JSON.stringify({ ...localStorage }))).not.toContain('looked at me')
  })
})

test('a room of one: the booth waits for somebody to listen', async ({ browser, request }) => {
  await resetCloud(request)
  const mia = await openPhone(browser, contexts)
  await openRoom(mia)
  await mia.goto('/#/booth')
  await expect(mia.getByTestId('booth-alone')).toContainText('The booth needs someone to listen')
  await expect(mia.getByLabel('Your words')).toHaveCount(0)
  await mia.getByRole('button', { name: 'Invite your partner' }).click()
  await expect(mia.getByTestId('invite-code')).toBeVisible()
})
