import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { answer, markSeen, openLayers, sealEnvelope, type Draft } from '../../src/data/actions'
import { viewOf } from '../../src/data/envelopes'
import { FakeCloud } from '../../src/data/fake/cloudCore'
import { matchesOf, saveAbout, saveCheckin, saveLeaning } from '../../src/data/journal'
import { freshCount, latest, NEWS_EARLIER, newsOf, NOTHING_SEEN, type NewsItem, type NewsRows, type Seen } from '../../src/data/news'
import { NO_WHY, type ID, type Wish } from '../../src/data/types'
import { addIdea, answerWish, makeWish, takeBackWish } from '../../src/data/wishes'
import { makeCouple, settle, type Phone } from './helpers'

// The news: what the bell counts and what the news page lists. Played by two phones
// against the pretend cloud, then read the way the screens read it (newsOf is pure).
//
// What must hold whatever else changes: a line never carries what the thing says, there
// is no line that tells one of them that the other one read something, and "new" lasts
// exactly until the thing itself was looked at.

let cloud: FakeCloud
let her: Phone
let him: Phone
let herId: ID

beforeEach(async () => {
  cloud = new FakeCloud()
  ;({ her, him } = await makeCouple(cloud))
  herId = (await her.store.memberId()) as ID
})

async function rowsOf(phone: Phone, seen: Partial<Seen> = {}, now = Date.now()): Promise<NewsRows> {
  const meId = (await phone.store.memberId()) as ID
  const [envelopes, keys, vault, wishes, leanings, notes, ideas] = await Promise.all([phone.db.envelopes.toArray(), phone.db.keys.toArray(), phone.db.vault.toArray(), phone.db.wishes.toArray(), phone.db.leanings.toArray(), phone.db.notes.toArray(), phone.db.ideas.toArray()])
  const views = envelopes.filter((envelope) => !envelope.deletedAt).map((envelope) => viewOf(envelope, meId, { keys, vault }, now))
  return { meId, views, keys, wishes, matches: matchesOf(leanings, meId), notes, ideas, seen: { ...NOTHING_SEEN, ...seen } }
}
const news = async (phone: Phone, seen: Partial<Seen> = {}): Promise<NewsItem[]> => newsOf(await rowsOf(phone, seen), Date.now())
const kinds = (items: NewsItem[]) => items.map((item) => `${item.kind}${item.fresh ? '*' : ''}`)

const SECRET = 'I keep thinking about Saturday'
const draft = (overrides: Partial<Draft> = {}): Draft => ({ feel: null, words: SECRET, voice: null, teaser: 'About that night', heatOutside: null, wants: 'listen', keep: 'keep', openMode: 'hand', opensAt: null, release: [], ...overrides })

describe('an empty room', () => {
  it('has no news for either of them', async () => {
    expect(await news(her)).toEqual([])
    expect(await news(him)).toEqual([])
  })
})

describe('envelopes', () => {
  it('one that waits is a line for the one it is for, and not counted; sealing it is no news for its author', async () => {
    const id = await sealEnvelope(her.kit, draft())
    await settle(her, him)
    expect(await news(him)).toMatchObject([{ id: `envelope:${id}`, kind: 'sealed', to: `/envelope/${id}`, fresh: false, count: 1 }])
    expect(freshCount(await news(him))).toBe(0)
    expect(await news(her)).toEqual([])
  })

  it('one that opens is new until it was opened; that it was opened is never told to its author', async () => {
    const id = await sealEnvelope(her.kit, draft())
    await openLayers(her.kit, id, ['words'])
    await settle(her, him)
    expect(kinds(await news(him))).toEqual(['ready*'])
    expect(freshCount(await news(him))).toBe(1)

    await markSeen(him.kit, id, ['words'])
    await settle(him, her)
    // The same line, no longer new.
    expect(await news(him)).toMatchObject([{ id: `envelope:${id}`, kind: 'ready', fresh: false }])
    // Her phone knows when he opened it (the row says so). The news do not make a line of it.
    expect((await her.db.envelopes.get(id))?.seen.words).toBeTruthy()
    expect(await news(her)).toEqual([])
  })

  it('an answer is new for the author until they looked at it', async () => {
    const id = await sealEnvelope(her.kit, draft({ openMode: 'now', release: ['words'] }))
    await settle(her, him)
    await markSeen(him.kit, id, ['words'])
    await answer(him.kit, id, { taps: ['here'], heat: 4, why: { chips: [], own: [], note: 'Nothing about you changes for me.' } })
    await settle(him, her)

    const hers = await news(her)
    expect(hers).toMatchObject([{ id: `answered:${id}`, kind: 'answered', to: `/envelope/${id}`, fresh: true }])
    const repliedAt = (await her.db.envelopes.get(id))?.reply?.at as string
    expect(hers[0].at).toBe(repliedAt)
    expect(kinds(await news(her, { replies: { [id]: repliedAt } }))).toEqual(['answered'])
    // Answering is not news for the one who answered.
    expect(kinds(await news(him))).toEqual(['ready'])
  })
})

