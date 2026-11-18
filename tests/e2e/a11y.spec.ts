import { expect, test, type BrowserContext, type Page } from '@playwright/test'
import { go, kit, makeCouple, openPhone, resetCloud, sealInBooth, settle, syncNow, tabs, type Kit } from './ship.helpers'

// A guard for the basics on every screen, at the narrowest phone we design for:
//   - every control has a name (read from the browser's accessibility tree)
//   - nothing scrolls sideways at 360 px
//   - exactly one h1
// English and German, because German words are longer. Sheets get the first two checks.
// A new screen belongs in one of the lists below.

test.use({ viewport: { width: 360, height: 740 } })

const contexts: BrowserContext[] = []
test.afterEach(async () => {
  for (const context of contexts.splice(0)) await context.close()
})

const CONTROLS = ['button', 'link', 'textbox', 'searchbox', 'switch', 'radio', 'checkbox', 'combobox', 'slider', 'spinbutton', 'tab', 'menuitem', 'option']

/** Controls the accessibility tree lists without a name, as "role" or "role near 'text'". */
async function unnamed(page: Page, scope = 'body'): Promise<string[]> {
  const tree = await page.locator(scope).first().ariaSnapshot()
  const found: string[] = []
  for (const line of tree.split('\n')) {
    // A named control reads `- button "Seal it"`. One without a name is just `- button` (or `- button:` with children).
    const match = /^\s*- (\w+)(?: \[[^\]]*\])*:?\s*(.*)$/.exec(line)
    if (!match || !CONTROLS.includes(match[1])) continue
    const rest = match[2].trim()
    if (rest.startsWith('"') || rest.startsWith("'") || rest.startsWith('/')) continue
    // `- textbox: typed value` has a value but no name; `- button: text` has text content as its name.
    if (rest && !['textbox', 'searchbox', 'combobox', 'spinbutton', 'slider'].includes(match[1])) continue
    found.push(line.trim())
  }
  return found
}

async function basics(page: Page, name: string, options: { sheet?: boolean } = {}): Promise<void> {
  expect.soft(await unnamed(page, options.sheet ? '[role="dialog"]' : 'body'), `${name}: controls without a name`).toEqual([])
  const width = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }))
  expect.soft(width.scroll, `${name}: scrolls sideways`).toBeLessThanOrEqual(width.client)
  if (!options.sheet) await expect.soft(page.locator('h1:visible'), `${name}: one h1`).toHaveCount(1)
}

/** Open a page of the app and wait until it is really there, not a loader with a title. */
async function show(page: Page, path: string, name: string): Promise<void> {
  await go(page, path)
  await expect(page.locator('h1:visible').first(), `${name}: has a title`).toBeVisible()
  await expect(page.getByRole('status').filter({ hasText: /One moment|Einen Moment/ })).toHaveCount(0)
}

const WORDS = { en: { next: 'Next', german: 'Deutsch' }, de: { next: 'Weiter', german: 'Deutsch' } }

