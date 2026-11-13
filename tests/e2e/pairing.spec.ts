import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test'

// The start, logging in and the admin's controls, played by several devices against the
// pretend cloud. Here he opens the room (so he is its admin) and she joins by link: the
// other specs do it the other way round, and nothing may depend on who went first.
// Nobody here touches a real cloud.

const CODE = /^[A-Z2-9]{10}$/
const LEO = { name: 'Leo', pin: '314159', room: 'Casa Leo' }
const MIA = { name: 'Mia', pin: '271828' }

type Mine = { theme?: string; lang?: string }
type Kit = {
  db: { outbox: { count(): Promise<number> }; meta: { count(): Promise<number> }; members: { toArray(): Promise<{ name: string; prefs?: Mine }[]> } }
  sync: { sync(): Promise<void>; status: { state: string } }
}
/** The app's development hooks, once the page has set them up. */
async function kit(page: Page) {
  await page.waitForFunction(() => Boolean((window as unknown as { __whisperus?: Kit }).__whisperus))
  return page.evaluateHandle(() => (window as unknown as { __whisperus: Kit }).__whisperus)
}

// Every device a test opened is closed afterwards, so none keeps syncing into the next test.
const devices: BrowserContext[] = []
test.afterEach(async () => {
  for (const context of devices.splice(0)) await context.close()
})

async function openPhone(browser: Browser, options: { clipboard?: boolean } = {}): Promise<Page> {
  const context = await browser.newContext(options.clipboard ? { permissions: ['clipboard-read', 'clipboard-write'] } : {})
  devices.push(context)
  await context.addInitScript(() => {
    if (!localStorage.getItem('whisperus.lang')) localStorage.setItem('whisperus.lang', 'en')
    if (!localStorage.getItem('whisperus.theme')) localStorage.setItem('whisperus.theme', 'light')
  })
  return context.newPage()
}

const tabs = (page: Page) => page.getByRole('navigation', { name: /^(Main|Hauptnavigation)$/ })
/** The newest toast with exactly this text. */
const toast = (page: Page, text: string | RegExp) => page.getByText(text, { exact: true }).last()
const next = (page: Page) => page.getByRole('button', { name: 'Next', exact: true }).click()
const pinField = (page: Page, label: string) => page.getByLabel(label, { exact: true })
const stepLabel = (page: Page) => page.getByTestId('wizard-step')
const complaint = (page: Page) => page.getByTestId('pairing-error')
/** One of the admin's controls for the partner's seat, on the People page. */
const control = (page: Page, name: RegExp) => page.getByTestId('admin-controls').getByRole('button', { name })
/** Run a sync pass on this device now, instead of waiting for the next one. */
const syncNow = async (page: Page) => (await kit(page)).evaluate((k) => k.sync.sync())
/** Wait until everything this device changed has reached the cloud. */
async function settle(page: Page): Promise<void> {
  const k = await kit(page)
  await expect
    .poll(() =>
      k.evaluate(async (app) => {
        await app.sync.sync()
        return app.db.outbox.count()
      }),
    )
    .toBe(0)
}

/**
 * Wait until a change under "My settings" is on this device and saved to the person's
 * profile, as it is by the time a person taps the next thing. Tapping faster than that
 * can show the previous setting for a moment (reported to the owner of settingsSync).
 */
async function saved(page: Page, name: string, want: Mine): Promise<void> {
  const k = await kit(page)
  await expect
    .poll(() =>
      k.evaluate(async (app, who) => {
        const device = { theme: localStorage.getItem('whisperus.theme'), lang: localStorage.getItem('whisperus.lang') }
        const profile = (await app.db.members.toArray()).find((m) => m.name === who)?.prefs ?? {}
        return { device, profile }
      }, name),
    )
    .toMatchObject({ device: want, profile: want })
}

async function choosePin(page: Page, pin: string, first = 'PIN'): Promise<void> {
  await pinField(page, first).fill(pin)
  await pinField(page, 'Repeat PIN').fill(pin)
}

/** Open the room through the wizard, the short way. Ends on "Your room is open" and returns the invite link. */
async function openRoom(page: Page, who = LEO): Promise<string> {
  await page.goto('/#/')
  await page.getByRole('button', { name: 'Start from scratch' }).click()
  await page.getByLabel('Your name').fill(who.name)
  await page.getByLabel('Room name').fill(who.room)
  await next(page)
  await next(page)
  await choosePin(page, who.pin)
  await page.getByRole('button', { name: 'Open the room' }).click()
  await expect(page.getByRole('heading', { name: 'Your room is open' })).toBeVisible()
  return (await page.getByTestId('qr').getAttribute('data-qr-value')) ?? ''
}

/** Join through an invite link, the short way. Ends inside the app. */
async function joinByLink(page: Page, link: string, who = MIA): Promise<void> {
  await page.goto(link)
  await expect(page.getByTestId('invitation')).toBeVisible()
  await page.getByLabel('Your name').fill(who.name)
  await next(page)
  await next(page)
  await choosePin(page, who.pin)
  await page.getByRole('button', { name: 'Join the room' }).click()
  await expect(tabs(page)).toBeVisible()
}

