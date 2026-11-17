import { expect, test, type BrowserContext, type Page } from '@playwright/test'
import { go, joinByLink, kit, makeCouple, openPhone, openRoom, resetCloud, settle, skipFirstLook, syncNow, tabs, toast, type Kit } from './ship.helpers'

// What came with "closer": the first look after signing up, the check-in, the list,
// wishes and the cockpit. Two phones against the pretend cloud.
//
// The thread through all of it: what somebody notes about themselves stays on their
// phone unless they show it, part by part, and a "not for me" never leaves it at all.

const contexts: BrowserContext[] = []
test.beforeEach(async ({ request }) => {
  await resetCloud(request)
})
test.afterEach(async () => {
  for (const context of contexts.splice(0)) await context.close()
})

/** Everything the cloud would hand this phone, as text: for "is it in there anywhere?". */
async function cloudFor(page: Page): Promise<string> {
  const k = await kit(page)
  return k.evaluate(async (app: Kit) => JSON.stringify((await app.backend.pull(null)).tables))
}

/** What the other phone did has arrived here. */
async function arrive(from: Page, to: Page): Promise<void> {
  await settle(from)
  await syncNow(to)
}

test('somebody new takes a first look at themselves, and decides what of it is shown', async ({ browser }) => {
  const mia = await openPhone(browser, contexts)
  const leo = await openPhone(browser, contexts)
  await joinByLink(leo, await openRoom(mia), undefined, { firstLook: true })

  // It says what it is before it asks anything, and can be put off.
  await expect(leo.getByRole('heading', { name: 'Before you step in' })).toBeVisible()
  await expect(leo.getByRole('button', { name: 'Later', exact: true })).toBeVisible()
  await leo.getByRole('button', { name: 'Begin', exact: true }).click()

  // The first question: a step between two poles, a why, and who sees it. He shows where he stands, not why.
  const first = leo.getByTestId('question-say')
  await expect(leo.getByRole('heading', { name: 'How easy is it for you to say what you would like?' })).toBeVisible()
  await first.getByRole('radio', { name: /^2 \/ 5/ }).click()
  await first.getByRole('button', { name: 'Add a why' }).click()
  await first.getByRole('button', { name: 'I never had words for it', exact: true }).click()
  await first.getByLabel('A sentence more, if you like').fill('Nobody ever asked me.')
  await expect(first.getByRole('radio', { name: 'Only me' })).toHaveAttribute('aria-checked', 'true')
  await first.getByRole('radio', { name: 'Mia too' }).click()
  await first.getByRole('button', { name: 'My why', exact: true }).click()
  await leo.getByRole('button', { name: 'Next', exact: true }).click()

  // The second he answers for himself only; the others he passes. Nothing is required.
  await leo.getByTestId('question-no').getByRole('radio', { name: /^1 \/ 5/ }).click()
  for (let i = 0; i < 5; i++) await leo.getByRole('button', { name: 'Next', exact: true }).click()

  // A first walk through the list.
  await expect(leo.getByRole('heading', { name: 'What draws you' })).toBeVisible()
  await leo.getByTestId('item-soft.massage').click()
  await leo.getByRole('dialog').getByRole('radio', { name: /^I would like that/ }).click()
  await leo.getByRole('dialog').getByRole('button', { name: 'Save', exact: true }).click()
  await expect(leo.getByTestId('item-soft.massage')).toHaveAttribute('data-lean', 'yes')
  await leo.getByRole('button', { name: 'Next', exact: true }).click()

  // When to be asked. No reminder unless he says so.
  await expect(leo.getByRole('switch', { name: 'Remind me at these times' })).toHaveAttribute('aria-checked', 'false')
  await leo.getByLabel('First moment').fill('07:45')
  await leo.getByRole('button', { name: 'Done', exact: true }).click()
  await expect(toast(leo, 'Welcome')).toBeVisible()
  await expect(tabs(leo)).toBeVisible()
  // It was a first look: the room does not offer it again.
  await expect(leo.getByTestId('hello-card')).toHaveCount(0)

  // What he answered is on "About me", with what is shown marked as such.
  await go(leo, '/about')
  await expect(leo.getByTestId('about-say')).toContainText('Rather "Very hard"')
  await expect(leo.getByTestId('about-say')).toContainText('Shown')
  await expect(leo.getByTestId('about-no')).toContainText('Only me')
  await expect(leo.getByTestId('about-told')).toContainText('Not answered yet')
  await go(leo, '/settings')
  await expect(leo.getByTestId('checkin-row')).toContainText('No reminder')

  // She puts hers off, and the room keeps it for her.
  await mia.getByRole('button', { name: 'Done' }).click()
  await skipFirstLook(mia)
  await expect(toast(mia, 'It waits for you on the room')).toBeVisible()
  await expect(mia.getByTestId('hello-card')).toBeVisible()

  // She reads where he stands on the one question he showed. His why and his other answer are nowhere she could find them.
  await arrive(leo, mia)
  await go(mia, '/about')
  await expect(mia.getByTestId('about-theirs-list')).toContainText('How easy is it for you to say what you would like?')
  await expect(mia.getByTestId('about-theirs-list')).toContainText('Rather "Very hard"')
  await expect(mia.getByTestId('about-theirs-list').getByRole('listitem')).toHaveCount(1)
  const hers = await cloudFor(mia)
  expect(hers).not.toContain('Nobody ever asked')
  expect(hers).not.toContain('about.no-words')
  expect(hers).toContain('"value":2')
  expect(hers).not.toContain('"value":1')

  // The first look is an offer, not a nudge: she can decline it, and then it is gone for good.
  await go(mia, '/')
  await mia.getByTestId('hello-card').getByRole('button', { name: 'No, thank you' }).click()
  await expect(mia.getByTestId('hello-card')).toHaveCount(0)
  await settle(mia)
  await mia.reload()
  await expect(mia.getByTestId('home')).toBeVisible()
  await expect(mia.getByTestId('hello-card')).toHaveCount(0)
})