for (const lang of ['en', 'de'] as const) {
  test(`every screen of the room keeps the basics (${lang})`, async ({ browser, request }) => {
    test.setTimeout(180_000)
    await resetCloud(request)
    const { mia, leo } = await makeCouple(browser, contexts)

    // A room with everything in it: something still with her, something he opened and
    // answered, and something that waits for its time.
    const held = await sealInBooth(mia, { words: 'Still with me.', heat: 3, why: ['Shy'], teaser: 'Not yet' })
    const out = await sealInBooth(mia, { words: 'For you, now. '.repeat(12), voice: true, heat: 5, ease: 1, why: ['It turned me on', 'Afraid it is too much'], ownWord: 'unbelievably greedy tonight', teaser: 'A line that is as long as a line on an envelope is allowed to be, to see whether it still fits on the paper', wants: /Tell me what it did to you/, when: 'Right away' })
    const k = await kit(mia)
    const timed: string = await k.evaluate((app: Kit) =>
      app.actions.sealEnvelope({ feel: null, words: 'Later.', voice: null, teaser: 'For the weekend', heatOutside: 4, wants: 'talk', keep: 'once', openMode: 'at', opensAt: new Date(Date.now() + 50 * 3_600_000).toISOString(), release: ['feel', 'words', 'voice'] }),
    )
    await settle(mia)
    await leo.goto(`/#/envelope/${out}`)
    await leo.getByRole('button', { name: 'Break the seal' }).click()
    await leo.getByTestId('reply-form').getByRole('button', { name: /I am here/ }).click()
    await leo.getByTestId('reply-form').getByRole('button', { name: 'I need a moment to take it in', exact: true }).click()
    await leo.getByTestId('reply-form').getByLabel('A sentence more, if you like').fill('A sentence that goes on for a while, because people who are moved do not count their words.')
    await leo.getByTestId('reply-form').getByRole('button', { name: 'Send answer' }).click()
    await expect(leo.getByTestId('reply')).toBeVisible()
    await settle(leo)

    // Closer: check-ins with parts shown, answers on the list that meet, something of their
    // own on it, answers about themselves, a wish that waits and one that was answered.
    const reason = { chips: ['checkin.rested', 'checkin.head'], own: ['a very long word of my own for this'], note: 'A sentence that goes on for a while, to see whether it still fits.' }
    const hers2 = await k.evaluate(async (app: Kit, why) => {
      for (const daysAgo of [0, 1, 2, 4, 5, 8]) {
        const at = new Date(Date.now() - daysAgo * 86_400_000)
        await app.actions.saveCheckin({ body: { energy: 4, mood: 2, close: 5, open: 1, desire: 5, kinky: 3, thoughts: 3, fantasies: ['soft.massage'], happened: ['tender', 'sex', 'kinky'], why }, share: ['close', 'open', 'mood', 'happened'], at })
      }
      for (const [item, lean] of [['soft.massage', 'yes'], ['words.whisper', 'maybe'], ['senses.blindfolds', 'dream'], ['looks.mirrors', 'no']]) await app.actions.saveLeaning(item, { lean, pull: 4, why: { chips: ['leaning.trust'], own: [], note: null } }, { showWhy: true })
      await app.actions.addIdea('Something of our own, written out at full length to fill the line', 'own')
      for (const [question, value] of [['say', 2], ['no', 1], ['arrive', 4]]) await app.actions.saveAbout(question, { value, why: { chips: ['about.no-words'], own: [], note: null } }, ['value', 'why'])
      return app.actions.makeWish({ text: 'A wish that is as long as a wish may be, because people who long for something do not count their words. '.repeat(3).trim(), item: 'soft.massage', mode: 'do', want: 5, why })
    }, reason)
    await settle(mia)
    await syncNow(leo)
    const his2 = await (await kit(leo)).evaluate(async (app: Kit, wish) => {
      await app.actions.saveCheckin({ body: { energy: 2, close: 4, open: 5, desire: 2 }, share: ['close', 'open', 'desire'] })
      for (const item of ['soft.massage', 'words.whisper', 'senses.blindfolds']) await app.actions.saveLeaning(item, { lean: 'yes', pull: 2 })
      for (const [question, value] of [['say', 4], ['arrive', 2]]) await app.actions.saveAbout(question, { value }, ['value'])
      await app.actions.answerWish(wish, { decision: 'later', taps: ['glad', 'us'], heat: 3, why: { chips: ['decision.another-time'], own: [], note: 'This week is too full, ask me on Sunday.' } })
      return app.actions.makeWish({ text: 'Tell me one thing.', item: null, mode: 'dream', want: null, why: { chips: [], own: [], note: null } })
    }, hers2)
    await settle(leo)
    await settle(mia)

    if (lang === 'de') {
      for (const page of [mia, leo]) {
        await page.goto('/#/settings')
        await page.getByRole('radio', { name: 'Deutsch' }).click()
        await expect(page.locator('html')).toHaveAttribute('lang', 'de')
      }
    }

    const hers: [name: string, path: string][] = [
      ['the room', '/'],
      ['the booth, say', '/booth'],
      ['her envelope, still with her', `/envelope/${held}`],
      ['her envelope, open and answered', `/envelope/${out}`],
      ['her envelope, waiting for its time', `/envelope/${timed}`],
      ['an envelope that is gone', '/envelope/00000000-0000-4000-8000-000000000000'],
      ['Us', '/settings'],
      ['my profile', '/settings/profile'],
      ['people', '/settings/people'],
      ['PIN and devices', '/settings/pin'],
      ['notifications', '/settings/notifications'],
      ['sync', '/settings/sync'],
      ['app lock', '/settings/lock'],
      ['the first look', '/hello'],
      ['the check-in', '/checkin'],
      ['wishes', '/wishes'],
      ['a new wish', '/wishes/new'],
      ['her wish, answered', `/wishes/${hers2}`],
      ['his wish, to answer', `/wishes/${his2}`],
      ['a wish that is gone', '/wishes/00000000-0000-4000-8000-000000000000'],
      ['the list', '/list'],
      ['the cockpit, hers', '/cockpit'],
      ['the cockpit, for two', '/cockpit/us'],
      ['about me', '/about'],
      ['check-in times', '/settings/checkin'],
    ]
    for (const [name, path] of hers) {
      await show(mia, path, name)
      await basics(mia, `${name} (${lang})`)
    }

    const his: [name: string, path: string][] = [
      ['his room', '/'],
      ['an envelope that waits for her hand', `/envelope/${held}`],
      ['an envelope he opened and answered', `/envelope/${out}`],
      ['an envelope that waits for its time', `/envelope/${timed}`],
      ['people, not the admin', '/settings/people'],
      ['her wish, his answer', `/wishes/${hers2}`],
      ['his cockpit for two', '/cockpit/us'],
      ['his room, with her day', '/'],
    ]
    for (const [name, path] of his) {
      await show(leo, path, name)
      await basics(leo, `${name} (${lang})`)
    }

    // Closer, the parts behind a tap: the check-in with its why and its parts shown, an item
    // of the list where they meet, something of one's own, a question about oneself.
    await show(mia, '/checkin', 'check-in, open')
    await mia.getByTestId('share-choice').getByRole('radio').nth(1).click()
    await basics(mia, `the check-in, shown in parts (${lang})`)
    await mia.getByRole('button', { name: lang === 'de' ? 'Diesen Check-in entfernen' : 'Remove this check-in' }).click()
    await expect(mia.getByRole('dialog')).toBeVisible()
    await basics(mia, `remove check-in sheet (${lang})`, { sheet: true })
    await mia.keyboard.press('Escape')
    await show(mia, '/list', 'list, an item')
    await mia.getByTestId('item-soft.massage').click()
    await expect(mia.getByTestId('item-match')).toBeVisible()
    await basics(mia, `item sheet, where they meet (${lang})`, { sheet: true })
    await mia.keyboard.press('Escape')
    await expect(mia.getByRole('dialog')).toHaveCount(0)
    await mia.getByRole('button', { name: lang === 'de' ? 'Etwas Eigenes schreiben' : 'Write your own' }).click()
    await expect(mia.getByRole('dialog')).toBeVisible()
    await basics(mia, `own idea sheet (${lang})`, { sheet: true })
    await mia.keyboard.press('Escape')
    await show(mia, '/about', 'about, a question')
    await mia.getByTestId('about-say').click()
    await expect(mia.getByRole('dialog')).toBeVisible()
    await basics(mia, `question sheet (${lang})`, { sheet: true })
    await mia.keyboard.press('Escape')
    await show(leo, `/wishes/${hers2}`, 'changing an answer')
    await leo.getByRole('button', { name: lang === 'de' ? 'Meine Antwort ändern' : 'Change my answer' }).click()
    await expect(leo.getByTestId('wish-answer-form')).toBeVisible()
    await basics(leo, `wish answer form (${lang})`)

    // The booth, step by step, and what she sealed, read again.
    await show(mia, '/booth', 'booth')
    await mia.getByLabel(lang === 'de' ? 'Deine Worte' : 'Your words').fill('Für die Prüfung der Kabine, mit Umlauten und einem langen Satz.')
    await mia.getByRole('button', { name: WORDS[lang].next, exact: true }).click()
    await expect(mia.getByTestId('booth-feel')).toBeVisible()
    await basics(mia, `the booth, feel (${lang})`)
    await mia.getByRole('button', { name: WORDS[lang].next, exact: true }).click()
    await expect(mia.getByTestId('booth-seal')).toBeVisible()
    await basics(mia, `the booth, seal (${lang})`)
    await mia.getByRole('radio', { name: lang === 'de' ? 'Zu einer Zeit' : 'At a time' }).click()
    await basics(mia, `the booth, seal at a time (${lang})`)

    await show(mia, `/envelope/${out}`, 'reading again')
    await mia.getByRole('button', { name: lang === 'de' ? 'Nochmal lesen' : 'Read it again' }).click()
    await expect(mia.getByTestId('inside')).toBeVisible()
    await basics(mia, `her envelope, read again (${lang})`)

    // He changes his answer: the form with everything in it.
    await show(leo, `/envelope/${out}`, 'answering')
    await leo.getByRole('button', { name: lang === 'de' ? 'Meine Antwort ändern' : 'Change my answer' }).click()
    await expect(leo.getByTestId('reply-form')).toBeVisible()
    await basics(leo, `answer form (${lang})`)

    // Sheets: opening by hand, taking back.
    await show(mia, `/envelope/${held}`, 'sheets')
    await mia.getByRole('button', { name: lang === 'de' ? 'Für Leo öffnen' : 'Open it for Leo' }).click()
    await expect(mia.getByRole('dialog')).toBeVisible()
    await basics(mia, `open sheet (${lang})`, { sheet: true })
    await mia.keyboard.press('Escape')
    await expect(mia.getByRole('dialog')).toHaveCount(0)
    await mia.getByTestId('envelope-mine').getByRole('button', { name: lang === 'de' ? 'Zurücknehmen' : 'Take it back' }).click()
    await expect(mia.getByRole('dialog')).toBeVisible()
    await basics(mia, `take back sheet (${lang})`, { sheet: true })
    await mia.keyboard.press('Escape')

    // The lock screen and its one sheet.
    await show(mia, '/settings/lock', 'lock')
    await mia.getByLabel('Code', { exact: true }).fill('864213')
    await mia.getByLabel(lang === 'de' ? 'Code wiederholen' : 'Repeat code').fill('864213')
    await mia.getByRole('button', { name: lang === 'de' ? 'App-Sperre einschalten' : 'Turn on the app lock' }).click()
    await expect(mia.getByTestId('lock-settings')).toHaveAttribute('data-lock', 'on')
    await basics(mia, `app lock, on (${lang})`)
    await mia.getByRole('button', { name: lang === 'de' ? 'Jetzt sperren' : 'Lock now' }).click()
    await expect(mia.getByTestId('lock-screen')).toBeVisible()
    await basics(mia, `lock screen (${lang})`)
    await mia.getByRole('button', { name: lang === 'de' ? 'Code vergessen?' : 'Forgot the code?' }).click()
    await expect(mia.getByRole('dialog')).toBeVisible()
    await basics(mia, `forgot sheet (${lang})`, { sheet: true })
  })
}

