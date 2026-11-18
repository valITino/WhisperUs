import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { FakeCloud } from '../../src/data/fake/cloudCore'
import { removeCheckin, saveAbout, saveCheckin, saveLeaning } from '../../src/data/journal'
import { shownBy, showsNothing, type ProfileRows } from '../../src/data/profile'
import type { ID } from '../../src/data/types'
import { makeWish, takeBackWish } from '../../src/data/wishes'
import { makeCouple, settle, type Phone } from './helpers'

// A profile to look at: the other one's (what they show me) and my own (what they see
// of me). The promise the page makes is that the two are the same thing, read from two
// phones: what I am told the other one sees of me is exactly what their phone shows.

let cloud: FakeCloud
let her: Phone
let him: Phone
let herId: ID
let hisId: ID

beforeEach(async () => {
  cloud = new FakeCloud()
  ;({ her, him } = await makeCouple(cloud))
  herId = (await her.store.memberId()) as ID
  hisId = (await him.store.memberId()) as ID
})

const rowsOf = async (phone: Phone): Promise<ProfileRows> => ({ notes: await phone.db.notes.toArray(), leanings: await phone.db.leanings.toArray(), wishes: await phone.db.wishes.toArray() })
const both = async () => {
  await settle(her, him)
  await settle(him, her)
}
const reason = (note: string) => ({ chips: ['about.no-words'], own: ['my own word'], note })

describe('what somebody shows', () => {
  it('is nothing at all until they show something', async () => {
    await saveCheckin(her.kit, { body: { mood: 2, desire: 5, why: reason('Only for me.') }, share: [] })
    await saveAbout(her.kit, 'say', { value: 1, why: reason('Only for me.') }, [])
    await saveLeaning(her.kit, 'looks.mirrors', { lean: 'no', why: reason('Only for me.') })
    await saveLeaning(her.kit, 'play.roles', { lean: 'yes', pull: 5, quiet: true })
    await both()
    expect(showsNothing(shownBy(herId, await rowsOf(him)))).toBe(true)
    expect(showsNothing(shownBy(herId, await rowsOf(her)))).toBe(true)
  })

  it('is the same on her phone and on his: what she is told he sees is what he sees', async () => {
    await saveCheckin(her.kit, { body: { mood: 2, close: 5, desire: 4, happened: ['tender'], why: reason('Slept badly, but you held me.') }, share: ['close', 'happened'] })
    await saveAbout(her.kit, 'say', { value: 2, why: reason('I never had words for it.') }, ['value'])
    await saveAbout(her.kit, 'no', { value: 1, why: reason('It is hard.') }, ['value', 'why'])
    await saveAbout(her.kit, 'told', { value: 1 }, [])
    await saveLeaning(her.kit, 'soft.massage', { lean: 'yes', pull: 4, why: reason('It calms me.') }, { showWhy: true })
    await saveLeaning(her.kit, 'words.whisper', { lean: 'dream', pull: 5, why: reason('Not out loud yet.') })
    await saveLeaning(her.kit, 'pace.unhurried', { lean: 'yes', pull: 3 })
    await saveLeaning(her.kit, 'looks.mirrors', { lean: 'no' })
    await saveLeaning(him.kit, 'soft.massage', { lean: 'maybe', pull: 2 })
    await saveLeaning(him.kit, 'words.whisper', { lean: 'yes' })
    await saveLeaning(him.kit, 'looks.mirrors', { lean: 'yes' })
    await makeWish(her.kit, { text: 'A whole evening that is only ours', item: null, mode: 'do', want: 5, why: reason('Because of that night.') })
    await both()

    const onHers = shownBy(herId, await rowsOf(her))
    const onHis = shownBy(herId, await rowsOf(him))
    expect(onHers).toEqual(onHis)

    // Part by part: only what she opened.
    expect(onHis.checkin?.body).toEqual({ close: 5, happened: ['tender'] })
    expect([...onHis.about.keys()].sort()).toEqual(['no', 'say'])
    expect(onHis.about.get('say')?.body).toEqual({ value: 2 })
    expect(onHis.about.get('no')?.body).toEqual({ value: 1, why: reason('It is hard.') })
    // The list: only where both answered openly. Her "not for me" met his yes and shows nowhere.
    expect(onHis.common.map((c) => c.item).sort()).toEqual(['soft.massage', 'words.whisper'])
    expect(onHis.common.find((c) => c.item === 'soft.massage')).toMatchObject({ lean: 'yes', pull: 4, why: reason('It calms me.'), otherLean: 'maybe' })
    // A why she did not show is not there, though the answer is.
    expect(onHis.common.find((c) => c.item === 'words.whisper')).toMatchObject({ lean: 'dream', pull: 5, why: null, otherLean: 'yes' })
    expect(onHis.wishes.map((wish) => wish.text)).toEqual(['A whole evening that is only ours'])
    const text = JSON.stringify(onHis, (_key, value) => (value instanceof Map ? [...value] : value))
    for (const kept of ['Slept badly', 'never had words', 'Not out loud', 'mirrors', 'pace.unhurried', 'told', '"mood"', '"desire"']) expect(text).not.toContain(kept)
  })

  it('and his side of the same list is his own answer, not hers', async () => {
    await saveLeaning(her.kit, 'soft.massage', { lean: 'yes', pull: 4 })
    await saveLeaning(him.kit, 'soft.massage', { lean: 'maybe', pull: 2 })
    await both()
    expect(shownBy(hisId, await rowsOf(her)).common).toMatchObject([{ item: 'soft.massage', lean: 'maybe', pull: 2, otherLean: 'yes' }])
    expect(shownBy(hisId, await rowsOf(him)).common).toEqual(shownBy(hisId, await rowsOf(her)).common)
  })
})

