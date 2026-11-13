import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test'
import { joinByLink, openRoom, tabs } from './ship.helpers'

// Notifications, installing and the update note, as a person meets them under "Us".
// Two phones against the pretend cloud: Mia tells, Leo listens. The dev server has no
// service worker and no push service, so the browser's part is stood in for here (the
// worker itself is tested against the production build in tests/pwa). What the cloud
// would hand to the push service is read from the pretend cloud instead of a lock screen.
//
// The key a browser signs up with comes from the cloud. The pretend cloud has one from
// the start; "/__cloud/push-key" plays the owner who has not set notifications up yet.

interface Kit {
  db: { outbox: { count(): Promise<number> } }
  sync: { sync(): Promise<void> }
  actions: {
    sealEnvelope(draft: Record<string, unknown>): Promise<string>
    openLayers(id: string, layers: string[]): Promise<string[]>
  }
  announceUpdate(): void
}
const kit = (page: Page) => page.waitForFunction(() => Boolean((window as unknown as { __whisperus?: Kit }).__whisperus))

/** What she writes on the outside. It must never show up in a notification. */
const TEASER = 'About last Saturday'
/** An envelope with a few words in it, opening by her hand. */
const DRAFT = { feel: null, words: 'Just for you.', voice: null, teaser: TEASER, heatOutside: 5, wants: 'listen', keep: 'keep', openMode: 'hand', opensAt: null, release: ['feel', 'words', 'voice'] }

interface Sent {
  endpoint: string
  message: { type: string; title: string; body: string; tag: string; url: string }
}
interface Pushes {
  sent: Sent[]
  devices: { endpoint: string; mutedTypes: string[] }[]
}

const devices: BrowserContext[] = []
test.afterEach(async () => {
  for (const context of devices.splice(0)) await context.close()
})

interface PhoneOptions {
  /** What the browser already thinks about notifications from this site. */
  permission?: 'default' | 'granted' | 'denied'
  /** What the person answers when the browser asks. */
  answer?: 'granted' | 'denied' | 'default'
  lang?: 'en' | 'de'
  theme?: 'light' | 'dark'
  /** Runs as an installed app. */
  installed?: boolean
}

/**
 * A phone whose browser has a push service that works without a network: it remembers
 * the permission and the subscription between page loads, and counts how often it asked.
 */
async function openPhone(browser: Browser, name: string, options: PhoneOptions = {}): Promise<Page> {
  const context = await browser.newContext()
  devices.push(context)
  await context.addInitScript(
    ([who, permission, answer, lang, theme, installed]) => {
      if (!localStorage.getItem('whisperus.lang')) localStorage.setItem('whisperus.lang', lang)
      if (!localStorage.getItem('whisperus.theme')) localStorage.setItem('whisperus.theme', theme)
      if (!localStorage.getItem('rig.permission')) localStorage.setItem('rig.permission', permission)
      const bump = (counter: string) => localStorage.setItem(counter, String(Number(localStorage.getItem(counter) ?? 0) + 1))
      Object.assign(window, {
        __whisperusPush: {
          device: {
            supported: () => true,
            permission: () => localStorage.getItem('rig.permission'),
            askPermission: async () => {
              bump('rig.asked')
              localStorage.setItem('rig.permission', answer)
              return answer
            },
            current: async () => JSON.parse(localStorage.getItem('rig.subscription') ?? 'null'),
            subscribe: async () => {
              if (localStorage.getItem('rig.permission') !== 'granted') throw new Error('no permission')
              const subscription = { endpoint: `https://push.example.test/send/${who}`, p256dh: `key-of-${who}`, auth: 'secret' }
              localStorage.setItem('rig.subscription', JSON.stringify(subscription))
              return subscription
            },
            unsubscribe: async () => localStorage.removeItem('rig.subscription'),
          },
        },
      })
      if (installed) {
        const real = window.matchMedia.bind(window)
        window.matchMedia = (query: string) => (query === '(display-mode: standalone)' ? ({ matches: true, media: query, addEventListener() {}, removeEventListener() {} } as unknown as MediaQueryList) : real(query))
      }
    },
    [name, options.permission ?? 'default', options.answer ?? 'granted', options.lang ?? 'en', options.theme ?? 'light', options.installed ?? false] as const,
  )
  return context.newPage()
}