test('the start screens keep the basics, and so does a room of one', async ({ browser, request }) => {
  test.setTimeout(120_000)
  await resetCloud(request)
  const page = await openPhone(browser, contexts)
  const next = () => page.getByRole('button', { name: 'Next', exact: true }).click()

  await page.goto('/#/')
  await expect(page.getByRole('button', { name: 'Start from scratch' })).toBeVisible()
  await basics(page, 'start')
  await page.goto('/#/login')
  await expect(page.getByLabel('Your name')).toBeVisible()
  await basics(page, 'log in')
  await page.goto('/#/join')
  await expect(page.locator('h1:visible')).toHaveCount(1)
  await basics(page, 'join with a code')

  // The same three in German.
  await page.goto('/#/')
  await page.getByRole('radio', { name: 'Deutsch' }).click()
  await expect(page.getByRole('button', { name: 'Neu anfangen' })).toBeVisible()
  await basics(page, 'start (de)')
  await page.goto('/#/login')
  await expect(page.getByLabel('Dein Name')).toBeVisible()
  await basics(page, 'log in (de)')
  await page.goto('/#/')
  await page.getByRole('radio', { name: 'English' }).click()

  // Open a room, checking each step of the way.
  await page.getByRole('button', { name: 'Start from scratch' }).click()
  await expect(page.getByTestId('wizard-step')).toHaveText('Step 1 of 3')
  await basics(page, 'wizard, step 1')
  await page.getByLabel('Your name').fill('Mia')
  await page.getByLabel('Room name').fill('Room 12')
  await next()
  await expect(page.getByTestId('wizard-step')).toHaveText('Step 2 of 3')
  await basics(page, 'wizard, step 2')
  await next()
  await expect(page.getByTestId('wizard-step')).toHaveText('Step 3 of 3')
  await basics(page, 'wizard, step 3')
  await page.getByLabel('PIN', { exact: true }).fill('271828')
  await page.getByLabel('Repeat PIN', { exact: true }).fill('271828')
  await page.getByRole('button', { name: 'Open the room' }).click()
  await expect(page.getByRole('heading', { name: 'Your room is open' })).toBeVisible()
  await basics(page, 'the room is open')
  await page.getByRole('button', { name: 'Done' }).click()

  // The first look, step by step: the questions, the list, the two moments of the day.
  await expect(page.getByTestId('hello-step')).toHaveText('1 of 9')
  await basics(page, 'first look, before it begins')
  await page.getByRole('button', { name: 'Begin', exact: true }).click()
  await expect(page.getByTestId('hello-step')).toHaveText('2 of 9')
  await page.getByTestId('question-say').getByRole('radio', { name: /^2 \/ 5/ }).click()
  await page.getByTestId('question-say').getByRole('button', { name: 'Add a why' }).click()
  await basics(page, 'first look, a question with its why')
  for (let i = 0; i < 6; i++) await next()
  await expect(page.getByTestId('hello-step')).toHaveText('8 of 9')
  await basics(page, 'first look, the list')
  await next()
  await expect(page.getByTestId('hello-step')).toHaveText('9 of 9')
  await basics(page, 'first look, the two moments')
  await page.getByRole('button', { name: 'Done', exact: true }).click()
  await expect(tabs(page)).toBeVisible()

  for (const [name, path] of [
    ['wishes, alone', '/wishes'],
    ['the list, alone', '/list'],
    ['the cockpit, empty', '/cockpit'],
    ['the cockpit for two, alone', '/cockpit/us'],
    ['the check-in, alone', '/checkin'],
    ['the room, alone', '/'],
    ['the booth, alone', '/booth'],
    ['Us, alone', '/settings'],
    ['people, alone', '/settings/people'],
    ['invite', '/settings/invite'],
  ] as const) {
    await show(page, path, name)
    await basics(page, name)
  }
})

