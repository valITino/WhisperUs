import { expect, test, type BrowserContext, type Page } from '@playwright/test'
import { LEO, makeCouple, resetCloud, sealInBooth, tabs, toast } from './ship.helpers'

// The app lock: a six-digit code this device asks for before it shows anything. It keeps
// curious eyes out of a phone left on the sofa. Each device has its own, and it is not the PIN.

const contexts: BrowserContext[] = []
test.afterEach(async () => {
  for (const context of contexts.splice(0)) await context.close()
})

const CODE = '864213'
const codeField = (page: Page) => page.getByLabel('Code', { exact: true })
const lockScreen = (page: Page) => page.getByTestId('lock-screen')

/** What a phone does when the app goes out of sight and comes back. */
async function outOfSight(page: Page, state: 'hidden' | 'visible'): Promise<void> {
  await page.evaluate((next) => {
    Object.defineProperty(document, 'visibilityState', { value: next, configurable: true })
    document.dispatchEvent(new Event('visibilitychange'))
  }, state)
}

async function turnOn(page: Page): Promise<void> {
  await page.goto('/#/settings/lock')
  await codeField(page).fill(CODE)
  await page.getByLabel('Repeat code').fill(CODE)
  await page.getByRole('button', { name: 'Turn on the app lock' }).click()
  await expect(toast(page, 'App lock is on')).toBeVisible()
}