/** Mia opens the room, Leo joins with her link. Both end inside the app. */
async function pair(mia: Page, leo: Page): Promise<void> {
  await joinByLink(leo, await openRoom(mia))
  await expect(mia.getByTestId('partner-joined')).toContainText('Leo is in')
  await mia.getByRole('button', { name: 'Done' }).click()
  await expect(tabs(mia)).toBeVisible()
}

async function openNotifications(page: Page): Promise<void> {
  await page.goto('/#/settings')
  await page.getByRole('button', { name: /^(Notifications|Benachrichtigungen)/ }).click()
  await expect(page).toHaveURL(/#\/settings\/notifications$/)
}

const asked = (page: Page) => page.evaluate(() => Number(localStorage.getItem('rig.asked') ?? 0))
const deviceCard = (page: Page) => page.getByTestId('notifications-device')
const toast = (page: Page, text: string) => page.getByText(text, { exact: true }).last()

/** Run something with the app's own actions on this phone, then wait until the cloud has it. */
async function act<T, A>(page: Page, what: (app: Kit, arg: A) => Promise<T>, arg?: A): Promise<T> {
  await kit(page)
  const result = await page.evaluate(([fn, given]) => (0, eval)(`(${fn})`)((window as unknown as { __whisperus: Kit }).__whisperus, given), [what.toString(), arg] as const)
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const app = (window as unknown as { __whisperus: Kit }).__whisperus
        await app.sync.sync()
        return app.db.outbox.count()
      }),
    )
    .toBe(0)
  return result as T
}