describe('wishes', () => {
  const wish = { text: 'A whole evening that is only ours', item: null, mode: 'do' as const, want: 5 as const, why: { chips: [], own: [], note: 'Because of that night in the rain.' } }

  it('a wish is new for the other one until it was opened, or answered', async () => {
    const id = await makeWish(her.kit, wish)
    await settle(her, him)
    expect(await news(him)).toMatchObject([{ id: `wished:${id}`, kind: 'wished', to: `/wishes/${id}`, fresh: true }])
    expect(kinds(await news(him, { wishes: { [id]: true } }))).toEqual(['wished'])
    expect(await news(her)).toEqual([])

    await answerWish(him.kit, id, { decision: 'no', taps: [], heat: null, why: NO_WHY })
    expect(kinds(await news(him))).toEqual(['wished'])
  })

  it('an answer is new for the one who wished, and the line does not say what was decided', async () => {
    const id = await makeWish(her.kit, wish)
    await settle(her, him)
    await answerWish(him.kit, id, { decision: 'no', taps: ['glad'], heat: 2, why: { chips: [], own: [], note: 'Not this one, but ask me for another.' } })
    await settle(him, her)

    const hers = await news(her)
    expect(hers).toMatchObject([{ id: `decided:${id}`, kind: 'decided', to: `/wishes/${id}`, fresh: true, count: 1 }])
    expect(Object.keys(hers[0]).sort()).toEqual(['at', 'count', 'fresh', 'id', 'kind', 'to'])
    const answeredAt = ((await her.db.wishes.get(id)) as Wish).answer?.at as string
    expect(kinds(await news(her, { wishAnswers: { [id]: answeredAt } }))).toEqual(['decided'])
  })

  it('a wish that was taken back is no line any more', async () => {
    const id = await makeWish(her.kit, wish)
    await settle(her, him)
    await takeBackWish(her.kit, id)
    await settle(her, him)
    expect(await news(him)).toEqual([])
  })
})

describe('the list', () => {
  it('is one line: what is new in common, then how much there is; a "not for me" never shows in it', async () => {
    await saveLeaning(her.kit, 'soft.massage', { lean: 'yes', pull: 4 })
    await saveLeaning(her.kit, 'looks.mirrors', { lean: 'no' })
    await settle(her, him)
    expect(await news(him)).toEqual([])
    expect(await news(her)).toEqual([])

    await saveLeaning(him.kit, 'soft.massage', { lean: 'maybe' })
    await saveLeaning(him.kit, 'looks.mirrors', { lean: 'yes' })
    await settle(him, her)
    await settle(her, him)
    for (const phone of [her, him]) expect(await news(phone)).toMatchObject([{ id: 'matched', kind: 'matched', to: '/list', fresh: true, count: 1 }])

    await saveLeaning(her.kit, 'words.whisper', { lean: 'dream' })
    await saveLeaning(him.kit, 'words.whisper', { lean: 'yes' })
    await settle(her, him)
    await settle(him, her)
    // One of the two has been looked at: the line counts the one that has not.
    expect(await news(her, { matches: ['soft.massage'] })).toMatchObject([{ kind: 'matched', fresh: true, count: 1 }])
    // Both looked at: the line stays, and says how many there are.
    expect(await news(her, { matches: ['soft.massage', 'words.whisper'] })).toMatchObject([{ kind: 'matched', fresh: false, count: 2 }])
  })

  it('something the other one wrote onto it is new until the list was looked at', async () => {
    await addIdea(her.kit, 'Breakfast in bed, then back to bed', 'own')
    await settle(her, him)
    const his = await news(him)
    expect(his).toMatchObject([{ id: 'idea', kind: 'idea', to: '/list', fresh: true, count: 1 }])
    expect(kinds(await news(him, { ideasUntil: his[0].at }))).toEqual(['idea'])
    expect(await news(her)).toEqual([])
  })
})

describe('what the other one shows about themselves', () => {
  it('an answer is new until their profile was looked at, new again when it changes, and gone when it is no longer shown', async () => {
    await saveAbout(her.kit, 'say', { value: 2 }, ['value'])
    await saveAbout(her.kit, 'no', { value: 1 }, [])
    await settle(her, him)
    const first = await news(him)
    // One answer is shown. The one she kept to herself is not counted, and not known.
    expect(first).toMatchObject([{ id: 'about', kind: 'about', to: '/profile/partner', fresh: true, count: 1 }])
    expect(await news(her)).toEqual([])
    const looked = { aboutUntil: first[0].at }
    expect(await news(him, looked)).toMatchObject([{ kind: 'about', fresh: false, count: 1 }])

    await saveAbout(her.kit, 'say', { value: 4 }, ['value'])
    await settle(her, him)
    expect(await news(him, looked)).toMatchObject([{ kind: 'about', fresh: true, count: 1 }])

    await saveAbout(her.kit, 'say', { value: 4 }, [])
    await settle(her, him)
    expect(await news(him, looked)).toEqual([])
  })

  it('a check-in with something shown is a line, and never counted: it is on the room already', async () => {
    await saveCheckin(her.kit, { body: { mood: 2, desire: 5 }, share: [] })
    await settle(her, him)
    expect(await news(him)).toEqual([])

    await saveCheckin(her.kit, { body: { mood: 2, desire: 5 }, share: ['mood'] })
    await settle(her, him)
    expect(await news(him)).toMatchObject([{ id: 'shown', kind: 'shown', to: '/profile/partner', fresh: false, count: 1 }])
    expect(await news(her)).toEqual([])
  })
})

