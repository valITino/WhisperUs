import { expect, test, type BrowserContext, type Page } from '@playwright/test'
import { go, kit, makeCouple, resetCloud, sealInBooth, settle, syncNow, tabs, toast, type Kit } from './ship.helpers'

// The news and the profiles: where the app says what is new, and where each of the two
// can be looked at. Two phones against the pretend cloud.
//
// What holds throughout: a line of news says who and what kind of thing, never what is in
// it; nobody is told that the other one read something; "new" lasts until the thing
// itself was looked at; and my own profile is, part by part, what the other one sees.

const contexts: BrowserContext[] = []
test.beforeEach(async ({ request }) => {
  await resetCloud(request)
})
test.afterEach(async () => {
  for (const context of contexts.splice(0)) await context.close()
})

/** What the other phone did has arrived here. */
async function arrive(from: Page, to: Page): Promise<void> {
  await settle(from)
  await syncNow(to)
}
const act = async <T>(page: Page, fn: (app: Kit) => Promise<T>): Promise<T> => (await kit(page)).evaluate(fn)
const bell = (page: Page) => page.getByTestId('news-bell')
const rows = (page: Page, list: 'news-fresh-list' | 'news-earlier-list') => page.getByTestId(list).getByTestId('news-row')

test('the news: the bell counts what was not looked at, a line leads to the thing, and looking at it is what clears it', async ({ browser }) => {
  const { mia, leo } = await makeCouple(browser, contexts)

  // A quiet room: a bell without a number, and a page that says so.
  await expect(bell(mia)).toHaveAttribute('aria-label', 'News')
  await bell(mia).click()
  await expect(mia.getByRole('heading', { level: 1, name: 'News' })).toBeVisible()
  await expect(mia.getByRole('heading', { name: 'Nothing yet' })).toBeVisible()

  // He wishes for something, shows an answer about himself (and keeps another), and writes onto the list.
  await act(leo, async (app) => {
    await app.actions.makeWish({ text: 'Tell me one thing you never told anybody', item: null, mode: 'dream', want: 3, why: { chips: [], own: ['only with you'], note: 'I am curious about you.' } })
    await app.actions.saveAbout('say', { value: 2, why: { chips: [], own: [], note: 'Nobody ever asked me.' } }, ['value'])
    await app.actions.saveAbout('no', { value: 1 }, [])
    await app.actions.addIdea('A walk at midnight', 'own')
  })
  await arrive(leo, mia)

  // On the room: the number on the bell, and the lines themselves. Not a word of what he wrote.
  await go(mia, '/')
  await expect(bell(mia)).toHaveAttribute('aria-label', 'News, 3 new')
  const here = mia.getByTestId('home-news')
  await expect(here.getByTestId('news-row')).toHaveCount(3)
  await expect(here).toContainText('Leo has a wish for you')
  await expect(here).toContainText('Leo showed you an answer')
  await expect(here).toContainText('Leo wrote something onto the list')
  for (const kept of ['Tell me one thing', 'only with you', 'curious about you', 'Nobody ever asked', 'midnight']) await expect(here).not.toContainText(kept)

  // From another tab, the numbers say where: his answer is reached from the room, the wish and the list from "Wishes".
  await go(mia, '/cockpit')
  await expect(tabs(mia).getByRole('button', { name: 'Room, 1 new' })).toBeVisible()
  await expect(tabs(mia).getByRole('button', { name: 'Wishes, 2 new' })).toBeVisible()

  // The news page has the same three, and each leads to the thing itself.
  await go(mia, '/news')
  await expect(rows(mia, 'news-fresh-list')).toHaveCount(3)
  await expect(mia.getByTestId('news')).not.toContainText('Tell me one thing')
  await mia.getByRole('button', { name: /^Leo has a wish for you/ }).click()
  await expect(mia.getByTestId('wish-theirs')).toContainText('Tell me one thing you never told anybody')

  // Having opened the wish, it is no longer new. It is still listed, under what came before.
  await go(mia, '/news')
  await expect(rows(mia, 'news-fresh-list')).toHaveCount(2)
  await expect(mia.getByTestId('news-earlier-list')).toContainText('Leo has a wish for you')

  // His answer is on his profile, marked as new while she looks at it. What he kept is not there.
  await mia.getByRole('button', { name: /^Leo showed you an answer/ }).click()
  const answers = mia.getByTestId('profile-about-list')
  await expect(answers.getByRole('listitem')).toHaveCount(1)
  await expect(answers).toContainText('How easy is it for you to say what you would like?')
  await expect(answers).toContainText('Rather "Very hard"')
  await expect(answers).toContainText('New')
  await expect(mia.getByTestId('profile-theirs')).not.toContainText('Nobody ever asked')

  // And what he wrote is on the list.
  await go(mia, '/news')
  await expect(rows(mia, 'news-fresh-list')).toHaveCount(1)
  await mia.getByRole('button', { name: /^Leo wrote something onto the list/ }).click()
  await expect(mia.getByRole('button', { name: 'A walk at midnight: not answered' })).toBeVisible()

  // Everything was looked at: no number, no lines on the room, and the page says there is nothing new.
  await go(mia, '/')
  await expect(bell(mia)).toHaveAttribute('aria-label', 'News')
  await expect(mia.getByTestId('home-news')).toHaveCount(0)
  await go(mia, '/cockpit')
  await expect(tabs(mia).getByRole('button', { name: 'Room', exact: true })).toBeVisible()
  await expect(tabs(mia).getByRole('button', { name: 'Wishes', exact: true })).toBeVisible()
  await go(mia, '/news')
  await expect(mia.getByTestId('news-none')).toHaveText('Nothing new right now.')
  await expect(rows(mia, 'news-earlier-list')).toHaveCount(3)
  // His profile, opened again, marks nothing as new any more.
  await go(mia, '/profile/partner')
  await expect(mia.getByTestId('profile-about-list')).toContainText('Rather "Very hard"')
  await expect(mia.getByTestId('profile-about-list')).not.toContainText('New')

  // From the news to the notifications of this device, which say who and never what.
  await go(mia, '/news')
  await mia.getByTestId('news-push').click()
  await expect(mia.getByRole('heading', { level: 1, name: 'Notifications' })).toBeVisible()
})