/** Leo opens the room on one device, Mia joins on another. */
async function makeCouple(browser: Browser): Promise<{ leo: Page; mia: Page }> {
  const leo = await openPhone(browser)
  const mia = await openPhone(browser)
  await joinByLink(mia, await openRoom(leo))
  await expect(leo.getByTestId('partner-joined')).toContainText('Mia is in')
  await leo.getByRole('button', { name: 'Done' }).click()
  await expect(tabs(leo)).toBeVisible()
  return { leo, mia }
}

/** Type name and PIN on the log-in form (the page, or the "logged out" screen) and send it. */
async function logIn(page: Page, name: string, pin: string): Promise<void> {
  await page.getByLabel('Your name').fill(name)
  await pinField(page, 'Your PIN').fill(pin)
  await page.getByRole('button', { name: 'Let me in' }).click()
}

test('the start: open a room step by step, be its admin, invite by link', async ({ browser, request, baseURL }) => {
  await request.post('/__cloud/reset')
  const leo = await openPhone(browser, { clipboard: true })
  let inviteLink = ''
  let inviteCode = ''

  await test.step('welcome: two doors and the quiet way back in', async () => {
    await leo.goto('/#/')
    await expect(leo.getByRole('heading', { name: 'WhisperUs' })).toBeVisible()
    await expect(leo.getByText('U tell. I listen.')).toBeVisible()
    await expect(leo.getByRole('button', { name: 'Start from scratch' })).toBeVisible()
    await expect(leo.getByRole('button', { name: 'I have a code' })).toBeVisible()
    await expect(leo.getByRole('button', { name: 'Back to the room' })).toBeVisible()
    // Nothing to try out with pretend content: this is not an app to show around.
    await expect(leo.getByTestId('welcome').getByRole('button')).toHaveCount(3)

    // The language switch works before anyone is logged in.
    await leo.getByRole('radio', { name: 'Deutsch' }).click()
    await expect(leo.getByRole('button', { name: 'Neu anfangen' })).toBeVisible()
    await expect(leo.getByRole('button', { name: 'Zurück ins Zimmer' })).toBeVisible()
    await leo.getByRole('radio', { name: 'English' }).click()
  })

  await test.step('step 1: name, look and the name of the room', async () => {
    await leo.getByRole('button', { name: 'Start from scratch' }).click()
    await expect(stepLabel(leo)).toHaveText('Step 1 of 3')
    await expect(leo.getByRole('heading', { name: 'Open a new room' })).toBeVisible()
    // Nobody is asked what they are to the other: no roles, two people.
    await next(leo)
    await expect(complaint(leo)).toContainText('Add your name first')
    await leo.getByLabel('Your name').fill('Leo')
    await expect(leo.getByText('Your name is also what you log in with.')).toBeVisible()
    await leo.getByLabel('Room name').fill('Casa Leo')
    // Whoever opens the room starts as the moon; he adds a crown.
    await expect(leo.getByRole('radiogroup', { name: 'Sign' }).getByRole('radio', { name: 'Moon' })).toBeChecked()
    await leo.getByRole('radiogroup', { name: 'Accessory' }).getByRole('radio', { name: 'Crown' }).click()
    await expect(leo.getByTestId('avatar-preview').locator('[data-accessory="crown"]')).toBeVisible()
    await next(leo)
  })

  await test.step('step 2: the status line, with suggestions to borrow', async () => {
    await expect(stepLabel(leo)).toHaveText('Step 2 of 3')
    await leo.getByTestId('status-suggestions').getByRole('button', { name: 'Come closer' }).click()
    await expect(leo.getByRole('textbox', { name: 'Status line' })).toHaveValue('Come closer')
    await expect(leo.getByTestId('status-counter')).toContainText('11 of 60')
    await next(leo)
    await expect(stepLabel(leo)).toHaveText('Step 3 of 3')
  })

  await test.step('back works with the arrow and with the device, and the draft survives a reload', async () => {
    await pinField(leo, 'PIN').fill('314159')
    await leo.getByRole('button', { name: 'Back' }).click()
    await expect(stepLabel(leo)).toHaveText('Step 2 of 3')
    await expect(leo.getByRole('textbox', { name: 'Status line' })).toHaveValue('Come closer')
    await leo.goBack()
    await expect(stepLabel(leo)).toHaveText('Step 1 of 3')
    await expect(leo.getByLabel('Your name')).toHaveValue('Leo')

    await leo.reload()
    await expect(stepLabel(leo)).toHaveText('Step 1 of 3')
    await expect(leo.getByLabel('Your name')).toHaveValue('Leo')
    await expect(leo.getByLabel('Room name')).toHaveValue('Casa Leo')
    await expect(leo.getByTestId('avatar-preview').locator('[data-accessory="crown"]')).toBeVisible()
    await next(leo)
    await expect(leo.getByRole('textbox', { name: 'Status line' })).toHaveValue('Come closer')
    await next(leo)
    // The PIN is the one thing that is not kept anywhere.
    await expect(pinField(leo, 'PIN')).toHaveValue('')
    expect(await leo.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }))).not.toContain('314159')
  })

  await test.step('step 3: a PIN, typed twice, not too simple', async () => {
    await expect(leo.getByText('you get into your room from any device')).toBeVisible()
    await choosePin(leo, '123456')
    await leo.getByRole('button', { name: 'Open the room' }).click()
    await expect(leo.getByRole('alert')).toContainText('too easy to guess')

    await pinField(leo, 'PIN').fill(LEO.pin)
    await pinField(leo, 'Repeat PIN').fill('314150')
    await leo.getByRole('button', { name: 'Open the room' }).click()
    await expect(leo.getByRole('alert')).toContainText('The two PINs are not the same')

    // Pasted with spaces: only the digits count. Hidden by default, shown on request.
    await pinField(leo, 'PIN').fill('31 41 59')
    await expect(pinField(leo, 'PIN')).toHaveValue(LEO.pin)
    await expect(leo.getByTestId('pin-boxes').first()).not.toContainText('3')
    await leo.getByRole('button', { name: 'Show PIN' }).first().click()
    await expect(leo.getByTestId('pin-boxes').first()).toHaveText(LEO.pin)
    await leo.getByRole('button', { name: 'Hide PIN' }).click()
    await pinField(leo, 'Repeat PIN').fill(LEO.pin)
    await leo.getByRole('button', { name: 'Open the room' }).click()
  })

  await test.step('he is the admin, and gets the invite: link, QR code and code', async () => {
    await expect(leo.getByRole('heading', { name: 'Your room is open' })).toBeVisible()
    await expect(leo.getByTestId('first-steps')).toContainText('you are its admin')
    inviteCode = ((await leo.getByTestId('invite-code').textContent()) ?? '').trim()
    expect(inviteCode).toMatch(CODE)
    inviteLink = (await leo.getByTestId('qr').getAttribute('data-qr-value')) ?? ''
    expect(inviteLink).toBe(`${baseURL}/#/join/${inviteCode}`)
    await expect(leo.getByRole('img', { name: 'QR code of the invite link' })).toBeVisible()
    await leo.getByRole('button', { name: 'Copy link' }).click()
    await expect.poll(() => leo.evaluate(() => navigator.clipboard.readText())).toBe(inviteLink)
    // Nothing of the setup is left lying around on the device.
    expect(await leo.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }))).not.toContain(LEO.pin)
    await expect.poll(() => leo.evaluate(() => localStorage.getItem('whisperus.setupDraft'))).toBeNull()
  })

  const mia = await openPhone(browser)

  await test.step('a second "start from scratch" is stopped at the door: the room is already open', async () => {
    await mia.goto('/#/')
    await mia.getByRole('button', { name: 'Start from scratch' }).click()
    await expect(mia.getByTestId('welcome-note')).toContainText('The room is already open')
    await expect(mia.getByTestId('welcome')).toBeVisible()
    await expect(mia.getByRole('button', { name: 'I have a code' })).toBeVisible()
    await expect(mia.getByRole('button', { name: 'Back to the room' })).toBeVisible()
  })

  await test.step('a wrong code fails right at the code, before any profile is filled in', async () => {
    await mia.getByRole('button', { name: 'I have a code' }).click()
    await mia.getByRole('button', { name: 'Check the code' }).click()
    await expect(complaint(mia)).toContainText('The code has 10 characters')
    await mia.getByLabel('Code').fill('wrong-code2')
    await expect(mia.getByLabel('Code')).toHaveValue('WRONG-CODE2')
    await mia.getByRole('button', { name: 'Check the code' }).click()
    await expect(complaint(mia)).toContainText('That code did not work')
    await expect(mia.getByTestId('code-step')).toBeVisible()
    await expect(mia.getByLabel('Your name')).toHaveCount(0)

    // The right code, typed by hand in lower case, shows who invites.
    await mia.getByLabel('Code').fill(inviteCode.toLowerCase())
    await mia.getByRole('button', { name: 'Check the code' }).click()
    await expect(mia.getByTestId('invitation')).toContainText('Leo invites you to Casa Leo')
    await mia.getByRole('button', { name: 'Back' }).click()
    await expect(mia.getByTestId('code-step')).toBeVisible()
  })

  await test.step('she opens the link: who invites, a sign of her own laid out, his name refused', async () => {
    await mia.goto(inviteLink)
    await expect(mia.getByRole('heading', { name: 'Join the room' })).toBeVisible()
    await expect(mia.getByTestId('invitation')).toContainText('Leo invites you to Casa Leo')
    await expect(mia.getByTestId('invitation').locator('[data-accessory="crown"]')).toBeVisible()
    await expect(stepLabel(mia)).toHaveText('Step 1 of 3')
    // The room has its name already: a guest is not asked for one.
    await expect(mia.getByLabel('Room name')).toHaveCount(0)

    await mia.getByLabel('Your name').fill(' leo ')
    await next(mia)
    await expect(complaint(mia)).toContainText('"leo" is already the other name in this room')
    await expect(stepLabel(mia)).toHaveText('Step 1 of 3')
    await mia.getByLabel('Your name').fill('Mia')
    // He is the moon, so the sun is laid out for her.
    await expect(mia.getByRole('radiogroup', { name: 'Sign' }).getByRole('radio', { name: 'Sun' })).toBeChecked()
    await mia.getByRole('radiogroup', { name: 'Accessory' }).getByRole('radio', { name: 'Bow' }).click()
    await next(mia)
    await mia.getByRole('textbox', { name: 'Status line' }).fill('Slow today, please')
    await next(mia)
    await expect(mia.getByTestId('step-pin')).toContainText('"Mia"')
    await choosePin(mia, MIA.pin)
    await mia.getByRole('button', { name: 'Join the room' }).click()
    await expect(toast(mia, 'Welcome to the room')).toBeVisible()
    await expect(tabs(mia)).toBeVisible()
  })

  await test.step('his invite screen notices her, and "Done" lands in the app', async () => {
    await expect(leo.getByTestId('partner-joined')).toContainText('Mia is in')
    await expect(leo.getByRole('heading', { name: 'A room for two' })).toBeVisible()
    await leo.getByRole('button', { name: 'Done' }).click()
    await expect(tabs(leo)).toBeVisible()
  })

  await test.step('the whole profile arrived in one go: name, avatar, accessory and status on both sides', async () => {
    await leo.goto('/#/settings')
    await expect(leo.getByTestId('my-profile')).toContainText('Leo')
    await expect(leo.getByTestId('my-status')).toHaveText('Come closer')
    await expect(leo.getByTestId('my-profile').locator('[data-accessory="crown"]')).toBeVisible()
    await expect(leo.getByTestId('partner-card')).toContainText('Mia')
    await expect(leo.getByTestId('partner-card')).toContainText('Slow today, please')
    await expect(leo.getByTestId('partner-card').locator('[data-accessory="bow"]')).toBeVisible()
    await expect(leo.getByTestId('room-name')).toHaveText('Casa Leo')

    await mia.goto('/#/settings')
    await expect(mia.getByTestId('my-status')).toHaveText('Slow today, please')
    await expect(mia.getByTestId('partner-card')).toContainText('Come closer')
  })

  await test.step('People: both see both, he has the Admin tag and the controls, she has neither', async () => {
    await leo.getByRole('button', { name: /^People/ }).click()
    await expect(leo.getByTestId('person-me')).toContainText('Leo')
    await expect(leo.getByTestId('person-me')).toContainText('Admin')
    await expect(leo.getByTestId('person-partner')).toContainText('Mia')
    await expect(leo.getByTestId('person-partner')).not.toContainText('Admin')
    await expect(leo.getByTestId('admin-controls').getByRole('button')).toHaveText([/Let Mia back in/, /Pause Mia/, /Log Mia out everywhere/])

    await mia.getByRole('button', { name: /^People/ }).click()
    await expect(mia.getByTestId('person-me')).toContainText('Mia')
    await expect(mia.getByTestId('person-me')).not.toContainText('Admin')
    await expect(mia.getByTestId('person-partner')).toContainText('Leo')
    await expect(mia.getByTestId('person-partner')).toContainText('Admin')
    await expect(mia.getByTestId('admin-controls')).toHaveCount(0)
    await expect(mia.getByTestId('people-note')).toContainText('Leo opened this room and is its admin')
    // Both are told the same thing about what an admin cannot do.
    for (const page of [leo, mia]) await expect(page.getByTestId('people-note')).toContainText('Being the admin opens no envelope.')
    // Pages for handing out codes are the admin's alone.
    await mia.goto('/#/settings/invite')
    await expect(mia.getByTestId('people')).toBeVisible()
    await expect(mia.getByTestId('invite-code')).toHaveCount(0)
  })

  await test.step('the profile editor refuses the partner\'s name, because names are the log-in', async () => {
    await mia.goto('/#/settings/profile')
    await mia.getByLabel('Your name').fill('LEO')
    await mia.getByRole('button', { name: 'Save profile' }).click()
    await expect(complaint(mia)).toContainText('"LEO" is already the other name in this room')
    await mia.getByLabel('Your name').fill('Mia Bella')
    await mia.getByRole('button', { name: 'Save profile' }).click()
    await expect(toast(mia, 'Saved')).toBeVisible()
    await expect(leo.getByTestId('person-partner')).toContainText('Mia Bella')
  })
})