describe('what a line carries', () => {
  it('never a word of the thing itself: not a teaser, a wish, a why, an idea or an answer', async () => {
    const envelope = await sealEnvelope(her.kit, draft({ openMode: 'now', release: ['words'] }))
    const wish = await makeWish(her.kit, { text: 'Tell me one thing you never told anybody', item: 'soft.massage', mode: 'dream', want: 3, why: { chips: ['wish.seen'], own: ['only with you'], note: 'I am curious about you.' } })
    await addIdea(her.kit, 'A walk at midnight', 'own')
    await saveAbout(her.kit, 'say', { value: 2, why: { chips: [], own: [], note: 'I never had words for it.' } }, ['value', 'why'])
    await saveLeaning(her.kit, 'soft.massage', { lean: 'yes', pull: 5 })
    await settle(her, him)
    await markSeen(him.kit, envelope, ['words'])
    await answer(him.kit, envelope, { taps: ['here'], heat: 5, why: { chips: [], own: [], note: 'I want you more.' } })
    await answerWish(him.kit, wish, { decision: 'later', taps: [], heat: 3, why: { chips: [], own: [], note: 'Ask me on Sunday.' } })
    await saveLeaning(him.kit, 'soft.massage', { lean: 'yes', pull: 2 })
    await settle(him, her)
    await settle(her, him)

    for (const phone of [her, him]) {
      const text = JSON.stringify(await news(phone))
      for (const word of [SECRET, 'About that night', 'Tell me one thing', 'only with you', 'curious about you', 'midnight', 'never had words', 'want you more', 'Sunday', 'later', 'massage']) expect(text).not.toContain(word)
    }
    // And each of them has something to look at.
    expect(kinds(await news(her)).sort()).toEqual(['answered*', 'decided*', 'matched*'])
    expect(kinds(await news(him)).sort()).toEqual(['about*', 'idea*', 'matched*', 'ready', 'wished'])
    expect(freshCount(await news(him))).toBe(3)
  })
})

describe('how much is listed', () => {
  const at = (daysAgo: number) => new Date(Date.now() - daysAgo * 86_400_000).toISOString()
  const wishFrom = (author: ID, id: string, daysAgo: number, answered = true): Wish => ({ id, householdId: 'room', authorId: author, text: 'x', item: null, mode: 'do', want: null, why: NO_WHY, answer: answered ? { decision: 'yes', taps: [], heat: null, why: NO_WHY, at: at(daysAgo) } : null, createdAt: at(daysAgo), updatedAt: at(daysAgo), deletedAt: null })
  const rows = (wishes: Wish[], seen: Partial<Seen> = {}): NewsRows => ({ meId: herId, views: [], keys: [], wishes, matches: [], notes: [], ideas: [], seen: { ...NOTHING_SEEN, ...seen } })

  it('newest first, whatever kind it is', () => {
    const items = newsOf(rows([wishFrom('leo', 'a', 3), wishFrom('leo', 'b', 1), wishFrom(herId, 'c', 2)]), Date.now())
    expect(items.map((item) => item.id)).toEqual(['wished:b', 'decided:c', 'wished:a'])
  })

  it('what was looked at leaves after thirty days; what was not stays however old it is', () => {
    const old = [wishFrom('leo', 'seen', 45), wishFrom('leo', 'unseen', 45, false)]
    expect(newsOf(rows(old), Date.now()).map((item) => `${item.id}${item.fresh ? '*' : ''}`)).toEqual(['wished:unseen*'])
  })

  it('no more than twenty lines of what was looked at, and everything that was not', () => {
    const many = [...Array.from({ length: 30 }, (_, i) => wishFrom('leo', `seen-${i}`, 1 + i / 100)), ...Array.from({ length: 25 }, (_, i) => wishFrom('leo', `new-${i}`, 2 + i / 100, false))]
    const items = newsOf(rows(many), Date.now())
    expect(items.filter((item) => item.fresh)).toHaveLength(25)
    expect(items.filter((item) => !item.fresh)).toHaveLength(NEWS_EARLIER)
    expect(freshCount(items)).toBe(25)
  })

  it('the latest of some moments, whatever way they are written', () => {
    expect(latest([])).toBeNull()
    expect(latest(['2026-11-17T08:00:00.000Z', '2026-11-17T09:30:00+00:00', '2026-11-17T10:00:00+01:00'])).toBe('2026-11-17T09:30:00+00:00')
  })
})