test('turning notifications on, hearing from the room, muting a kind and turning them off', async ({ browser, request }) => {
  await request.post('/__cloud/reset')
  const mia = await openPhone(browser, 'mia-phone')
  const leo = await openPhone(browser, 'leo-phone')
  await pair(mia, leo)
  const pushes = async (): Promise<Pushes> => ((await (await request.get('/__cloud/pushes')).json()) as { result: Pushes }).result
  let envelopeId = ''

  await test.step('nothing asks for permission by itself', async () => {
    await leo.goto('/#/')
    await expect(tabs(leo)).toBeVisible()
    await leo.goto('/#/settings')
    await expect(leo.getByTestId('notifications-state')).toHaveText('Off on this device.')
    await openNotifications(leo)
    await expect(deviceCard(leo)).toHaveAttribute('data-status', 'off')
    await expect(deviceCard(leo)).toContainText('Hear it right away when Mia seals something for you, when an envelope opens, or when yours is answered.')
    // The promise that matters most here, said before anybody turns anything on.
    await expect(leo.getByTestId('notifications-page')).toContainText('A notification never shows what is in an envelope, nor what is written on it.')
    await expect(leo.getByTestId('notification-kinds')).toHaveCount(0)
    expect(await asked(leo)).toBe(0)
    expect((await pushes()).devices).toEqual([])
  })

  await test.step('one tap asks, and the device is signed up', async () => {
    await leo.getByRole('button', { name: 'Turn on notifications' }).click()
    await expect(toast(leo, 'Notifications turned on')).toBeVisible()
    await expect(deviceCard(leo)).toHaveAttribute('data-status', 'on')
    await expect(leo.getByTestId('notifications-tag')).toHaveText('On')
    await expect(deviceCard(leo)).toContainText('This device tells you when Mia seals something for you')
    expect(await asked(leo)).toBe(1)
    expect((await pushes()).devices).toEqual([{ endpoint: 'https://push.example.test/send/leo-phone', memberId: expect.any(String), mutedTypes: [] }])

    // One switch for each kind of news, all on.
    const kinds = leo.getByTestId('notification-kinds').getByRole('switch')
    await expect(kinds).toHaveCount(3)
    for (const name of ['Something was sealed for you', 'An envelope opened for you', 'An answer to your envelope']) {
      await expect(leo.getByRole('switch', { name })).toBeChecked()
    }
    // Every control is big enough for a thumb.
    for (const control of await leo.getByTestId('notifications-page').getByRole('button').all()) {
      expect((await control.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44)
    }
    for (const control of await kinds.all()) expect((await control.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44)
  })

  await test.step('she seals something and later opens it: he is told twice, she is not', async () => {
    envelopeId = await act(mia, (app, draft) => app.actions.sealEnvelope(draft), DRAFT)
    await act(mia, async (app, id) => void (await app.actions.openLayers(id, ['words'])), envelopeId)
    const { sent } = await pushes()
    expect(sent.map((p) => [p.endpoint, p.message.type])).toEqual([
      ['https://push.example.test/send/leo-phone', 'sealed'],
      ['https://push.example.test/send/leo-phone', 'opened'],
    ])
    expect(sent[0].message).toEqual({ type: 'sealed', title: 'Something is waiting for you', body: 'Mia sealed something. It opens when Mia is ready.', tag: `envelope-${envelopeId}`, url: `/envelope/${envelopeId}` })
    expect(sent[1].message).toEqual({ type: 'opened', title: 'It is open', body: "Mia's envelope is open for you now.", tag: `envelope-${envelopeId}`, url: `/envelope/${envelopeId}` })
    // A lock screen is read by anybody who picks the phone up: who and when, never what.
    for (const telling of [TEASER, 'Saturday', 'Just for you', 'hot']) expect(JSON.stringify(sent)).not.toContain(telling)
    // The page the notification opens exists, and is the one with the seal.
    await leo.goto(`/#${sent[1].message.url}`)
    await expect(leo.getByRole('button', { name: 'Break the seal' })).toBeVisible()
  })

  await test.step('a muted kind stays quiet, and the choice survives a reload', async () => {
    await openNotifications(leo)
    await leo.getByRole('switch', { name: 'Something was sealed for you' }).click()
    await expect(leo.getByRole('switch', { name: 'Something was sealed for you' })).not.toBeChecked()
    await expect.poll(async () => (await pushes()).devices[0]?.mutedTypes).toEqual(['sealed'])

    await act(mia, (app, draft) => app.actions.sealEnvelope(draft), DRAFT)
    expect((await pushes()).sent).toHaveLength(2)

    await leo.reload()
    await expect(deviceCard(leo)).toHaveAttribute('data-status', 'on')
    await expect(leo.getByRole('switch', { name: 'Something was sealed for you' })).not.toBeChecked()
    await expect(leo.getByRole('switch', { name: 'An envelope opened for you' })).toBeChecked()
    expect(await asked(leo)).toBe(1)
  })

  await test.step('"Us" shows the state at a glance', async () => {
    await leo.getByRole('button', { name: 'Back' }).click()
    await expect(leo.getByTestId('notifications-state')).toHaveText('On for this device.')
  })

  await test.step('turning them off removes the device from the cloud', async () => {
    await openNotifications(leo)
    await leo.getByRole('button', { name: 'Turn off notifications' }).click()
    await expect(toast(leo, 'Notifications turned off')).toBeVisible()
    await expect(deviceCard(leo)).toHaveAttribute('data-status', 'off')
    await expect(leo.getByRole('button', { name: 'Turn on notifications' })).toBeVisible()
    expect((await pushes()).devices).toEqual([])
    expect(await leo.evaluate(() => localStorage.getItem('rig.subscription'))).toBeNull()
  })
})

test('logging a device out takes its notifications along', async ({ browser, request }) => {
  await request.post('/__cloud/reset')
  const mia = await openPhone(browser, 'mia-phone')
  const leo = await openPhone(browser, 'leo-phone', { permission: 'granted' })
  await pair(mia, leo)
  const pushes = async (): Promise<Pushes> => ((await (await request.get('/__cloud/pushes')).json()) as { result: Pushes }).result

  await openNotifications(leo)
  await leo.getByRole('button', { name: 'Turn on notifications' }).click()
  await expect(deviceCard(leo)).toHaveAttribute('data-status', 'on')
  // Permission was there already: no question needed.
  expect(await asked(leo)).toBe(0)
  expect((await pushes()).devices).toHaveLength(1)

  await leo.goto('/#/settings/pin')
  await leo.getByRole('button', { name: 'Log out', exact: true }).click()
  await expect(leo.getByTestId('welcome')).toBeVisible()
  expect((await pushes()).devices).toEqual([])
  expect(await leo.evaluate(() => [localStorage.getItem('rig.subscription'), localStorage.getItem('whisperus.push')])).toEqual([null, null])

  // Nothing reaches a device that has left the room.
  await act(mia, (app, draft) => app.actions.sealEnvelope(draft), DRAFT)
  expect((await pushes()).sent).toEqual([])
})

test('a blocked browser gets told how to unblock, in words, and nothing to tap', async ({ browser, request }) => {
  await request.post('/__cloud/reset')
  const mia = await openPhone(browser, 'mia-phone', { answer: 'denied' })
  const leo = await openPhone(browser, 'leo-phone')
  await pair(mia, leo)
  // She reads German, after dark.
  await mia.goto('/#/settings')
  await mia.getByRole('radio', { name: 'Deutsch' }).click()
  await expect(mia.locator('html')).toHaveAttribute('lang', 'de')
  await mia.getByRole('radio', { name: 'Bei Nacht' }).click()
  await expect(mia.locator('html')).toHaveAttribute('data-theme', 'dark')

  await openNotifications(mia)
  await expect(mia.getByRole('heading', { level: 1, name: 'Benachrichtigungen' })).toBeVisible()
  await mia.getByRole('button', { name: 'Benachrichtigungen einschalten' }).click()
  await expect(deviceCard(mia)).toHaveAttribute('data-status', 'blocked')
  await expect(mia.getByTestId('notifications-tag')).toHaveText('Blockiert')
  await expect(deviceCard(mia).getByRole('note')).toContainText('Tippe auf das Symbol links neben der Adresse, dann auf «Berechtigungen», dann auf «Benachrichtigungen»')
  await expect(deviceCard(mia).getByRole('button')).toHaveCount(0)
  await expect(mia.getByTestId('notification-kinds')).toHaveCount(0)
  expect(await asked(mia)).toBe(1)

  // Still blocked after a reload, without asking again.
  await mia.reload()
  await expect(deviceCard(mia)).toHaveAttribute('data-status', 'blocked')
  expect(await asked(mia)).toBe(1)
  await mia.goto('/#/settings')
  await expect(mia.getByTestId('notifications-state')).toHaveText('Im Browser blockiert.')

  // Unblocked in the browser's settings: coming back to the page offers the button again.
  await openNotifications(mia)
  await mia.evaluate(() => {
    localStorage.setItem('rig.permission', 'default')
    document.dispatchEvent(new Event('visibilitychange'))
  })
  await expect(mia.getByRole('button', { name: 'Benachrichtigungen einschalten' })).toBeVisible()
})

test('a closed question is not a no: the page says what to do', async ({ browser, request }) => {
  await request.post('/__cloud/reset')
  const mia = await openPhone(browser, 'mia-phone', { answer: 'default' })
  const leo = await openPhone(browser, 'leo-phone')
  await pair(mia, leo)
  await openNotifications(mia)
  await mia.getByRole('button', { name: 'Turn on notifications' }).click()
  await expect(mia.getByRole('alert')).toHaveText('The question was closed without an answer. Tap again and choose "Allow".')
  await expect(deviceCard(mia)).toHaveAttribute('data-status', 'off')
  await expect(mia.getByRole('button', { name: 'Turn on notifications' })).toBeEnabled()
})

test('until the owner has set notifications up, the page says so and offers nothing to tap', async ({ browser, request }) => {
  await request.post('/__cloud/reset')
  // The cloud has no key for browsers to sign up with yet.
  await request.post('/__cloud/push-key')
  const mia = await openPhone(browser, 'mia-phone')
  const leo = await openPhone(browser, 'leo-phone')
  await pair(mia, leo)

  await openNotifications(mia)
  await expect(deviceCard(mia)).toHaveAttribute('data-status', 'unconfigured')
  await expect(deviceCard(mia)).toContainText('Notifications are not set up for this room yet.')
  await expect(mia.getByTestId('notifications-page').getByRole('button')).toHaveCount(0)
  await expect(mia.getByTestId('notifications-page').getByRole('switch')).toHaveCount(0)
  expect(await asked(mia)).toBe(0)
  await mia.getByRole('button', { name: 'Back' }).click()
  await expect(mia.getByTestId('notifications-state')).toHaveText('Not set up yet.')

  // The owner switches them on (three statements in the SQL editor). No new build, no
  // update of the app: the next look at the page offers the button.
  await request.post('/__cloud/push-key?value=BA1Hxzyi1RUM1b5wjxsn7nGxAszw2u61m164i3MrAIxHF6YK5h4SDYic-dRuU_RCPCfA5aq9ojSwk5Y2EmClBPs')
  await openNotifications(mia)
  await expect(deviceCard(mia)).toHaveAttribute('data-status', 'off')
  await mia.getByRole('button', { name: 'Turn on notifications' }).click()
  await expect(deviceCard(mia)).toHaveAttribute('data-status', 'on')
  expect(await asked(mia)).toBe(1)
})

test('a device that has never reached the cloud says it cannot tell yet, instead of guessing', async ({ browser, request }) => {
  await request.post('/__cloud/reset')
  const mia = await openPhone(browser, 'mia-phone')
  const leo = await openPhone(browser, 'leo-phone')
  await pair(mia, leo)
  await mia.goto('/#/')
  await expect(tabs(mia)).toBeVisible()

  await mia.context().setOffline(true)
  await openNotifications(mia)
  await expect(deviceCard(mia)).toHaveAttribute('data-status', 'unknown')
  await expect(deviceCard(mia)).toContainText('The cloud cannot be reached right now')
  await expect(deviceCard(mia).getByRole('button')).toHaveCount(0)

  // Back online and back on the page: now it knows.
  await mia.context().setOffline(false)
  await mia.evaluate(() => document.dispatchEvent(new Event('visibilitychange')))
  await expect(mia.getByRole('button', { name: 'Turn on notifications' })).toBeVisible()
})

test.describe('installing', () => {
  /** Chrome's offer to install, as a page sees it. Records what happens to it. */
  const offerInstall = (page: Page, outcome: 'accepted' | 'dismissed') =>
    page.evaluate((answer) => {
      const offer = Object.assign(new Event('beforeinstallprompt', { cancelable: true }), {
        prompt: async () => void Object.assign(window, { promptShown: true }),
        userChoice: Promise.resolve({ outcome: answer }),
      })
      window.dispatchEvent(offer)
      // Chrome's own banner stays away only if the page asked for that.
      Object.assign(window, { bannerPrevented: offer.defaultPrevented })
    }, outcome)

  /** A room of one is enough to look at "Us". */
  async function inTheRoom(browser: Browser, request: { post(url: string): Promise<unknown> }, options: PhoneOptions = {}): Promise<Page> {
    await request.post('/__cloud/reset')
    const page = await openPhone(browser, 'mia-phone', options)
    await openRoom(page)
    await page.goto('/#/settings')
    await expect(page.getByRole('heading', { level: 1, name: 'Us' })).toBeVisible()
    return page
  }

  test('without an offer from the browser, one sentence says where to find it', async ({ browser, request }) => {
    const page = await inTheRoom(browser, request)
    const card = page.getByTestId('install-card')
    await expect(card.getByRole('heading', { name: 'Install WhisperUs' })).toBeVisible()
    await expect(card).toContainText('open the Chrome menu (the three dots) and tap "Install app" or "Add to Home screen"')
    await expect(card.getByRole('button')).toHaveCount(0)

    await page.getByRole('radio', { name: 'Deutsch' }).click()
    await expect(card.getByRole('heading', { name: 'WhisperUs installieren' })).toBeVisible()
    await expect(card).toContainText('tippe auf «App installieren» oder «Zum Startbildschirm hinzufügen»')
  })

  test("with Chrome's offer it is one tap, and the card goes away once installed", async ({ browser, request }) => {
    const page = await inTheRoom(browser, request)
    const card = page.getByTestId('install-card')
    await expect(card).toBeVisible()
    await offerInstall(page, 'accepted')
    expect(await page.evaluate(() => (window as unknown as { bannerPrevented: boolean }).bannerPrevented)).toBe(true)
    await expect(card).toContainText('It opens like any other app, also without a connection.')

    const button = card.getByRole('button', { name: 'Install WhisperUs' })
    expect((await button.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44)
    // Nothing pops up until the tap.
    expect(await page.evaluate(() => (window as unknown as { promptShown?: boolean }).promptShown)).toBeUndefined()
    await button.click()
    expect(await page.evaluate(() => (window as unknown as { promptShown?: boolean }).promptShown)).toBe(true)
    await expect(page.getByText('Installed', { exact: true }).last()).toBeVisible()
    await expect(card).toHaveCount(0)
  })

  test('"not now" in Chrome\'s prompt leaves the manual way', async ({ browser, request }) => {
    const page = await inTheRoom(browser, request)
    const card = page.getByTestId('install-card')
    await offerInstall(page, 'dismissed')
    await card.getByRole('button', { name: 'Install WhisperUs' }).click()
    await expect(card.getByRole('button')).toHaveCount(0)
    await expect(card).toContainText('open the Chrome menu')
  })

  test('an app that already runs installed shows no card, and no banner anywhere', async ({ browser, request }) => {
    const page = await inTheRoom(browser, request, { installed: true })
    await expect(page.getByRole('heading', { name: 'Sync' })).toBeVisible()
    await expect(page.getByTestId('install-card')).toHaveCount(0)
    await page.goto('/#/')
    await expect(tabs(page)).toBeVisible()
    await expect(page.getByText(/install/i)).toHaveCount(0)
  })
})

test('the update note: says a new version is ready, and "Later" puts it away', async ({ browser, request }) => {
  await request.post('/__cloud/reset')
  const page = await openPhone(browser, 'mia-phone')
  await openRoom(page)
  await page.goto('/#/settings')
  await page.getByRole('radio', { name: 'Deutsch' }).click()
  await expect(page.locator('html')).toHaveAttribute('lang', 'de')
  await page.goto('/#/')
  const bar = page.getByRole('navigation', { name: 'Hauptnavigation' })
  await expect(bar).toBeVisible()
  const note = page.getByTestId('update-note')
  await expect(note).toHaveCount(0)

  await kit(page)
  await page.evaluate(() => (window as unknown as { __whisperus: Kit }).__whisperus.announceUpdate())
  await expect(note).toBeVisible()
  await expect(note).toContainText('Eine neue Version ist da.')
  const reload = note.getByRole('button', { name: 'Neu laden' })
  const later = note.getByRole('button', { name: 'Später' })
  // The note settles into place with a little spring: measure once it has stopped growing.
  for (const control of [reload, later]) await expect.poll(async () => (await control.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44)
  // It floats above the bar and the seal without covering either.
  const [noteBox, sealBox] = await Promise.all([note.boundingBox(), bar.getByRole('button', { name: 'In die Kabine treten' }).boundingBox()])
  expect((noteBox?.y ?? 0) + (noteBox?.height ?? 0)).toBeLessThanOrEqual(sealBox?.y ?? 0)
  // It stays while the person moves around.
  await bar.getByRole('button', { name: 'Wir', exact: true }).click()
  await expect(note).toBeVisible()

  await later.click()
  await expect(note).toHaveCount(0)

  // "Reload" reloads: the note is gone with the old page.
  await page.evaluate(() => {
    Object.assign(window, { beforeReload: true })
    ;(window as unknown as { __whisperus: Kit }).__whisperus.announceUpdate()
  })
  await reload.click()
  await expect.poll(() => page.evaluate(() => (window as unknown as { beforeReload?: boolean }).beforeReload).catch(() => true)).toBeUndefined()
  await expect(note).toHaveCount(0)
})