test('the app lock: choose a code, start locked, lock when out of sight, change it, turn it off', async ({ browser, request }) => {
  await resetCloud(request)
  const { mia } = await makeCouple(browser, contexts)

  await test.step('"Us" says the lock is off, and the page says honestly what it is', async () => {
    await mia.goto('/#/settings')
    await expect(mia.getByTestId('lock-row')).toContainText('Off. Anybody holding this device can open the app.')
    await mia.getByTestId('lock-row').click()
    const page = mia.getByTestId('lock-settings')
    await expect(page).toHaveAttribute('data-lock', 'off')
    await expect(page).toContainText('It is not the PIN you log in with, it belongs to this device only, and it does not encrypt what is stored on it.')
  })

  await test.step('a code is checked like a PIN, in its own words', async () => {
    await codeField(mia).fill('123456')
    await mia.getByLabel('Repeat code').fill('123456')
    await mia.getByRole('button', { name: 'Turn on the app lock' }).click()
    await expect(mia.getByRole('alert')).toContainText('That code is too easy to guess')
    await codeField(mia).fill(CODE)
    await mia.getByLabel('Repeat code').fill('864210')
    await mia.getByRole('button', { name: 'Turn on the app lock' }).click()
    await expect(mia.getByRole('alert')).toContainText('The two codes are not the same')
    await mia.getByLabel('Repeat code').fill(CODE)
    await mia.getByRole('button', { name: 'Turn on the app lock' }).click()
    await expect(toast(mia, 'App lock is on')).toBeVisible()
    await expect(mia.getByTestId('lock-settings')).toHaveAttribute('data-lock', 'on')
    // Whoever chose it stays in. The code itself is stored nowhere.
    await expect(lockScreen(mia)).toHaveCount(0)
    expect(await mia.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }))).not.toContain('864213')
  })

  await test.step('the next start is locked, and the lock screen gives nothing away', async () => {
    await mia.reload()
    await expect(lockScreen(mia)).toBeVisible()
    await expect(mia.getByRole('heading', { level: 1, name: 'Locked' })).toBeVisible()
    await expect(tabs(mia)).toHaveCount(0)
    // No names, no room, no hint of what is behind it.
    const words = (await lockScreen(mia).innerText()).replace(/\s+/g, ' ')
    for (const telling of ['Mia', 'Leo', 'Room 12', 'envelope', 'WhisperUs']) expect(words).not.toContain(telling)
    // An address typed by hand does not get past it either.
    await mia.goto('/#/settings/people')
    await expect(lockScreen(mia)).toBeVisible()
    await expect(mia.getByTestId('people')).toHaveCount(0)
  })

  await test.step('a wrong code says how many tries are left; the right one opens where she wanted to go', async () => {
    await codeField(mia).fill('000000')
    await expect(mia.getByTestId('lock-trouble')).toHaveText('That is not the code. 4 tries left.')
    await expect(codeField(mia)).toHaveValue('')
    await codeField(mia).fill(CODE)
    await expect(lockScreen(mia)).toHaveCount(0)
    await expect(mia.getByTestId('people')).toBeVisible()
  })

  await test.step('out of sight is locked at once, so not even the app switcher shows the room', async () => {
    await outOfSight(mia, 'hidden')
    await expect(lockScreen(mia)).toBeVisible()
    await outOfSight(mia, 'visible')
    await codeField(mia).fill(CODE)
    await expect(lockScreen(mia)).toHaveCount(0)
  })

  await test.step('with "After 1 minute" a quick look elsewhere does not lock', async () => {
    await mia.goto('/#/settings/lock')
    await mia.getByRole('radio', { name: 'After 1 minute' }).click()
    await expect(mia.getByRole('radio', { name: 'After 1 minute' })).toBeChecked()
    await outOfSight(mia, 'hidden')
    await outOfSight(mia, 'visible')
    await expect(lockScreen(mia)).toHaveCount(0)
    await expect(mia.getByTestId('lock-settings')).toBeVisible()
    await mia.getByRole('button', { name: 'Lock now' }).click()
    await expect(lockScreen(mia)).toBeVisible()
    await codeField(mia).fill(CODE)
    await expect(mia.getByTestId('lock-settings')).toBeVisible()
  })

  await test.step('a toast that was on its way when the lock fell does not show on the lock screen', async () => {
    await mia.goto('/#/settings/profile')
    await mia.getByRole('textbox', { name: 'Status line' }).fill('Just saved')
    await mia.getByRole('button', { name: 'Save profile' }).click()
    await outOfSight(mia, 'hidden')
    await outOfSight(mia, 'visible')
    // "After 1 minute" is set, so this did not lock. "Lock now" does, with the toast still up.
    await expect(toast(mia, 'Saved')).toBeVisible()
    await mia.goto('/#/settings/lock')
    await mia.getByRole('button', { name: 'Lock now' }).click()
    await expect(lockScreen(mia)).toBeVisible()
    await expect(mia.getByText('Saved', { exact: true })).toHaveCount(0)
    await codeField(mia).fill(CODE)
    await expect(mia.getByTestId('lock-settings')).toBeVisible()
  })

  await test.step('changing the code asks for the current one first', async () => {
    await mia.getByRole('button', { name: 'Change the code' }).click()
    const sheet = mia.getByTestId('lock-sheet')
    await sheet.getByLabel('Current code').fill('111222')
    await expect(sheet.getByRole('alert')).toContainText('That is not the code. 4 tries left.')
    await sheet.getByLabel('Current code').fill(CODE)
    await sheet.getByLabel('Code', { exact: true }).fill('975310')
    await sheet.getByLabel('Repeat code').fill('975310')
    await sheet.getByRole('button', { name: 'Change the code' }).click()
    await expect(toast(mia, 'Code changed')).toBeVisible()

    await mia.reload()
    await codeField(mia).fill(CODE)
    await expect(mia.getByTestId('lock-trouble')).toContainText('That is not the code.')
    await codeField(mia).fill('975310')
    await expect(mia.getByTestId('lock-settings')).toBeVisible()
  })

  await test.step('turning it off asks for the code too, and then the app opens freely again', async () => {
    await mia.getByRole('button', { name: 'Turn off the app lock' }).click()
    await mia.getByTestId('lock-sheet').getByLabel('Current code').fill('975310')
    await expect(toast(mia, 'App lock is off')).toBeVisible()
    await expect(mia.getByTestId('lock-settings')).toHaveAttribute('data-lock', 'off')
    await mia.reload()
    await expect(lockScreen(mia)).toHaveCount(0)
    await expect(mia.getByTestId('lock-settings')).toBeVisible()
  })
})