test('the news never tell one of them that the other one read something', async ({ browser }) => {
  const { mia, leo } = await makeCouple(browser, contexts)
  await sealInBooth(mia, { words: 'I keep thinking about Saturday.', teaser: 'About that night', wants: /Tell me what it did to you/, when: 'Right away' })
  await arrive(mia, leo)

  // For him it is news that it opened, and the line does not carry the one on the envelope.
  await go(leo, '/')
  await expect(bell(leo)).toHaveAttribute('aria-label', 'News, 1 new')
  await expect(leo.getByTestId('home-news')).toContainText('An envelope from Mia opened for you')
  await expect(leo.getByTestId('home-news')).not.toContainText('About that night')
  // Sealing it is no news for her.
  await go(mia, '/news')
  await expect(mia.getByRole('heading', { name: 'Nothing yet' })).toBeVisible()

  // He opens it. Her phone learns nothing it would make a line of.
  await leo.getByTestId('home-news').getByTestId('news-row').click()
  await leo.getByRole('button', { name: 'Break the seal' }).click()
  await expect(leo.getByTestId('inside')).toBeVisible()
  await arrive(leo, mia)
  await expect(mia.getByRole('heading', { name: 'Nothing yet' })).toBeVisible()
  await go(mia, '/')
  await expect(bell(mia)).toHaveAttribute('aria-label', 'News')

  // His answer is news for her, until she has read it.
  await leo.getByTestId('reply-form').getByRole('button', { name: /I am here/ }).click()
  await leo.getByTestId('reply-form').getByLabel('A sentence more, if you like').fill('Nothing about you changes for me.')
  await leo.getByTestId('reply-form').getByRole('button', { name: 'Send answer' }).click()
  await expect(leo.getByTestId('reply')).toBeVisible()
  // For him the envelope is no longer new: he opened it. It stays listed under what came before.
  await go(leo, '/')
  await expect(bell(leo)).toHaveAttribute('aria-label', 'News')
  await go(leo, '/news')
  await expect(leo.getByTestId('news-none')).toBeVisible()
  await expect(leo.getByTestId('news-earlier-list')).toContainText('An envelope from Mia opened for you')
  await arrive(leo, mia)
  await expect(bell(mia)).toHaveAttribute('aria-label', 'News, 1 new')
  await expect(mia.getByTestId('home-news')).toContainText('Leo answered your envelope')
  await expect(mia.getByTestId('home-news')).not.toContainText('Nothing about you changes')
  await mia.getByTestId('home-news').getByTestId('news-row').click()
  await expect(mia.getByTestId('reply')).toContainText('Nothing about you changes for me.')
  await go(mia, '/')
  await expect(bell(mia)).toHaveAttribute('aria-label', 'News')
})