describe('the check-in on a profile', () => {
  it('is the newest one with something shown, and goes when it is removed', async () => {
    const day = Date.now() - 3 * 86_400_000
    await saveCheckin(her.kit, { body: { mood: 1 }, share: ['mood'], at: new Date(day) })
    const newer = await saveCheckin(her.kit, { body: { mood: 4 }, share: ['mood'], at: new Date(day + 86_400_000) })
    // The newest of all shows nothing, so it is not the one on the profile.
    await saveCheckin(her.kit, { body: { mood: 5 }, share: [], at: new Date(day + 2 * 86_400_000) })
    await both()
    expect(shownBy(herId, await rowsOf(him)).checkin).toMatchObject({ id: newer, body: { mood: 4 } })

    await removeCheckin(her.kit, newer)
    await both()
    expect(shownBy(herId, await rowsOf(him)).checkin?.body).toEqual({ mood: 1 })
  })
})

describe('wishes on a profile', () => {
  it('are their author\'s, newest first, and a wish taken back is gone', async () => {
    const first = await makeWish(her.kit, { text: 'First', item: null, mode: 'do', want: null, why: { chips: [], own: [], note: null } })
    await makeWish(him.kit, { text: 'His', item: null, mode: 'dream', want: null, why: { chips: [], own: [], note: null } })
    await new Promise((resolve) => setTimeout(resolve, 5))
    await makeWish(her.kit, { text: 'Second', item: null, mode: 'do', want: null, why: { chips: [], own: [], note: null } })
    await both()
    expect(shownBy(herId, await rowsOf(him)).wishes.map((wish) => wish.text)).toEqual(['Second', 'First'])
    expect(shownBy(hisId, await rowsOf(her)).wishes.map((wish) => wish.text)).toEqual(['His'])

    await takeBackWish(her.kit, first)
    await both()
    expect(shownBy(herId, await rowsOf(him)).wishes.map((wish) => wish.text)).toEqual(['Second'])
  })
})