test('focus is never lost: a sheet takes it and gives it back, a new page hands it to its title', async ({ browser, request }) => {
  await resetCloud(request)
  const { mia } = await makeCouple(browser, contexts)
  await sealInBooth(mia, { words: 'For the keyboard.' })
  const inDialog = () => mia.evaluate(() => Boolean(document.activeElement?.closest('[role="dialog"]')))
  const focused = () => mia.evaluate(() => (document.activeElement?.getAttribute('aria-label') ?? (document.activeElement as HTMLElement | null)?.innerText ?? '').replace(/\s+/g, ' ').trim())

  // Opened with the keyboard, the sheet has the focus, and Tab goes round inside it.
  const opener = mia.getByRole('button', { name: 'Open it for Leo' })
  await opener.focus()
  await mia.keyboard.press('Enter')
  await expect(mia.getByRole('dialog', { name: 'Open it for Leo?' })).toBeVisible()
  expect(await inDialog()).toBe(true)
  for (let i = 0; i < 16; i++) {
    await mia.keyboard.press('Tab')
    expect(await inDialog(), `Tab ${i + 1} stays in the sheet`).toBe(true)
  }
  await mia.keyboard.press('Shift+Tab')
  expect(await inDialog()).toBe(true)

  // Escape closes it and focus is back on the button that opened it.
  await mia.keyboard.press('Escape')
  await expect(mia.getByRole('dialog')).toHaveCount(0)
  await expect(opener).toBeFocused()

  // The same with the other sheet, closed by its own button.
  const takeBack = mia.getByTestId('envelope-mine').getByRole('button', { name: 'Take it back' })
  await takeBack.focus()
  await mia.keyboard.press('Enter')
  await expect(mia.getByRole('dialog', { name: 'Take this envelope back?' })).toBeVisible()
  await mia.getByRole('dialog').getByRole('button', { name: 'Keep it' }).click()
  await expect(mia.getByRole('dialog')).toHaveCount(0)
  await expect(takeBack).toBeFocused()

  // Going to another page by keyboard: the button that was pressed is gone, the title has the focus.
  await go(mia, '/settings')
  await mia.getByRole('button', { name: /^People/ }).focus()
  await mia.keyboard.press('Enter')
  await expect(mia.getByRole('heading', { level: 1, name: 'People' })).toBeFocused()
  expect(await focused()).toBe('People')
})