test('a profile shows what was shown, and my own is what the other one sees of me', async ({ browser }) => {
  const { mia, leo } = await makeCouple(browser, contexts)

  // She notes a lot, and shows some of it. He answers the same item of the list, and wishes for something.
  await act(mia, async (app) => {
    await app.actions.updateMyProfile({ status: 'Slow today, please' })
    await app.actions.saveCheckin({ body: { mood: 2, close: 5, desire: 4, happened: ['tender'], why: { chips: [], own: [], note: 'Slept badly, but you held me.' } }, share: ['close', 'happened'] })
    await app.actions.saveAbout('say', { value: 2, why: { chips: [], own: [], note: 'I never had words for it.' } }, ['value'])
    await app.actions.saveAbout('told', { value: 1 }, [])
    await app.actions.saveLeaning('soft.massage', { lean: 'yes', pull: 4 })
    await app.actions.saveLeaning('looks.mirrors', { lean: 'no' })
    await app.actions.makeWish({ text: 'A whole evening that is only ours', item: null, mode: 'do', want: 5, why: { chips: [], own: [], note: null } })
  })
  await arrive(mia, leo)
  await act(leo, async (app) => {
    await app.actions.saveLeaning('soft.massage', { lean: 'maybe', pull: 2 })
    await app.actions.saveLeaning('looks.mirrors', { lean: 'yes' })
  })
  await arrive(leo, mia)
  await syncNow(leo)

  // Her own profile, from the picture on the room: what he sees of her, and nothing she kept.
  await go(mia, '/')
  await mia.getByTestId('my-avatar').click()
  const hers = mia.getByTestId('profile-mine')
  await expect(mia.getByRole('heading', { level: 1, name: 'Your profile' })).toBeVisible()
  await expect(hers.getByTestId('profile-lead')).toContainText('This is what Leo sees of you')
  await expect(hers.getByTestId('profile-status')).toHaveText('Slow today, please')
  const herDay = hers.getByTestId('profile-checkin-shown')
  await expect(herDay).toContainText('Closeness')
  await expect(herDay).toContainText('Tenderness')
  for (const kept of ['Desire', 'The day', 'Slept badly']) await expect(herDay).not.toContainText(kept)
  await expect(hers.getByTestId('profile-about-list').getByRole('listitem')).toHaveCount(1)
  await expect(hers.getByTestId('profile-about')).not.toContainText('never had words')
  await expect(hers.getByTestId('profile-to-about')).toContainText('2 of 11 answered, 1 shown')
  await expect(hers.getByTestId('profile-common-list').getByRole('listitem')).toHaveCount(1)
  await expect(hers.getByTestId('profile-common-list')).toContainText('You: I would like that')
  await expect(hers.getByTestId('profile-common-list')).toContainText('Leo: I am curious')
  await expect(hers.getByTestId('profile-common')).not.toContainText('Mirrors')
  await expect(hers.getByTestId('profile-wishes-list')).toContainText('A whole evening that is only ours')

  // His page of her, from her name on his room: the same things, read from his phone.
  await go(leo, '/')
  await leo.getByTestId('partner-row').click()
  const his = leo.getByTestId('profile-theirs')
  await expect(his.getByTestId('profile-name')).toHaveText('Mia')
  await expect(his.getByTestId('profile-status')).toHaveText('Slow today, please')
  await expect(his.getByTestId('profile-lead')).toContainText('What Mia chose to show you')
  expect(await his.getByTestId('profile-checkin-shown').innerText()).toBe(await herDay.innerText())
  await expect(his.getByTestId('profile-about-list').getByRole('listitem')).toHaveCount(1)
  await expect(his.getByTestId('profile-about-list')).toContainText('Rather "Very hard"')
  await expect(his.getByTestId('profile-common-list')).toContainText('Mia: I would like that')
  await expect(his.getByTestId('profile-common-list')).toContainText('You: I am curious')
  await expect(his.getByTestId('profile-wishes-list')).toContainText('A whole evening that is only ours')
  for (const kept of ['Slept badly', 'never had words', 'Mirrors', 'Desire']) await expect(his).not.toContainText(kept)
  // Her wish leads to the wish, where he can answer it.
  await his.getByTestId('profile-wishes-list').getByTestId('wish-row').click()
  await expect(leo.getByTestId('wish-answer-form')).toBeVisible()

  // "Us" is the two of them: each card opens a profile.
  await go(leo, '/settings')
  await leo.getByTestId('partner-card').click()
  await expect(leo.getByTestId('profile-theirs')).toBeVisible()
  await go(leo, '/settings')
  await leo.getByTestId('my-profile').click()
  await expect(leo.getByTestId('profile-mine')).toBeVisible()

  // From her profile she changes what is shown of her, and sees it change there.
  await mia.getByRole('button', { name: 'Edit profile' }).click()
  await mia.getByRole('textbox', { name: 'Status line' }).fill('Come closer')
  await mia.getByRole('button', { name: 'Save profile' }).click()
  await expect(toast(mia, 'Saved')).toBeVisible()
  await expect(mia.getByTestId('profile-status')).toHaveText('Come closer')
  await mia.getByTestId('profile-to-about').click()
  await mia.getByTestId('about-told').click()
  await mia.getByRole('dialog').getByRole('radio', { name: 'Leo too' }).click()
  await mia.getByRole('dialog').getByRole('button', { name: 'Save', exact: true }).click()
  await expect(toast(mia, 'Saved').last()).toBeVisible()
  await go(mia, '/profile')
  await expect(mia.getByTestId('profile-about-list').getByRole('listitem')).toHaveCount(2)
  await expect(mia.getByTestId('profile-to-about')).toContainText('2 of 11 answered, 2 shown')
})