test('back to the room: log in on a second device, settings follow, wrong PINs, change PIN, log out', async ({ browser, request }) => {
  await request.post('/__cloud/reset')
  const { leo, mia } = await makeCouple(browser)
  const tablet = await openPhone(browser)

  await test.step('he prefers German and candlelight on his phone', async () => {
    await leo.goto('/#/settings')
    await expect(leo.getByText('These follow you to every device you log in on.')).toBeVisible()
    await leo.getByRole('radio', { name: 'Deutsch' }).click()
    await saved(leo, 'Leo', { lang: 'de' })
    await leo.getByRole('radio', { name: 'Bei Nacht' }).click()
    await expect(leo.locator('html')).toHaveAttribute('data-theme', 'dark')
    await saved(leo, 'Leo', { lang: 'de', theme: 'dark' })
    await settle(leo)
  })

  await test.step('"Back to the room": a wrong PIN and an unknown name get the same answer', async () => {
    await tablet.goto('/#/')
    await tablet.getByRole('button', { name: 'Back to the room' }).click()
    await expect(tablet.getByRole('heading', { name: 'Back to the room' })).toBeVisible()
    await expect(tablet.getByTestId('login')).toContainText('No time machine needed')
    await expect(tablet.getByTestId('login')).toContainText("Forgot your PIN? The room's admin can let you back in under Settings, People.")

    await tablet.getByRole('button', { name: 'Let me in' }).click()
    await expect(complaint(tablet)).toContainText('Type the name you use in the room')
    await logIn(tablet, 'Leo', '864209')
    await expect(complaint(tablet)).toHaveText('Name or PIN is not right. 4 tries left, then this name takes a break.')
    await expect(pinField(tablet, 'Your PIN')).toHaveValue('')
    await logIn(tablet, 'Nobody', '864209')
    await expect(complaint(tablet)).toHaveText('Name or PIN is not right. 4 tries left, then this name takes a break.')
  })

  await test.step('with name and PIN he is in, and German and candlelight arrive by themselves', async () => {
    await expect(tablet.locator('html')).toHaveAttribute('lang', 'en')
    await expect(tablet.locator('html')).toHaveAttribute('data-theme', 'light')
    await logIn(tablet, ' leo ', LEO.pin)
    await expect(tabs(tablet)).toBeVisible()
    await expect(tablet.locator('html')).toHaveAttribute('lang', 'de')
    await expect(tablet.locator('html')).toHaveAttribute('data-theme', 'dark')
    await tablet.goto('/#/settings')
    await expect(tablet.getByRole('heading', { name: 'Wir', exact: true })).toBeVisible()
    await expect(tablet.getByTestId('my-profile')).toContainText('Leo')
    await expect(tablet.getByTestId('partner-card')).toContainText('Mia')

    // And back again: a change on the tablet reaches the phone.
    await tablet.getByRole('radio', { name: 'English' }).click()
    await saved(tablet, 'Leo', { lang: 'en' })
    await tablet.getByRole('radio', { name: 'By day', exact: true }).click()
    await saved(tablet, 'Leo', { lang: 'en', theme: 'light' })
    await expect(leo.locator('html')).toHaveAttribute('lang', 'en')
    await expect(leo.locator('html')).toHaveAttribute('data-theme', 'light')
    // Her device keeps her own settings.
    await expect(mia.locator('html')).toHaveAttribute('lang', 'en')
    await expect(mia.locator('html')).toHaveAttribute('data-theme', 'light')
  })

  const stranger = await openPhone(browser)

  await test.step('five wrong tries pause the name, with the time it works again', async () => {
    await stranger.goto('/#/login')
    for (const left of ['4 tries left', '3 tries left', '2 tries left', 'One more try']) {
      await logIn(stranger, 'Mia', '864209')
      await expect(complaint(stranger)).toContainText(`Name or PIN is not right. ${left}`)
    }
    await logIn(stranger, 'Mia', '864209')
    // "until 14:32" (or "until tomorrow, 00:05" when the test runs just before midnight).
    await expect(complaint(stranger)).toHaveText(/^Too many wrong tries\. This name is paused until (tomorrow, )?\d{2}:\d{2}\. Try again then, or ask the room's admin to let you back in\.$/)
    // Even the right PIN has to wait now. Her own device stays logged in.
    await logIn(stranger, 'Mia', MIA.pin)
    await expect(complaint(stranger)).toContainText('This name is paused until')
    await mia.goto('/#/settings')
    await syncNow(mia)
    await expect(mia.getByTestId('my-profile')).toContainText('Mia')
  })

  await test.step('change PIN: checked like a new one, then "PIN changed"', async () => {
    await leo.getByRole('button', { name: /^PIN and devices/ }).click()
    await choosePin(leo, '111111', 'New PIN')
    await leo.getByRole('button', { name: 'Change PIN' }).click()
    await expect(leo.getByRole('alert')).toContainText('too easy to guess')
    await choosePin(leo, '864209', 'New PIN')
    await leo.getByRole('button', { name: 'Change PIN' }).click()
    await expect(toast(leo, 'PIN changed')).toBeVisible()
    await expect(pinField(leo, 'New PIN')).toHaveValue('')
  })

  await test.step('"Log out my other devices": the tablet is logged out and keeps its data until he logs in again', async () => {
    await leo.getByRole('button', { name: 'Log out my other devices' }).click()
    await expect(toast(leo, 'Logged out 1 other device')).toBeVisible()
    await leo.getByRole('button', { name: 'Log out my other devices' }).click()
    await expect(toast(leo, 'No other devices')).toBeVisible()

    await syncNow(tablet)
    await expect(tablet.getByRole('heading', { name: 'This device was logged out' })).toBeVisible()
    await expect(tablet.getByTestId('locked-out')).toContainText('Changes made here that were not sent yet are still on this device')
    // It still knows who used it. The old PIN is history, the new one works.
    await expect(tablet.getByLabel('Your name')).toHaveValue('Leo')
    await pinField(tablet, 'Your PIN').fill(LEO.pin)
    await tablet.getByRole('button', { name: 'Let me in' }).click()
    await expect(complaint(tablet)).toContainText('Name or PIN is not right. 4 tries left')
    await pinField(tablet, 'Your PIN').fill('864209')
    await tablet.getByRole('button', { name: 'Let me in' }).click()
    await expect(tablet.getByRole('heading', { name: 'Us', exact: true })).toBeVisible()
    await expect(tablet.getByTestId('partner-card')).toContainText('Mia')
  })

  await test.step('log out needs a connection, and then leaves nothing behind', async () => {
    await tablet.getByRole('button', { name: /^PIN and devices/ }).click()
    await tablet.context().setOffline(true)
    await tablet.getByRole('button', { name: 'Log out', exact: true }).click()
    await expect(complaint(tablet)).toContainText('Logging out needs a connection')
    await tablet.context().setOffline(false)

    // The connection is back, but in this very instant the app's last news can still be
    // "offline". A tap right now must take a fresh look instead of believing old news.
    await tablet.evaluate(() => {
      const { sync } = (window as unknown as { __whisperus: { sync: { status: { state: string } } } }).__whisperus
      sync.status = { ...sync.status, state: 'offline' }
      const logOut = [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Log out')
      logOut?.click()
    })
    await expect(tablet.getByTestId('welcome')).toBeVisible()
    // The device no longer knows whose it was.
    expect(await (await kit(tablet)).evaluate((k) => k.db.meta.count())).toBe(0)
    // His phone is still in.
    await syncNow(leo)
    await expect(leo.getByTestId('pin-page')).toBeVisible()
  })
})

test('the admin looks after the partner\'s seat: pause, switch on, let back in, log out everywhere, rescue', async ({ browser, request, baseURL }) => {
  await request.post('/__cloud/reset')
  const { leo, mia } = await makeCouple(browser)
  await leo.goto('/#/settings/people')
  await mia.goto('/#/settings')

  await test.step('pause: the sheet says what happens, then her seat is paused', async () => {
    // Her phone is out of reach for a moment, so it does not hear about the pause at once.
    await mia.context().setOffline(true)
    await control(leo, /^Pause Mia/).click()
    const sheet = leo.getByRole('dialog', { name: 'Pause Mia?' })
    await expect(sheet).toContainText('Mia cannot log in while the seat is paused, and every device Mia uses is locked.')
    await expect(sheet).toContainText('Nothing is deleted.')
    await sheet.getByRole('button', { name: 'Leave it' }).click()
    await expect(leo.getByTestId('person-partner')).not.toContainText('Paused')

    await control(leo, /^Pause Mia/).click()
    await leo.getByRole('dialog').getByRole('button', { name: 'Pause Mia' }).click()
    await expect(toast(leo, 'Mia is paused')).toBeVisible()
    await expect(leo.getByTestId('person-partner')).toContainText('Paused')
    await expect(control(leo, /^Switch Mia on again/)).toBeVisible()
  })

  await test.step('her device shows the paused screen and keeps what she changed meanwhile', async () => {
    // She edits her status before her device has heard about the pause.
    await mia.getByTestId('my-profile').click()
    await mia.getByRole('textbox', { name: 'Status line' }).fill('Paused but here')
    await mia.getByRole('button', { name: 'Save profile' }).click()
    await expect(mia.getByTestId('my-status')).toHaveText('Paused but here')
    await mia.context().setOffline(false)
    await syncNow(mia)
    await expect(mia.getByRole('heading', { name: 'Your seat is paused' })).toBeVisible()
    await expect(mia.getByTestId('paused')).toContainText('Leo can switch it on again. Nothing is lost')
    await mia.getByRole('button', { name: 'Check again' }).click()
    await expect(toast(mia, 'Still paused')).toBeVisible()

    // Logging out now would lose the unsent change: it asks first, with the number.
    await mia.getByRole('button', { name: 'Log out' }).click()
    const sheet = mia.getByRole('dialog', { name: 'Log out and lose this?' })
    await expect(sheet).toContainText('1 change on this device never reached the cloud')
    await sheet.getByRole('button', { name: 'Stay logged in' }).click()

    // A paused seat cannot log in anywhere else either.
    const other = await openPhone(browser)
    await other.goto('/#/login')
    await logIn(other, 'Mia', MIA.pin)
    await expect(complaint(other)).toContainText('Your seat in this room is paused')
    await other.context().close()
  })

  await test.step('switched on again, her device carries on and the waiting change arrives', async () => {
    await control(leo, /^Switch Mia on again/).click()
    await leo.getByRole('dialog').getByRole('button', { name: 'Switch Mia on again' }).click()
    await expect(toast(leo, 'Mia is on again')).toBeVisible()
    await expect(leo.getByTestId('person-partner')).not.toContainText('Paused')

    // Her device hears about it by itself; the pass here only spares the test the wait.
    await syncNow(mia)
    await expect(mia.getByTestId('paused')).toHaveCount(0)
    await expect(mia.getByTestId('my-status')).toHaveText('Paused but here')
    await leo.goto('/#/settings')
    await expect(leo.getByTestId('partner-card')).toContainText('Paused but here')
  })

  const newPhone = await openPhone(browser)

  await test.step('let her back in: a one-time code leads to "Welcome back" and a new PIN', async () => {
    await leo.goto('/#/settings/people')
    await control(leo, /^Let Mia back in/).click()
    await expect(leo.getByTestId('back-in')).toContainText('A one-time code. Mia opens it on any device and picks a new PIN.')
    await expect(leo.getByTestId('back-in')).toContainText('every other device of Mia gets logged out')
    const code = ((await leo.getByTestId('invite-code').textContent()) ?? '').trim()
    expect(code).toMatch(CODE)
    const link = (await leo.getByTestId('qr').getAttribute('data-qr-value')) ?? ''
    expect(link).toBe(`${baseURL}/#/join/${code}`)

    await newPhone.goto(link)
    await expect(newPhone.getByRole('heading', { name: 'Welcome back, Mia' })).toBeVisible()
    await expect(newPhone.getByTestId('restore-step')).toContainText('This code lets you back into Casa Leo')
    await expect(newPhone.getByTestId('restore-step')).toContainText('every other device of this profile gets logged out')
    // Only the PIN is asked for: no role, no name, no avatar.
    await expect(newPhone.getByLabel('Your name')).toHaveCount(0)
    await expect(newPhone.getByRole('radio')).toHaveCount(0)
    await choosePin(newPhone, '135790', 'New PIN')
    await newPhone.getByRole('button', { name: 'Back to the room' }).click()
    await expect(toast(newPhone, 'Welcome back, Mia')).toBeVisible()
    await expect(tabs(newPhone)).toBeVisible()
    await newPhone.goto('/#/settings')
    await expect(newPhone.getByTestId('my-status')).toHaveText('Paused but here')
  })

  await test.step('her old device was logged out by that; the old PIN is gone, the new one works', async () => {
    await syncNow(mia)
    await expect(mia.getByRole('heading', { name: 'This device was logged out' })).toBeVisible()
    await logIn(mia, 'Mia', MIA.pin)
    await expect(complaint(mia)).toContainText('Name or PIN is not right')
    await logIn(mia, 'Mia', '135790')
    await expect(mia.getByTestId('my-profile')).toContainText('Mia')
  })

  await test.step('log her out everywhere: both her devices, with the count in the toast', async () => {
    await leo.goto('/#/settings/people')
    await control(leo, /^Log Mia out everywhere/).click()
    const sheet = leo.getByRole('dialog', { name: 'Log Mia out everywhere?' })
    await expect(sheet).toContainText('Every device Mia is logged in on gets logged out. Nothing is deleted.')
    await sheet.getByRole('button', { name: 'Log Mia out', exact: true }).click()
    await expect(toast(leo, 'Mia is logged out on 2 devices')).toBeVisible()

    await syncNow(newPhone)
    await expect(newPhone.getByTestId('locked-out')).toBeVisible()
    await syncNow(mia)
    await expect(mia.getByTestId('locked-out')).toBeVisible()

    // "Start over on this device" asks first, and says what is lost.
    await mia.getByRole('button', { name: 'Start over on this device' }).click()
    const startOver = mia.getByRole('dialog', { name: 'Start over on this device?' })
    await expect(startOver).toContainText('This device forgets the room')
    await expect(startOver).toContainText('never reached the cloud')
    await startOver.getByRole('button', { name: 'Start over', exact: true }).click()
    await expect(mia.getByTestId('welcome')).toBeVisible()
  })

  await test.step('the owner\'s rescue code leads into the same "welcome back" flow, for the admin too', async () => {
    const rescue = await request.post('/__cloud/rescue?name=Leo')
    const code = ((await rescue.json()) as { result: string }).result
    expect(code).toMatch(CODE)

    const rescued = await openPhone(browser)
    await rescued.goto(`/#/join/${code}`)
    await expect(rescued.getByRole('heading', { name: 'Welcome back, Leo' })).toBeVisible()
    await choosePin(rescued, '246813', 'New PIN')
    await rescued.getByRole('button', { name: 'Back to the room' }).click()
    await expect(tabs(rescued)).toBeVisible()
    await rescued.goto('/#/settings/people')
    await expect(rescued.getByTestId('person-me')).toContainText('Leo')
    await expect(rescued.getByTestId('person-me')).toContainText('Admin')
    await expect(rescued.getByTestId('admin-controls')).toBeVisible()

    // His old phone was logged out by the rescue, like any other device of that profile.
    await syncNow(leo)
    await expect(leo.getByTestId('locked-out')).toBeVisible()
  })
})

test('settings: room name, my settings, sync details', async ({ browser, request }) => {
  await request.post('/__cloud/reset')
  const page = await openPhone(browser, { clipboard: true })

  await test.step('a room of one: Settings offers the invite again', async () => {
    await openRoom(page, { ...LEO, room: '' })
    await page.goto('/#/settings')
    // No name typed: the room got the default.
    await expect(page.getByTestId('room-name')).toHaveText('Our room')
    await expect(page.getByTestId('alone-card')).toContainText('One seat is still free')
    await page.getByRole('button', { name: 'Invite your partner' }).click()
    await expect(page.getByTestId('invite-code')).toHaveText(CODE)
    await page.getByRole('button', { name: 'Back' }).click()
    // Nothing about a recovery key is left anywhere.
    await expect(page.getByText(/recovery key/i)).toHaveCount(0)
  })

  await test.step('room name', async () => {
    await page.getByRole('button', { name: /Room name/ }).click()
    await page.getByLabel('Room name').fill('Chez nous')
    await page.getByRole('button', { name: 'Save name' }).click()
    await expect(page.getByTestId('room-name')).toHaveText('Chez nous')
  })

  await test.step('language and light', async () => {
    await page.getByRole('radio', { name: 'Deutsch' }).click()
    await expect(page.getByRole('heading', { name: 'Wir', exact: true })).toBeVisible()
    await expect(page.locator('html')).toHaveAttribute('lang', 'de')
    await saved(page, 'Leo', { lang: 'de' })
    await page.getByRole('radio', { name: 'English' }).click()
    await expect(page.getByRole('heading', { name: 'Us', exact: true })).toBeVisible()
    await saved(page, 'Leo', { lang: 'en' })

    await page.getByRole('radio', { name: 'After dark' }).click()
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
    await saved(page, 'Leo', { theme: 'dark' })
    await page.getByRole('radio', { name: 'By day', exact: true }).click()
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
    await saved(page, 'Leo', { theme: 'light' })
    // "Follow the device" hands the choice to the device (the test device is set to light).
    await page.getByRole('switch', { name: 'Follow the device' }).click()
    await saved(page, 'Leo', { theme: 'auto' })
    await expect(page.getByRole('radio', { name: 'By day', exact: true })).toBeChecked()
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
    await page.getByRole('radio', { name: 'After dark' }).click()
    await expect(page.getByRole('switch', { name: 'Follow the device' })).not.toBeChecked()
    await saved(page, 'Leo', { theme: 'dark' })
    await page.getByRole('radio', { name: 'By day', exact: true }).click()
    await saved(page, 'Leo', { theme: 'light' })
  })

  await test.step('sync: state in words, and a page with numbers, sync now and a report to copy', async () => {
    const section = page.getByTestId('sync-section')
    const details = page.getByTestId('sync-page')
    await settle(page)
    await expect(section.getByTestId('sync-words')).toHaveText('Everything is synced.')
    await section.getByRole('button', { name: /^Sync details/ }).click()
    await expect(details.getByTestId('sync-advice')).toContainText('Everything you did is in the cloud.')
    await expect(details.getByTestId('sync-pending')).toHaveText('0')
    await expect(details.getByTestId('sync-last')).toContainText('Today')
    await details.getByRole('button', { name: 'Sync now' }).click()
    await expect(toast(page, 'Synced')).toBeVisible()

    await details.getByRole('button', { name: 'Copy details' }).click()
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toContain('WhisperUs sync report')
    const report = await page.evaluate(() => navigator.clipboard.readText())
    expect(report).toContain('State: idle')
    expect(report).toContain('Changes waiting: 0')
    expect(report).toContain('people: 1')
    await page.getByRole('button', { name: 'Back' }).click()

    // Offline: the change waits on this device, and both places say so.
    await page.context().setOffline(true)
    await page.getByRole('button', { name: /Room name/ }).click()
    await page.getByLabel('Room name').fill('Offline room')
    await page.getByRole('button', { name: 'Save name' }).click()
    await expect(section.getByTestId('sync-words')).toContainText('Offline')
    await section.getByRole('button', { name: /^Sync details/ }).click()
    await expect(details.getByTestId('sync-pending')).toHaveText('1')
    await expect(details.getByTestId('sync-advice')).toContainText('no connection right now')
    await page.context().setOffline(false)
    await expect(details.getByTestId('sync-pending')).toHaveText('0')
    await page.getByRole('button', { name: 'Back' }).click()
    await expect(section.getByTestId('sync-words')).toHaveText('Everything is synced.')
  })
})
