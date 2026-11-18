// Walks two phones through the whole app and takes Android-sized pictures of every
// screen, by day and after dark. For looking at, before a screen is called done.
//
//   npm run dev                              (in another terminal)
//   node tools/shots.mjs [outDir] [scale]    (default: ./shots, scale 2)
//
// It talks to the dev server and its pretend cloud only, and resets that cloud first.

import { mkdirSync } from 'node:fs'
import { chromium, devices } from '@playwright/test'

const port = Number(process.env.WHISPERUS_PORT ?? 5173)
const BASE = `http://127.0.0.1:${port}`
const out = process.argv[2] ?? 'shots'
const scale = Number(process.argv[3] ?? 2)
mkdirSync(out, { recursive: true })

// A pretend microphone that hums, and no question about using it: the booth records.
const browser = await chromium.launch({ args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] })

// One theme only: SHOTS_THEME=light node tools/shots.mjs
for (const theme of (process.env.SHOTS_THEME ?? 'light,dark').split(',')) {
  await fetch(`${BASE}/__cloud/reset`, { method: 'POST' })
  let n = 0
  const phone = async () => {
    const context = await browser.newContext({ ...devices['Pixel 7'], viewport: { width: 412, height: 915 }, deviceScaleFactor: scale, permissions: ['microphone', 'clipboard-read', 'clipboard-write'] })
    await context.addInitScript((t) => {
      if (!localStorage.getItem('whisperus.lang')) localStorage.setItem('whisperus.lang', 'en')
      if (!localStorage.getItem('whisperus.theme')) localStorage.setItem('whisperus.theme', t)
    }, theme)
    return context.newPage()
  }
  const shot = async (page, label, full = true) => {
    n += 1
    // Let the last movement on screen come to rest before the picture. (A candle that
    // flickers for ever is not waited for, and nothing is waited for longer than a second.)
    await page.evaluate(() => {
      const ending = document.getAnimations().filter((a) => a.effect?.getComputedTiming().iterations !== Infinity)
      return Promise.race([Promise.all(ending.map((a) => a.finished.catch(() => undefined))), new Promise((resolve) => setTimeout(resolve, 1000))])
    })
    await page.screenshot({ path: `${out}/${theme}-${String(n).padStart(2, '0')}-${label}.png`, fullPage: full })
  }
  const next = (page) => page.getByRole('button', { name: 'Next', exact: true }).click()
  const pin = async (page, value) => {
    await page.getByLabel('PIN', { exact: true }).fill(value)
    await page.getByLabel('Repeat PIN').fill(value)
  }

  // She opens the room.
  const mia = await phone()
  await mia.goto(BASE)
  await mia.getByTestId('welcome').waitFor()
  await shot(mia, 'welcome', false)
  await mia.getByRole('button', { name: 'Start from scratch' }).click()
  await mia.getByLabel('Your name').fill('Mia')
  await mia.getByLabel('Room name').fill('Room 12')
  await mia.getByRole('radio', { name: 'Cat' }).click()
  await mia.getByRole('radio', { name: 'Horns' }).click()
  await shot(mia, 'wizard-you')
  await next(mia)
  await mia.getByLabel('Status line').fill('Tonight I am brave')
  await shot(mia, 'wizard-status')
  await next(mia)
  await pin(mia, '271828')
  await shot(mia, 'wizard-pin')
  await mia.getByRole('button', { name: 'Open the room' }).click()
  await mia.getByTestId('qr').waitFor()
  await shot(mia, 'invite')
  const link = await mia.getByTestId('qr').getAttribute('data-qr-value')

  // He joins with her link.
  const leo = await phone()
  await leo.goto(link.replace(/^https?:\/\/[^/]+/, BASE))
  await leo.getByTestId('invitation').waitFor()
  await leo.getByLabel('Your name').fill('Leo')
  await shot(leo, 'join')
  await next(leo)
  await next(leo)
  await pin(leo, '314159')
  await leo.getByRole('button', { name: 'Join the room' }).click()

  // Somebody new takes a first look at themselves: a question, the list, the two moments.
  await leo.getByTestId('hello').waitFor()
  await shot(leo, 'hello', false)
  await leo.getByRole('button', { name: 'Begin', exact: true }).click()
  const question = leo.getByTestId('question-say')
  await question.getByRole('radio', { name: /^2 \/ 5/ }).click()
  await question.getByRole('button', { name: 'Add a why' }).click()
  await question.getByRole('button', { name: 'I never had words for it', exact: true }).click()
  await question.getByRole('radio', { name: 'Mia too' }).click()
  await shot(leo, 'hello-question')
  for (let i = 0; i < 6; i++) await next(leo)
  await leo.getByTestId('list-picker').waitFor()
  await leo.getByTestId('item-soft.massage').click()
  await leo.getByRole('dialog').getByRole('radio', { name: /^I would like that/ }).click()
  await leo.getByRole('dialog').getByRole('radio', { name: /^3:/ }).click()
  await shot(leo, 'list-item', false)
  await leo.getByRole('dialog').getByRole('button', { name: 'Save', exact: true }).click()
  await shot(leo, 'hello-list')
  await next(leo)
  await leo.getByTestId('checkin-times').waitFor()
  await shot(leo, 'hello-times', false)
  await leo.getByRole('button', { name: 'Done', exact: true }).click()
  await leo.getByTestId('home').waitFor()
  await shot(leo, 'room-empty', false)
  await mia.getByRole('button', { name: 'Done' }).click()
  await mia.getByTestId('hello').waitFor()
  await mia.getByRole('button', { name: 'Later', exact: true }).click()
  await mia.getByTestId('home').waitFor()

  // The booth.
  await mia.getByRole('navigation').getByRole('button', { name: 'Step into the booth' }).click()
  await mia.getByTestId('booth-say').waitFor()
  await mia.getByLabel('Your words').fill('I keep thinking about Saturday. The way you looked at me when the door closed.\n\nI did not say it then, but I loved every second of it.')
  await mia.getByRole('button', { name: 'Record', exact: true }).click()
  await mia.getByTestId('recorder').getByText('0:01').waitFor()
  await shot(mia, 'booth-recording')
  await mia.getByRole('button', { name: 'Stop', exact: true }).click()
  await mia.getByTestId('player').waitFor()
  await shot(mia, 'booth-say')
  await next(mia)
  await mia.getByTestId('booth-feel').waitFor()
  await mia.getByRole('radio', { name: /^4:/ }).click()
  await mia.getByRole('radio', { name: /^2 \/ 5/ }).click()
  await mia.getByRole('button', { name: 'It turned me on', exact: true }).click()
  await mia.getByRole('button', { name: 'Afraid you will see me differently', exact: true }).click()
  await mia.getByLabel('In your own words').fill('greedy')
  await mia.getByRole('button', { name: 'Add', exact: true }).click()
  await mia.getByLabel('A sentence more, if you like').fill('Because I never thought I would like it this much.')
  await shot(mia, 'booth-feel')
  await next(mia)
  await mia.getByTestId('booth-seal').waitFor()
  await mia.getByLabel('A line on the envelope').fill('About Saturday')
  await mia.getByRole('switch', { name: 'Show the heat on the outside' }).click()
  await mia.getByRole('radio', { name: /Tell me what it did to you/ }).click()
  await shot(mia, 'booth-seal')
  await mia.getByRole('radio', { name: 'At a time', exact: true }).click()
  await shot(mia, 'booth-seal-at-a-time')
  await mia.getByRole('radio', { name: 'When I say', exact: true }).click()
  await mia.getByRole('button', { name: 'Seal it', exact: true }).click()
  await mia.getByTestId('envelope-mine').waitFor()
  await shot(mia, 'mine-sealed')

  // He sees it waiting.
  await leo.getByTestId('envelope-row').first().waitFor()
  await shot(leo, 'room-waiting', false)
  await leo.getByTestId('envelope-row').first().click()
  await leo.getByTestId('waiting-line').waitFor()
  await shot(leo, 'theirs-waiting', false)

  // She opens words and feelings, and keeps her voice for later.
  await mia.getByRole('button', { name: 'Open it for Leo' }).click()
  await mia.getByTestId('open-pick').waitFor()
  await mia.getByRole('dialog').getByRole('switch', { name: 'Your voice' }).click()
  await shot(mia, 'mine-open-sheet', false)
  await mia.getByRole('dialog').getByRole('button', { name: 'Open it', exact: true }).click()
  await mia.getByText('Open for Leo.').waitFor()
  await shot(mia, 'mine-open')

  // He breaks the seal and answers.
  await leo.getByRole('button', { name: 'Break the seal' }).waitFor()
  await shot(leo, 'theirs-ready', false)
  await leo.getByRole('button', { name: 'Break the seal' }).click()
  await leo.getByTestId('inside').waitFor()
  await shot(leo, 'theirs-open')
  const form = leo.getByTestId('reply-form')
  await form.getByRole('button', { name: /I am here/ }).click()
  await form.getByRole('button', { name: /So hot/ }).click()
  await form.getByRole('radio', { name: /^5:/ }).click()
  await form.getByRole('button', { name: 'You are safe with me', exact: true }).click()
  await form.getByLabel('A sentence more, if you like').fill('Nothing about you changes for me. Except that I want you more.')
  await shot(leo, 'theirs-answering')
  await form.getByRole('button', { name: 'Send answer' }).click()
  await leo.getByTestId('reply').waitFor()
  await shot(leo, 'theirs-answered')

  // His answer reaches her.
  await mia.getByTestId('reply').waitFor()
  await shot(mia, 'mine-answered')
  await mia.getByRole('button', { name: 'Read it again' }).click()
  await mia.getByTestId('inside').waitFor()
  await shot(mia, 'mine-reading')
  for (const [page, name] of [[mia, 'room-hers'], [leo, 'room-his']]) {
    await page.goto(`${BASE}/#/`)
    await page.getByTestId('home').waitFor()
    await shot(page, name)
  }

  // Closer: a month of check-ins with some of it shown, the list, wishes, the cockpit.
  const act = (page, fn, arg) => page.evaluate(fn, arg)
  const settle = async (page) => {
    for (let i = 0; i < 20; i++) {
      const left = await page.evaluate(async () => {
        await window.__whisperus.sync.sync()
        return window.__whisperus.db.outbox.count()
      })
      if (left === 0) return
    }
  }
  const month = async (who) => {
    const a = window.__whisperus.actions
    const up = ['checkin.rested', 'checkin.time', 'checkin.touch', 'checkin.wanted']
    const down = ['checkin.tired', 'checkin.stress', 'checkin.head']
    let seed = who === 'mia' ? 7 : 19
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647
    const pick = (lo, hi) => Math.max(1, Math.min(5, Math.round(lo + rnd() * (hi - lo))))
    for (let d = 29; d >= 1; d--) {
      for (const hour of [7, 20]) {
        if (rnd() < 0.28) continue
        const at = new Date(Date.now() - d * 86_400_000)
        at.setUTCHours(hour, 10, 0, 0)
        const evening = hour === 20
        const desire = Math.min(5, pick(evening ? 2.4 : 1.2, evening ? 5 : 3.4) + ([5, 6].includes((at.getUTCDay() + 6) % 7) ? 1 : 0))
        const high = desire >= 4
        const body = {
          energy: pick(1.5, 5), mood: pick(2, 5), close: pick(2.4, 5), open: pick(1.5, 5), desire, kinky: pick(1, high ? 5 : 3),
          thoughts: Math.min(4, Math.max(0, Math.round(rnd() * (high ? 4 : 2)))),
          ...(high ? { fantasies: rnd() < 0.6 ? ['soft.massage', 'play.roles'] : ['words.whisper'] } : {}),
          ...(rnd() < 0.5 ? { happened: [['tender'], ['tender', 'kiss'], ['sex', 'tender'], ['kinky'], ['solo'], ['talk']][Math.floor(rnd() * 6)] } : {}),
          why: { chips: high ? [up[Math.floor(rnd() * 4)], up[Math.floor(rnd() * 4)]] : rnd() < 0.6 ? [down[Math.floor(rnd() * 3)]] : [], own: [], note: null },
        }
        await a.saveCheckin({ body, share: who === 'mia' ? ['close', 'open', 'mood'] : ['close', 'open', 'desire', 'mood', 'happened'], at })
      }
    }
    const leanings = who === 'mia' ? [['soft.massage', 'yes', 4], ['words.whisper', 'yes', 3], ['play.roles', 'maybe', 2], ['senses.blindfolds', 'dream', 4], ['pace.unhurried', 'yes', 5], ['looks.mirrors', 'no', null]] : [['words.whisper', 'maybe', 2], ['play.roles', 'yes', 4], ['senses.blindfolds', 'yes', 3], ['pace.unhurried', 'yes', 3], ['lead.charge', 'yes', 4]]
    for (const [item, lean, pull] of leanings) await a.saveLeaning(item, { lean, ...(pull ? { pull } : {}), why: { chips: [lean === 'no' ? 'leaning.not-mine' : 'leaning.trust'], own: [], note: null } }, { showWhy: true })
    for (const [question, value] of who === 'mia' ? [['say', 2], ['no', 2], ['told', 1], ['arrive', 2], ['mind', 3]] : [['no', 3], ['arrive', 4], ['mind', 5]]) await a.saveAbout(question, { value }, ['value'])
  }
  await act(mia, month, 'mia')
  await settle(mia)
  await act(leo, month, 'leo')
  await settle(leo)
  await act(mia, () => window.__whisperus.actions.addIdea('Breakfast in bed, then back to bed', 'own'))
  const wish = await act(mia, () => window.__whisperus.actions.makeWish({ text: 'A whole evening that is only ours. Phones off, door closed, and you decide what happens.', item: 'pace.unhurried', mode: 'do', want: 5, why: { chips: ['wish.long', 'wish.nervous'], own: ['only with you'], note: 'Because of that night in the rain.' } }))
  await act(leo, () => window.__whisperus.actions.makeWish({ text: 'Tell me one thing you have never told anybody.', item: null, mode: 'dream', want: 3, why: { chips: ['wish.seen'], own: [], note: null } }))
  await settle(mia)
  await settle(leo)
  await settle(mia)

  const go = (page, path) => page.evaluate((to) => window.__whisperus.navigate(to), path)
  await go(leo, '/checkin')
  await leo.getByTestId('checkin').waitFor()
  await leo.getByTestId('scale-energy').getByRole('radio', { name: /^4 \/ 5/ }).click()
  await leo.getByTestId('scale-open').getByRole('radio', { name: /^2 \/ 5/ }).click()
  await leo.getByTestId('scale-desire').getByRole('radio', { name: /^3 \/ 5/ }).click()
  await leo.getByTestId('thoughts').getByRole('radio', { name: 'Now and then', exact: true }).click()
  await leo.getByTestId('share-choice').getByRole('radio', { name: 'Mia too' }).click()
  await shot(leo, 'checkin')
  await leo.getByRole('button', { name: 'Save', exact: true }).click()
  await leo.getByTestId('home').waitFor()
  await settle(leo)
  await settle(mia)
  for (const [page, path, mark, name] of [[mia, '/', 'their-day', 'room-with-his-day'], [mia, '/news', 'news', 'news'], [mia, '/profile/partner', 'profile-theirs', 'profile-his'], [mia, '/profile', 'profile-mine', 'profile-mine'], [mia, '/wishes', 'wishes', 'wishes'], [mia, '/list', 'list', 'list'], [mia, '/wishes/new', 'wish-form', 'wish-new'], [leo, `/wishes/${wish}`, 'wish-theirs', 'wish-to-answer']]) {
    await go(page, path)
    await page.getByTestId(mark).waitFor()
    await shot(page, name)
  }
  const answer = leo.getByTestId('wish-answer-form')
  await answer.getByRole('radio', { name: /^Yes, I am in/ }).click()
  await answer.getByRole('button', { name: /I like that you asked/ }).click()
  await answer.getByRole('radio', { name: /^4:/ }).click()
  await answer.getByRole('button', { name: 'I want that too', exact: true }).click()
  await answer.getByRole('button', { name: 'Send answer' }).click()
  await leo.getByTestId('wish-answer').waitFor()
  await settle(leo)
  await settle(mia)
  for (const [path, mark, name] of [[`/wishes/${wish}`, 'wish-answer', 'wish-answered'], ['/cockpit', 'cockpit-count', 'cockpit-mine'], ['/cockpit/us', 'cockpit-common', 'cockpit-ours'], ['/about', 'about', 'about-me'], ['/settings/checkin', 'checkin-times', 'checkin-times']]) {
    await go(mia, path)
    await mia.getByTestId(mark).waitFor()
    await shot(mia, name)
  }

  // Us, and the lock.
  for (const [path, name, mark] of [['/settings', 'us', 'my-profile'], ['/settings/people', 'people', 'people'], ['/settings/notifications', 'notifications', 'notifications-page'], ['/settings/sync', 'sync', 'sync-page'], ['/settings/lock', 'lock-settings', 'lock-settings']]) {
    await mia.goto(`${BASE}/#${path}`)
    await mia.getByTestId(mark).waitFor()
    await shot(mia, name)
  }
  await mia.getByLabel('Code', { exact: true }).fill('864213')
  await mia.getByLabel('Repeat code').fill('864213')
  await mia.getByRole('button', { name: 'Turn on the app lock' }).click()
  await mia.getByRole('button', { name: 'Lock now' }).click()
  await mia.getByTestId('lock-screen').waitFor()
  await shot(mia, 'lock-screen', false)

  await mia.context().close()
  await leo.context().close()
  console.log(`${theme}: ${n} pictures`)
}

await browser.close()
console.log(`saved in ${out}/`)