test('five wrong codes mean a wait; a forgotten code means logging the device out, and it says what that costs', async ({ browser, request }) => {
  await resetCloud(request)
  const { mia, leo } = await makeCouple(browser, contexts)
  // Something she sealed and has not opened yet: it exists on this phone only.
  await sealInBooth(mia, { words: 'Not yet.', teaser: 'For later' })
  await turnOn(mia)
  await mia.reload()
  await expect(lockScreen(mia)).toBeVisible()

  await test.step('five wrong tries, then nothing is accepted for half a minute', async () => {
    for (const left of [4, 3, 2]) {
      await codeField(mia).fill('000000')
      await expect(mia.getByTestId('lock-trouble')).toHaveText(`That is not the code. ${left} tries left.`)
    }
    await codeField(mia).fill('000000')
    await expect(mia.getByTestId('lock-trouble')).toHaveText('That is not the code. 1 try left.')
    await codeField(mia).fill('000000')
    await expect(mia.getByTestId('lock-trouble')).toHaveText(/^Too many tries\. The next one is possible in 0:(30|2\d)\.$/)
    // Not even the right code, and not after closing the app and opening it again.
    await codeField(mia).fill(CODE)
    await expect(lockScreen(mia)).toBeVisible()
    await mia.reload()
    await expect(mia.getByTestId('lock-trouble')).toContainText('Too many tries.')
  })

  await test.step('"Forgot the code?" explains the only way out, and what is lost with it', async () => {
    await mia.getByRole('button', { name: 'Forgot the code?' }).click()
    const sheet = mia.getByRole('dialog', { name: 'Forgot the code?' })
    await expect(sheet).toContainText('The only way past a forgotten code is to log this device out.')
    await expect(sheet).toContainText('Whatever you sealed on this device and have not opened yet exists only here, and is lost with it.')
    await sheet.getByRole('button', { name: 'Try the code again' }).click()
    await expect(sheet).toBeHidden()

    await mia.getByRole('button', { name: 'Forgot the code?' }).click()
    await mia.getByRole('dialog').getByRole('button', { name: 'Log out this device' }).click()
    // It counts what would be lost, and asks once more.
    const lose = mia.getByRole('dialog', { name: 'Log out and lose this?' })
    await expect(lose).toContainText('1 envelope you sealed here has not been opened yet.')
    await expect(lose).toContainText('What is inside exists only on this device')
    await lose.getByRole('button', { name: 'Log out anyway' }).click()
    await expect(mia.getByTestId('welcome')).toBeVisible()
  })

  await test.step('the device is empty now: no lock, no draft, and the room is still there for her', async () => {
    expect(await mia.evaluate(() => Object.keys(localStorage).filter((key) => /lock|boothDraft|prefs/.test(key)))).toEqual([])
    await mia.getByRole('button', { name: 'Back to the room' }).click()
    await mia.getByLabel('Your name').fill('Mia')
    await mia.getByLabel('Your PIN', { exact: true }).fill('271828')
    await mia.getByRole('button', { name: 'Let me in' }).click()
    await expect(tabs(mia)).toBeVisible()
    // No lock screen waits behind the log-in: a forgotten code is gone for good.
    await mia.reload()
    await expect(lockScreen(mia)).toHaveCount(0)
    await expect(mia.getByTestId('home')).toBeVisible()
  })

  await test.step('his phone has its own lock or none: hers never was his business', async () => {
    await leo.goto('/#/settings')
    await expect(leo.getByTestId('lock-row')).toContainText('Off.')
    await expect(leo.getByTestId('my-profile')).toContainText(LEO.name)
  })
})