test('a check-in stays mine, and the other one sees exactly the parts I show', async ({ browser }) => {
  const { mia, leo } = await makeCouple(browser, contexts)

  // The room asks, quietly.
  await expect(mia.getByTestId('checkin-card')).toBeVisible()
  await mia.getByRole('button', { name: 'Check in', exact: true }).click()
  await expect(mia.getByTestId('checkin')).toBeVisible()

  // Saving nothing is not a check-in.
  await mia.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(mia.getByRole('alert')).toContainText('Tap at least one thing')

  await mia.getByTestId('scale-energy').getByRole('radio', { name: /^4 \/ 5/ }).click()
  await mia.getByTestId('scale-open').getByRole('radio', { name: /^1 \/ 5/ }).click()
  await mia.getByTestId('scale-desire').getByRole('radio', { name: /^5 \/ 5/ }).click()
  await mia.getByTestId('thoughts').getByRole('radio', { name: 'Often', exact: true }).click()
  await mia.getByTestId('happened').getByRole('button', { name: 'Tenderness', exact: true }).click()
  await mia.getByRole('button', { name: 'Add a why' }).click()
  await mia.getByTestId('why-checkin').getByRole('button', { name: 'Well rested', exact: true }).click()
  await mia.getByTestId('why-checkin').getByLabel('A sentence more, if you like').fill('Slept like a stone, and dreamt of you.')

  // The gentlest answer is the one already chosen. Showing is part by part.
  const share = mia.getByTestId('share-choice')
  await expect(share.getByRole('radio', { name: 'Only me' })).toHaveAttribute('aria-checked', 'true')
  await share.getByRole('radio', { name: 'Leo too' }).click()
  for (const kept of ['Desire', 'How often it was on my mind', 'What there was', 'My why']) await share.getByRole('button', { name: kept, exact: true }).click()
  await expect(share.getByRole('button', { name: 'Energy', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await expect(share.getByRole('button', { name: 'Desire', exact: true })).toHaveAttribute('aria-pressed', 'false')
  await mia.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(toast(mia, 'Saved')).toBeVisible()
  await expect(mia.getByTestId('checkin-done')).toContainText('Checked in at')

  // He knows before he asks: slow today, please. And nothing about the rest.
  await arrive(mia, leo)
  await go(leo, '/')
  const day = leo.getByTestId('their-day')
  await expect(day).toContainText('Mia today')
  await expect(day).toContainText('Rather "Wide awake"')
  await expect(day).toContainText('Slow today, please')
  await expect(day).not.toContainText('Desire')
  const his = await cloudFor(leo)
  for (const kept of ['Slept like a stone', 'checkin.rested', 'tender', 'desire', 'thoughts']) expect(his).not.toContain(kept)

  // Her own cockpit knows all of it; the one for two shows what she showed.
  await go(mia, '/cockpit')
  await expect(mia.getByTestId('cockpit-count')).toHaveText('1 check-in on 1 day.')
  for (const row of ['row-energy', 'row-open', 'row-desire', 'row-thoughts']) await expect(mia.getByTestId(row)).toBeVisible()
  await expect(mia.getByTestId('cockpit-happened')).toContainText('Tenderness')
  await expect(mia.getByTestId('cockpit-behind')).toContainText('Well rested')
  // One check-in is not a pattern, and the page says so instead of inventing one.
  await expect(mia.getByTestId('cockpit-said')).toContainText('Tendencies show once there are a few more check-ins')
  // A column can be read out in words.
  await mia.getByRole('group', { name: 'Desire, the last 30 days' }).focus()
  await mia.keyboard.press('ArrowLeft')
  await expect(mia.getByTestId('row-desire')).toContainText(': On fire')

  await go(leo, '/cockpit/us')
  await expect(leo.getByTestId('ours-energy')).toBeVisible()
  await expect(leo.getByTestId('ours-open')).toBeVisible()
  await expect(leo.getByTestId('ours-desire')).toHaveCount(0)
  await expect(leo.getByTestId('ours-thoughts')).toHaveCount(0)
  // The same page on her phone.
  await go(mia, '/cockpit/us')
  await expect(mia.getByTestId('ours-energy')).toBeVisible()
  await expect(mia.getByTestId('ours-desire')).toHaveCount(0)

  // Checking in again in the same half of the day changes the check-in instead of adding one,
  // and what she showed last time is offered again.
  await go(mia, '/checkin')
  await expect(mia.getByText(/^You checked in at /)).toBeVisible()
  await expect(mia.getByTestId('scale-energy').getByRole('radio', { name: /^4 \/ 5/ })).toHaveAttribute('aria-checked', 'true')
  await mia.getByTestId('share-choice').getByRole('radio', { name: 'Only me' }).click()
  await mia.getByRole('button', { name: 'Save', exact: true }).click()
  // Saving leads back to where she came from.
  await expect(mia.getByTestId('checkin')).toHaveCount(0)
  await go(mia, '/cockpit')
  await expect(mia.getByTestId('cockpit-count')).toHaveText('1 check-in on 1 day.')
  // Now nothing of it is shown any more.
  await arrive(mia, leo)
  await go(leo, '/')
  await expect(leo.getByTestId('their-day')).toHaveCount(0)

  // Removing it removes it.
  await go(mia, '/checkin')
  await mia.getByRole('button', { name: 'Remove this check-in' }).click()
  await mia.getByRole('dialog').getByRole('button', { name: 'Remove', exact: true }).click()
  await expect(toast(mia, 'Removed')).toBeVisible()
  await expect(mia.getByTestId('checkin')).toHaveCount(0)
  await go(mia, '/')
  await expect(mia.getByTestId('checkin-card')).toBeVisible()
  await go(mia, '/cockpit')
  await expect(mia.getByRole('heading', { name: 'Nothing noted yet' })).toBeVisible()
})

test('the list: each answers alone, and only what both answered openly shows for both', async ({ browser }) => {
  const { mia, leo } = await makeCouple(browser, contexts)

  await mia.getByRole('navigation').getByRole('button', { name: 'Wishes' }).click()
  await mia.getByTestId('open-list').click()
  await expect(mia.getByTestId('list')).toContainText('Leo never sees a "Not for me"')
  await expect(mia.getByTestId('list-answered')).toHaveText(/^0 of \d+ answered$/)

  // A yes with how strong and why; the why is hers until she says otherwise.
  await mia.getByTestId('item-soft.massage').click()
  let sheet = mia.getByRole('dialog')
  await sheet.getByRole('radio', { name: /^I would like that/ }).click()
  await sheet.getByRole('radio', { name: /^4:/ }).click()
  await sheet.getByRole('button', { name: 'Add a why' }).click()
  await sheet.getByRole('button', { name: 'With you I would dare', exact: true }).click()
  await expect(sheet.getByRole('switch', { name: 'If we meet here, Leo may read my why' })).toHaveAttribute('aria-checked', 'false')
  // "Save, next one" goes on to the next item nothing was said to yet.
  await sheet.getByRole('button', { name: 'Save, next one' }).click()
  await expect(mia.getByRole('dialog').getByRole('heading', { name: 'A bath together' })).toBeVisible()
  await mia.keyboard.press('Escape')
  await expect(mia.getByTestId('item-soft.massage')).toHaveAttribute('data-lean', 'yes')

  // A "not for me", with a why that is nobody's business.
  await mia.getByTestId('item-looks.mirrors').click()
  sheet = mia.getByRole('dialog')
  await sheet.getByRole('radio', { name: /^Not for me/ }).click()
  await sheet.getByRole('button', { name: 'Add a why' }).click()
  await sheet.getByLabel('A sentence more, if you like').fill('I do not like seeing myself.')
  await sheet.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(mia.getByTestId('item-looks.mirrors')).toHaveAttribute('aria-label', 'Mirrors: Not for me')

  // A yes she keeps to herself.
  await mia.getByTestId('item-play.roles').click()
  sheet = mia.getByRole('dialog')
  await sheet.getByRole('radio', { name: /^I would like that/ }).click()
  await sheet.getByRole('switch', { name: 'Keep this one to myself' }).click()
  await sheet.getByRole('button', { name: 'Save', exact: true }).click()

  // Something of her own on the list.
  await mia.getByRole('button', { name: 'Write your own' }).click()
  await mia.getByRole('dialog').getByLabel('In your own words').fill('Breakfast in bed, then back to bed')
  await mia.getByRole('dialog').getByRole('button', { name: 'Put it on the list' }).click()
  await expect(toast(mia, 'On the list')).toBeVisible()

  // She leaves the list. He sees her idea on it, and nothing of what she answered: not on
  // the page, not in what the cloud hands him.
  await go(mia, '/')
  await arrive(mia, leo)
  await go(leo, '/list')
  await expect(leo.getByTestId('list')).toContainText('Nothing in common yet')
  await expect(leo.getByRole('button', { name: 'Breakfast in bed, then back to bed: not answered' })).toBeVisible()
  let his = await cloudFor(leo)
  for (const kept of ['soft.massage', 'looks.mirrors', 'play.roles', 'seeing myself', 'leaning.trust']) expect(his).not.toContain(kept)

  // He says "curious" to the massage, yes to role play and to mirrors.
  for (const [item, lean] of [['soft.massage', /^I am curious/], ['play.roles', /^I would like that/], ['looks.mirrors', /^I would like that/]] as const) {
    await leo.getByTestId(`item-${item}`).click()
    await leo.getByRole('dialog').getByRole('radio', { name: lean }).click()
    await leo.getByRole('dialog').getByRole('button', { name: 'Save', exact: true }).click()
    await expect(leo.getByTestId(`item-${item}`)).not.toHaveAttribute('data-lean', '')
  }
  await settle(leo)
  await syncNow(leo)

  // One thing in common: the massage. Her quiet yes and her no met nothing, and he cannot tell the two from silence.
  await expect(leo.getByTestId('list-common-items').getByRole('listitem')).toHaveCount(1)
  await expect(leo.getByTestId('list-common-items')).toContainText('Massage')
  await expect(leo.getByTestId('list-common-items')).toContainText('I am curious / Mia: I would like that')
  his = await cloudFor(leo)
  expect(his).not.toContain('seeing myself')
  expect(his).not.toContain('leaning.trust')
  // Where they meet, he reads how strong it is for her, and not her why: she did not open it.
  await leo.getByTestId('item-soft.massage').click()
  await expect(leo.getByTestId('item-match')).toContainText('You and Mia meet here')
  await expect(leo.getByTestId('item-match')).toContainText('Very strong')
  await expect(leo.getByTestId('item-match')).not.toContainText('With you I would dare')
  await leo.keyboard.press('Escape')

  // Her phone learns it too, and points it out until she has looked.
  await syncNow(mia)
  await expect(mia.getByRole('navigation').getByRole('button', { name: 'Wishes, 1 new' })).toBeVisible()
  await go(mia, '/wishes')
  await expect(mia.getByTestId('open-list')).toContainText('1 thing in common')
  await mia.getByTestId('open-list').click()
  await expect(mia.getByTestId('list-common-items')).toContainText('New')
  await go(mia, '/')
  await expect(mia.getByRole('navigation').getByRole('button', { name: 'Wishes', exact: true })).toBeVisible()

  // She lets him read her why after all.
  await go(mia, '/list')
  await mia.getByTestId('item-soft.massage').click()
  await mia.getByRole('dialog').getByRole('switch', { name: 'If we meet here, Leo may read my why' }).click()
  await mia.getByRole('dialog').getByRole('button', { name: 'Save', exact: true }).click()
  await arrive(mia, leo)
  await go(leo, '/list')
  await leo.getByTestId('item-soft.massage').click()
  await expect(leo.getByTestId('item-match')).toContainText('With you I would dare')
  await leo.keyboard.press('Escape')

  // She changes her mind: what they had in common is gone on both phones.
  await mia.getByTestId('item-soft.massage').click()
  await mia.getByRole('dialog').getByRole('button', { name: 'Take my answer away' }).click()
  await expect(toast(mia, 'Taken away')).toBeVisible()
  await expect(mia.getByTestId('list')).toContainText('Nothing in common yet')
  await arrive(mia, leo)
  await expect(leo.getByTestId('list')).toContainText('Nothing in common yet')
  // His own answer is still his.
  await expect(leo.getByTestId('item-soft.massage')).toHaveAttribute('data-lean', 'maybe')
})

test('a wish is said plainly, answered with a decision and a why, and can change', async ({ browser }) => {
  const { mia, leo } = await makeCouple(browser, contexts)

  await go(mia, '/wishes')
  await mia.getByRole('button', { name: 'Make a wish' }).click()
  await expect(mia.getByTestId('wish-form')).toBeVisible()
  // A wish needs words.
  await mia.getByRole('button', { name: 'Send the wish' }).click()
  await expect(mia.getByRole('alert')).toContainText('Write what you wish for first')
  await mia.getByLabel('What do you wish for?').fill('A whole evening that is only ours.')
  await mia.getByRole('radio', { name: /^5 \/ 5/ }).click()
  await mia.getByTestId('why-wish').getByRole('button', { name: 'Nervous to ask', exact: true }).click()
  await expect(mia.getByText('Leo can read it as soon as you send it.')).toBeVisible()
  await mia.getByRole('button', { name: 'Send the wish' }).click()
  await expect(toast(mia, 'Sent')).toBeVisible()
  await expect(mia.getByTestId('wish-mine')).toContainText('Leo has not answered yet')
  const id = /#\/wishes\/([0-9a-f-]{36})/.exec(mia.url())?.[1]
  expect(id).toBeTruthy()

  // While it waits she can reword it.
  await mia.getByRole('button', { name: 'Change the wish' }).click()
  await mia.getByLabel('What do you wish for?').fill('A whole evening that is only ours. Phones off.')
  await mia.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(toast(mia, 'Saved')).toBeVisible()

  // She goes about her evening. His room points to the wish.
  await go(mia, '/')
  await arrive(mia, leo)
  await go(leo, '/')
  await expect(leo.getByRole('navigation').getByRole('button', { name: 'Wishes, 1 new' })).toBeVisible()
  await go(leo, '/wishes')
  await expect(leo.getByTestId('wishes-for-me').getByTestId('wish-row')).toContainText('Waiting for your answer')
  await leo.getByTestId('wish-row').click()
  await expect(leo.getByTestId('wish-card')).toContainText('A whole evening that is only ours. Phones off.')
  await expect(leo.getByTestId('wish-card')).toContainText('I long for it')
  await expect(leo.getByTestId('wish-card')).toContainText('Nervous to ask')

  // A wish that asks for a decision gets one. A kind "not now" comes with a why.
  const form = leo.getByTestId('wish-answer-form')
  await form.getByRole('button', { name: 'Send answer' }).click()
  await expect(form.getByRole('alert')).toContainText('Choose what you say first')
  await form.getByRole('radio', { name: /^Not now\. Ask me again/ }).click()
  await form.getByRole('button', { name: /I like that you asked/ }).click()
  await form.getByRole('radio', { name: /^3:/ }).click()
  await form.getByRole('button', { name: 'Another time, gladly', exact: true }).click()
  await form.getByLabel('A sentence more, if you like').fill('This week is too full. Ask me on Sunday.')
  await form.getByRole('button', { name: 'Send answer' }).click()
  await expect(toast(leo, 'Sent')).toBeVisible()
  await expect(leo.getByTestId('wish-answer')).toContainText('Not now. Ask me again')

  // She sees that an answer came, and reads it.
  await arrive(leo, mia)
  await expect(mia.getByRole('navigation').getByRole('button', { name: 'Wishes, 1 new' })).toBeVisible()
  await go(mia, '/wishes')
  const row = mia.getByTestId('wishes-from-me').getByTestId('wish-row')
  await expect(row).toContainText('Leo: Not now. Ask me again')
  await expect(row).toContainText('New')
  await row.click()
  await expect(mia.getByTestId('wish-answer')).toContainText('Ask me on Sunday')
  await expect(mia.getByTestId('wish-answer')).toContainText('I like that you asked')
  // What was answered stays as it was answered.
  await expect(mia.getByRole('button', { name: 'Change the wish' })).toHaveCount(0)
  await expect(mia.getByTestId('wish-mine')).toContainText('it stays as it was answered')
  await go(mia, '/wishes')
  await expect(mia.getByTestId('wishes-from-me').getByTestId('wish-row')).not.toContainText('New')

  // Sunday comes: the "not now" becomes a "yes".
  await leo.getByRole('button', { name: 'Change my answer' }).click()
  await leo.getByTestId('wish-answer-form').getByRole('radio', { name: /^Yes, I am in/ }).click()
  await leo.getByTestId('wish-answer-form').getByRole('button', { name: 'Send answer' }).click()
  await arrive(leo, mia)
  await expect(mia.getByTestId('wishes-from-me').getByTestId('wish-row')).toContainText('Leo: Yes, I am in')
  await expect(mia.getByTestId('wishes-from-me').getByTestId('wish-row')).toContainText('New')
  // The page for two counts wishes and yeses, and nobody's no.
  await go(mia, '/cockpit/us')
  await expect(mia.getByTestId('cockpit-common')).toContainText('1 wish said, 1 answered with a yes.')

  // She takes it back: gone for both, and the cloud forgets its words and his answer.
  await go(mia, `/wishes/${id}`)
  await mia.getByRole('button', { name: 'Take it back' }).click()
  await mia.getByRole('dialog').getByRole('button', { name: 'Take it back', exact: true }).click()
  await expect(toast(mia, 'Taken back')).toBeVisible()
  await arrive(mia, leo)
  await go(leo, '/wishes')
  await expect(leo.getByTestId('wishes')).toContainText('No wish from Mia yet')
  await go(leo, `/wishes/${id}`)
  await expect(leo.getByRole('heading', { name: 'This wish is gone' }).first()).toBeVisible()
  const his = await cloudFor(leo)
  for (const gone of ['whole evening', 'Phones off', 'Ask me on Sunday', 'another-time']) expect(his).not.toContain(gone)
})

test('a fantasy that may stay one needs no decision, and a wish can grow out of the list', async ({ browser }) => {
  const { mia, leo } = await makeCouple(browser, contexts)

  // Both answer the same item openly, so it is something to wish from.
  for (const page of [mia, leo]) {
    await go(page, '/list')
    await page.getByTestId('item-words.whisper').click()
    await page.getByRole('dialog').getByRole('radio', { name: /^I would like that/ }).click()
    await page.getByRole('dialog').getByRole('button', { name: 'Save', exact: true }).click()
    await settle(page)
  }
  await syncNow(mia)
  await mia.getByTestId('item-words.whisper').click()
  await mia.getByTestId('item-match').getByRole('button', { name: 'Make a wish of it' }).click()
  await expect(mia.getByTestId('wish-form')).toContainText('From the list')
  await expect(mia.getByLabel('What do you wish for?')).toHaveValue('Whispering')
  await mia.getByLabel('What do you wish for?').fill('Whisper to me what you thought the first time you saw me.')
  await mia.getByRole('radio', { name: /^A fantasy\. It may stay one/ }).click()
  await mia.getByRole('button', { name: 'Send the wish' }).click()
  await expect(mia.getByTestId('wish-card')).toContainText('From the list: Whispering')

  await arrive(mia, leo)
  await go(leo, '/wishes')
  await leo.getByTestId('wish-row').click()
  await expect(leo.getByTestId('wish-answer-form')).toContainText('A decision is not needed')
  await leo.getByTestId('wish-answer-form').getByRole('button', { name: /Tell me more/ }).click()
  await leo.getByTestId('wish-answer-form').getByRole('button', { name: 'Send answer' }).click()
  await expect(toast(leo, 'Sent')).toBeVisible()
  await arrive(leo, mia)
  await go(mia, '/wishes')
  await expect(mia.getByTestId('wishes-from-me').getByTestId('wish-row')).toContainText('Leo: Answered')
})

test('the two moments of the day are mine to choose, and so is the reminder', async ({ browser, request }) => {
  const { mia } = await makeCouple(browser, contexts)

  await go(mia, '/settings')
  await expect(mia.getByTestId('checkin-row')).toContainText('No reminder')
  await mia.getByTestId('checkin-row').getByRole('button').click()
  await mia.getByLabel('First moment').fill('07:15')
  await mia.getByLabel('Second moment').fill('22:05')
  await mia.getByRole('switch', { name: 'Remind me at these times' }).click()
  // This phone has notifications off: it says so, and where to change that.
  await expect(mia.getByRole('note')).toContainText('Notifications are off on this device')
  await mia.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(toast(mia, 'Saved')).toBeVisible()
  await expect(mia.getByTestId('checkin-row')).toContainText('A reminder at 07:15 and 22:05')

  // It lives on the profile, next to language and light, and neither overwrites the other.
  await mia.getByRole('radio', { name: 'Deutsch' }).click()
  await expect(mia.locator('html')).toHaveAttribute('lang', 'de')
  await settle(mia)
  await expect(mia.getByTestId('checkin-row')).toContainText('Eine Erinnerung um 07:15 und 22:05')
  const k = await kit(mia)
  const prefs = await k.evaluate(async (app: Kit) => (await app.db.members.get(await app.store.memberId())).prefs)
  expect(prefs).toMatchObject({ lang: 'de', checkin: { remind: true, times: ['07:15', '22:05'] } })
  // The cloud has it too: that is what the minute job reads.
  const members = JSON.parse(await (await request.get(`/__cloud/peek?table=members&id=${await k.evaluate((app: Kit) => app.store.memberId())}`)).text())
  expect(members.result.prefs.checkin).toEqual({ remind: true, times: ['07:15', '22:05'] })
})
