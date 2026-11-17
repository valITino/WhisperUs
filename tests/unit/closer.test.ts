import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { ActionError } from '../../src/data/actions'
import { BackendError } from '../../src/data/backend'
import { FakeCloud } from '../../src/data/fake/cloudCore'
import { cleanCheckin, cleanLeaning, keptHere, matchesOf, mine, myLeanings, parseSlot, removeCheckin, saveAbout, saveCheckin, saveLeaning, slotOf, slotRef, theirs } from '../../src/data/journal'
import { LATER_TABLES, NO_WHY, stableId, type AboutBody, type CheckinBody, type ID, type Leaning, type Note, type Wish } from '../../src/data/types'
import { addIdea, answerWish, changeWish, makeWish, removeIdea, takeBackWish, type WishDraft } from '../../src/data/wishes'
import { anotherDevice, HER_PIN, makeCouple, settle, type Phone } from './helpers'

// What a person notes about themselves, the list and wishes, played by two phones against
// the pretend cloud (which follows supabase/migrations/0004_closer.sql; the SQL test
// closer_test.sql plays the same rules against the real thing).
//
// The rule above all others here: nothing is shown on anybody's behalf. What is not
// explicitly opened stays on the phone it was noted on, and a "not for me" never leaves it.

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

const MORNING = new Date('2026-11-17T07:30:00Z') // 08:30 in Zurich
const EVENING = new Date('2026-11-17T20:10:00Z') // 21:10 in Zurich
const why = (note: string) => ({ chips: ['checkin.rested'], own: ['a long hug'], note })
const full: CheckinBody = { energy: 2, mood: 4, close: 5, open: 2, desire: 3, kinky: 1, thoughts: 3, fantasies: ['soft.massage'], happened: ['tender'], why: why('Slept badly, but you held me.') }

const outbox = (phone: Phone, table: string) => phone.db.outbox.filter((op) => op.table === table).toArray()
const inCloud = (table: 'notes' | 'leanings' | 'ideas' | 'wishes', id: ID) => cloud.peek(table, id)
/** Everything the cloud holds in one table, as text: for "is it in there anywhere?". */
const cloudText = async (phone: Phone) => JSON.stringify((await phone.backend.pull(null)).tables)

describe('which check-in a moment belongs to', () => {
  it('the first before two in the afternoon, the second after, on the room\'s clock', () => {
    expect(slotOf(MORNING)).toEqual({ day: '2026-11-17', half: 'am' })
    expect(slotOf('2026-11-17T12:59:00Z')).toEqual({ day: '2026-11-17', half: 'am' })
    expect(slotOf('2026-11-17T13:00:00Z')).toEqual({ day: '2026-11-17', half: 'pm' })
    expect(slotOf(EVENING)).toEqual({ day: '2026-11-17', half: 'pm' })
  })

  it('the day turns at four in the morning: half past one belongs to the evening before', () => {
    expect(slotOf('2026-11-18T00:30:00Z')).toEqual({ day: '2026-11-17', half: 'pm' })
    expect(slotOf('2026-11-18T02:59:00Z')).toEqual({ day: '2026-11-17', half: 'pm' })
    expect(slotOf('2026-11-18T03:00:00Z')).toEqual({ day: '2026-11-18', half: 'am' })
    // In summer Zurich is two hours ahead of UTC.
    expect(slotOf('2026-07-01T01:30:00Z')).toEqual({ day: '2026-06-30', half: 'pm' })
    expect(slotOf('2026-07-01T02:00:00Z')).toEqual({ day: '2026-07-01', half: 'am' })
  })

  it('writes a slot down and reads it back', () => {
    expect(slotRef({ day: '2026-11-17', half: 'am' })).toBe('2026-11-17.am')
    expect(parseSlot('2026-11-17.pm')).toEqual({ day: '2026-11-17', half: 'pm' })
    for (const odd of ['2026-11-17', 'say', '2026-11-17.noon', '']) expect(parseSlot(odd)).toBeNull()
  })
})

describe('an id that is the same on every device', () => {
  it('is a proper UUID, the same for the same thing and different for another', async () => {
    const a = await stableId('member', 'checkin', '2026-11-17.am')
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    expect(await stableId('member', 'checkin', '2026-11-17.am')).toBe(a)
    expect(await stableId('member', 'checkin', '2026-11-17.pm')).not.toBe(a)
    // The parts are kept apart: "ab" + "c" is not "a" + "bc".
    expect(await stableId('ab', 'c')).not.toBe(await stableId('a', 'bc'))
  })
})

describe('tidying what was noted', () => {
  it('keeps only what was really answered, each within its range', () => {
    expect(cleanCheckin({ energy: 3, mood: 9, close: 0, open: 2.5, desire: '4', kinky: null, thoughts: 0, fantasies: ['a', 'a', '', 5], happened: [], why: { chips: [], own: ['  '], note: ' ' }, smuggled: 'x' })).toEqual({ energy: 3, thoughts: 0, fantasies: ['a'] })
    expect(cleanCheckin({})).toEqual({})
  })

  it('a "not for me" has no strength, and cannot be kept quiet: it is quiet by nature', () => {
    expect(cleanLeaning({ lean: 'no', pull: 4, quiet: true, why: { chips: ['leaning.not-mine'], own: [], note: null } })).toEqual({ lean: 'no', why: { chips: ['leaning.not-mine'], own: [], note: null } })
    expect(cleanLeaning({ lean: 'yes', pull: 4, quiet: true })).toEqual({ lean: 'yes', pull: 4, quiet: true })
    expect(cleanLeaning({ lean: 'always' })).toBeNull()
  })
})

describe('a check-in', () => {
  it('stays on the phone, whole, when nothing of it is shown: the cloud never hears of it', async () => {
    const id = await saveCheckin(her.kit, { body: full, share: [], at: MORNING })
    await settle(her, him)

    expect((await her.db.diary.get(id))?.body).toEqual(full)
    expect(await outbox(her, 'notes')).toEqual([])
    expect(inCloud('notes', id)).toBeUndefined()
    expect(await him.db.notes.count()).toBe(0)
    expect(await cloudText(him)).not.toContain('Slept badly')
  })

  it('shows exactly the parts its author opened, and not one more', async () => {
    const id = await saveCheckin(her.kit, { body: full, share: ['close', 'open'], at: MORNING })
    await settle(her, him)

    const row = inCloud('notes', id) as unknown as Note
    expect(row).toMatchObject({ memberId: herId, kind: 'checkin', ref: '2026-11-17.am', body: { close: 5, open: 2 } })
    expect(Object.keys(row.body).sort()).toEqual(['close', 'open'])
    // He reads the two parts; nothing of the rest is anywhere he could find it.
    expect(theirs<CheckinBody>('checkin', await him.db.notes.toArray(), hisId).map((n) => n.body)).toEqual([{ close: 5, open: 2 }])
    const all = await cloudText(him)
    for (const kept of ['Slept badly', 'a long hug', 'soft.massage', 'tender', 'thoughts', 'desire', 'kinky']) expect(all).not.toContain(kept)
    // Her own phone still knows all of it, and which parts are out.
    expect(mine<CheckinBody>('checkin', await her.db.diary.toArray(), await her.db.notes.toArray(), herId)).toMatchObject([{ id, body: full, shared: ['close', 'open'], whole: true }])
  })

  it('a part that was not answered cannot be shown', async () => {
    const id = await saveCheckin(her.kit, { body: { mood: 2 }, share: ['mood', 'desire', 'why'], at: MORNING })
    expect((await her.db.diary.get(id))?.shared).toEqual(['mood'])
    expect((await her.db.notes.get(id))?.body).toEqual({ mood: 2 })
  })

  it('there is one per half of a day: checking in again changes it, and the evening is another', async () => {
    const first = await saveCheckin(her.kit, { body: { mood: 2 }, share: ['mood'], at: MORNING })
    const again = await saveCheckin(her.kit, { body: { mood: 4, desire: 5 }, share: ['mood'], at: new Date(MORNING.getTime() + 3_600_000) })
    const evening = await saveCheckin(her.kit, { body: { mood: 5 }, share: [], at: EVENING })
    expect(again).toBe(first)
    expect(evening).not.toBe(first)
    expect(await her.db.diary.count()).toBe(2)
    await settle(her, him)
    expect((inCloud('notes', first) as unknown as Note).body).toEqual({ mood: 4 })
    expect(await him.db.notes.count()).toBe(1)
  })

  it('showing less takes it away from the other phone; showing nothing empties the row', async () => {
    const id = await saveCheckin(her.kit, { body: full, share: ['mood', 'desire'], at: MORNING })
    await settle(her, him)
    await saveCheckin(her.kit, { body: full, share: ['mood'], at: MORNING })
    await settle(her, him)
    expect((await him.db.notes.get(id))?.body).toEqual({ mood: 4 })

    await saveCheckin(her.kit, { body: full, share: [], at: MORNING })
    await settle(her, him)
    expect((inCloud('notes', id) as unknown as Note).body).toEqual({})
    expect(theirs('checkin', await him.db.notes.toArray(), hisId)).toEqual([])
    // Hers is untouched by any of this.
    expect((await her.db.diary.get(id))?.body).toEqual(full)
  })

  it('needs at least one answer', async () => {
    await expect(saveCheckin(her.kit, { body: {}, share: [] })).rejects.toMatchObject({ code: 'nothing_noted' })
    await expect(saveCheckin(her.kit, { body: { why: NO_WHY }, share: [] })).rejects.toBeInstanceOf(ActionError)
  })

  it('removing it removes it here and from what the other one sees, and the cloud forgets what was shown', async () => {
    const id = await saveCheckin(her.kit, { body: full, share: ['mood', 'why'], at: MORNING })
    await settle(her, him)
    await removeCheckin(her.kit, id)
    await settle(her, him)

    expect(await her.db.diary.get(id)).toBeUndefined()
    expect(inCloud('notes', id)).toMatchObject({ body: {} })
    expect((inCloud('notes', id) as unknown as Note).deletedAt).not.toBeNull()
    expect(theirs('checkin', await him.db.notes.toArray(), hisId)).toEqual([])
    expect((await him.db.notes.get(id))?.body).toEqual({})
    expect(await cloudText(him)).not.toContain('Slept badly')
  })

  it('once nothing is shown, the cloud hears nothing more: not that she checked in again, nor when', async () => {
    const id = await saveCheckin(her.kit, { body: full, share: ['mood'], at: MORNING })
    await settle(her, him)
    await removeCheckin(her.kit, id)
    await settle(her, him)
    const before = JSON.stringify(inCloud('notes', id))

    // The same morning, noted again and kept to herself; then changed, still to herself.
    await saveCheckin(her.kit, { body: { mood: 1, desire: 5 }, share: [], at: MORNING })
    await saveCheckin(her.kit, { body: { mood: 2 }, share: [], at: new Date(MORNING.getTime() + 600_000) })
    expect(await outbox(her, 'notes')).toEqual([])
    await settle(her, him)
    expect(JSON.stringify(inCloud('notes', id))).toBe(before)
    expect((await her.db.diary.get(id))?.body).toEqual({ mood: 2 })
  })

  it('knows what exists on this phone only: a part that is not shown, a no, a quiet yes, a why that did not travel', async () => {
    await saveCheckin(her.kit, { body: { mood: 2, desire: 5 }, share: ['mood', 'desire'], at: MORNING })
    await saveCheckin(her.kit, { body: { mood: 2, desire: 5 }, share: ['mood'], at: EVENING })
    await saveLeaning(her.kit, 'soft.massage', { lean: 'yes', pull: 3 })
    await saveLeaning(her.kit, 'words.whisper', { lean: 'yes', why: why('Mine.') })
    await saveLeaning(her.kit, 'pace.unhurried', { lean: 'yes', why: why('Yours too.') }, { showWhy: true })
    await saveLeaning(her.kit, 'looks.mirrors', { lean: 'no' })
    await saveLeaning(her.kit, 'play.roles', { lean: 'maybe', quiet: true })
    const kept = (await her.db.diary.toArray()).filter(keptHere).map((entry) => entry.ref).sort()
    expect(kept).toEqual(['2026-11-17.pm', 'looks.mirrors', 'play.roles', 'words.whisper'])
  })

  it('he cannot write, change or remove what she showed', async () => {
    const id = await saveCheckin(her.kit, { body: full, share: ['mood'], at: MORNING })
    await settle(her, him)
    await expect(him.backend.push({ table: 'notes', kind: 'patch', id, data: { body: { mood: 1 }, deletedAt: new Date().toISOString() } })).rejects.toBeInstanceOf(BackendError)
    expect((inCloud('notes', id) as unknown as Note).body).toEqual({ mood: 4 })
    // Nor note something in her name: it is filed as his.
    const forged = '99999999-9999-4999-8999-999999999999'
    await him.backend.push({ table: 'notes', kind: 'put', id: forged, data: { id: forged, householdId: await him.store.householdId(), memberId: herId, kind: 'about', ref: 'say', at: new Date().toISOString(), body: { value: 1 }, deletedAt: null } })
    expect(inCloud('notes', forged)).toMatchObject({ memberId: hisId })
  })

  it('another device of hers has the shown parts and knows that it is not the whole', async () => {
    const id = await saveCheckin(her.kit, { body: full, share: ['mood', 'close'], at: MORNING })
    await settle(her)
    const tablet = await anotherDevice(cloud, 'Mia', HER_PIN)
    expect(await tablet.db.diary.count()).toBe(0)
    expect(mine<CheckinBody>('checkin', await tablet.db.diary.toArray(), await tablet.db.notes.toArray(), herId)).toMatchObject([{ id, body: { mood: 4, close: 5 }, shared: ['mood', 'close'], whole: false }])
    // A check-in made there for the same morning is the same row, not a second one.
    expect(await saveCheckin(tablet.kit, { body: { mood: 1 }, share: ['mood'], at: MORNING })).toBe(id)
    await settle(tablet, her)
    expect((await her.db.notes.get(id))?.body).toEqual({ mood: 1 })
  })
})

describe('the questions about myself', () => {
  it('an answer is mine until I show it, part by part', async () => {
    const answer: AboutBody = { value: 2, why: { chips: ['about.no-words'], own: [], note: 'Nobody ever asked me.' } }
    await saveAbout(her.kit, 'say', answer, [])
    await settle(her, him)
    expect(await him.db.notes.count()).toBe(0)
    expect(await cloudText(him)).not.toContain('Nobody ever asked')

    await saveAbout(her.kit, 'say', answer, ['value'])
    await settle(her, him)
    expect(theirs<AboutBody>('about', await him.db.notes.toArray(), hisId)).toMatchObject([{ ref: 'say', body: { value: 2 } }])
    expect(await cloudText(him)).not.toContain('Nobody ever asked')
    expect(mine<AboutBody>('about', await her.db.diary.toArray(), await her.db.notes.toArray(), herId)).toMatchObject([{ ref: 'say', body: answer, shared: ['value'], whole: true }])
  })

  it('answering again changes the answer; an empty answer takes it away', async () => {
    await saveAbout(her.kit, 'say', { value: 2 }, ['value'])
    await saveAbout(her.kit, 'say', { value: 4 }, ['value'])
    expect(await her.db.diary.count()).toBe(1)
    await settle(her, him)
    expect(theirs<AboutBody>('about', await him.db.notes.toArray(), hisId)[0].body).toEqual({ value: 4 })

    await saveAbout(her.kit, 'say', {}, ['value'])
    await settle(her, him)
    expect(await her.db.diary.count()).toBe(0)
    expect(theirs('about', await him.db.notes.toArray(), hisId)).toEqual([])
  })
})

describe('the list', () => {
  const ITEM = 'soft.massage'
  const herRow = async () => inCloud('leanings', await stableId(herId, 'leaning', ITEM)) as unknown as Leaning | undefined

  it('a "not for me" never leaves the phone it was tapped on', async () => {
    await saveLeaning(her.kit, ITEM, { lean: 'no', why: { chips: ['leaning.not-mine'], own: [], note: 'It hurts my shoulder.' } }, { showWhy: true })
    await settle(her, him)
    expect(await outbox(her, 'leanings')).toEqual([])
    expect(await herRow()).toBeUndefined()
    expect(await cloudText(her)).not.toContain(ITEM)
    // Her own phone remembers, why included.
    expect(myLeanings(await her.db.diary.toArray(), await her.db.leanings.toArray(), herId).get(ITEM)).toMatchObject({ lean: 'no', why: { note: 'It hurts my shoulder.' }, whyShown: false })
  })

  it('the cloud itself would not take one', async () => {
    const id = await stableId(herId, 'leaning', ITEM)
    await expect(her.backend.push({ table: 'leanings', kind: 'put', id, data: { id, householdId: await her.store.householdId(), memberId: herId, item: ITEM, lean: 'no', pull: null, why: null, deletedAt: null } })).rejects.toMatchObject({ kind: 'rejected' })
  })

  it('a yes stays hers alone until he answers that item openly too', async () => {
    await saveLeaning(her.kit, ITEM, { lean: 'yes', pull: 4 })
    await saveLeaning(him.kit, 'play.roles', { lean: 'maybe' })
    await settle(her, him)
    // In the cloud, and on neither of the other one's phones.
    expect(await herRow()).toMatchObject({ lean: 'yes', pull: 4, why: null })
    expect((await him.db.leanings.toArray()).map((l) => l.item)).toEqual(['play.roles'])
    expect((await her.db.leanings.toArray()).map((l) => l.item)).toEqual([ITEM])
    expect(await cloudText(him)).not.toContain(ITEM)
    expect(matchesOf(await her.db.leanings.toArray(), herId)).toEqual([])
  })

  it('when he says so too, both phones learn it, although her row did not change', async () => {
    await saveLeaning(her.kit, ITEM, { lean: 'yes', pull: 4 })
    await settle(her, him)
    await saveLeaning(him.kit, ITEM, { lean: 'dream', pull: 2 })
    await settle(him, her)

    const his = matchesOf(await him.db.leanings.toArray(), hisId)
    const hers = matchesOf(await her.db.leanings.toArray(), herId)
    expect(his).toMatchObject([{ item: ITEM, mine: { lean: 'dream', pull: 2 }, theirs: { lean: 'yes', pull: 4 } }])
    expect(hers).toMatchObject([{ item: ITEM, mine: { lean: 'yes', pull: 4 }, theirs: { lean: 'dream', pull: 2 } }])
  })

  it('a "not for me" on his side meets nothing, and she learns nothing from it', async () => {
    await saveLeaning(her.kit, ITEM, { lean: 'yes' })
    await saveLeaning(him.kit, ITEM, { lean: 'no' })
    await settle(her, him)
    expect(matchesOf(await her.db.leanings.toArray(), herId)).toEqual([])
    expect((await her.db.leanings.toArray()).every((l) => l.memberId === herId)).toBe(true)
    expect((await him.db.leanings.toArray()).length).toBe(0)
  })

  it('the why travels only if she says so', async () => {
    const reason = { chips: ['leaning.long'], own: [], note: 'Since that weekend.' }
    await saveLeaning(her.kit, ITEM, { lean: 'yes', why: reason })
    await saveLeaning(him.kit, ITEM, { lean: 'yes' })
    await settle(her, him)
    expect(matchesOf(await him.db.leanings.toArray(), hisId)[0].theirs.why).toBeNull()
    expect(await cloudText(him)).not.toContain('Since that weekend')

    await saveLeaning(her.kit, ITEM, { lean: 'yes', why: reason }, { showWhy: true })
    await settle(her, him)
    expect(matchesOf(await him.db.leanings.toArray(), hisId)[0].theirs.why).toEqual(reason)
  })

  it('a yes kept quiet stays on the phone and meets nothing', async () => {
    await saveLeaning(her.kit, ITEM, { lean: 'yes', pull: 5, quiet: true })
    await saveLeaning(him.kit, ITEM, { lean: 'yes' })
    await settle(her, him)
    expect(await herRow()).toBeUndefined()
    expect(matchesOf(await him.db.leanings.toArray(), hisId)).toEqual([])
    expect(myLeanings(await her.db.diary.toArray(), await her.db.leanings.toArray(), herId).get(ITEM)).toMatchObject({ lean: 'yes', pull: 5, quiet: true })
    // Letting it out later is one tap.
    await saveLeaning(her.kit, ITEM, { lean: 'yes', pull: 5 })
    await settle(her, him)
    expect(matchesOf(await him.db.leanings.toArray(), hisId)).toHaveLength(1)
  })

  it('taking a yes back ends what they had in common, on both phones, and it can come back', async () => {
    await saveLeaning(her.kit, ITEM, { lean: 'yes', pull: 4, why: { chips: [], own: [], note: 'Mine.' } }, { showWhy: true })
    await saveLeaning(him.kit, ITEM, { lean: 'yes' })
    await settle(her, him)
    expect(matchesOf(await her.db.leanings.toArray(), herId)).toHaveLength(1)

    await saveLeaning(her.kit, ITEM, { lean: 'no' })
    await settle(her, him)
    expect(await herRow()).toMatchObject({ pull: null, why: null })
    expect((await herRow())?.deletedAt).not.toBeNull()
    expect(matchesOf(await him.db.leanings.toArray(), hisId)).toEqual([])
    // His answer is no longer on her phone: she does not answer that item openly any more.
    expect((await her.db.leanings.toArray()).filter((l) => l.memberId === hisId)).toEqual([])
    expect(await cloudText(him)).not.toContain('Mine.')

    await saveLeaning(her.kit, ITEM, { lean: 'maybe' })
    await settle(her, him)
    expect(matchesOf(await her.db.leanings.toArray(), herId)).toMatchObject([{ mine: { lean: 'maybe' }, theirs: { lean: 'yes' } }])
    expect(matchesOf(await him.db.leanings.toArray(), hisId)).toMatchObject([{ theirs: { lean: 'maybe' } }])
  })

  it('clearing an answer forgets it everywhere', async () => {
    await saveLeaning(her.kit, ITEM, { lean: 'yes' })
    await settle(her)
    await saveLeaning(her.kit, ITEM, null)
    await settle(her)
    expect(await her.db.diary.count()).toBe(0)
    expect((await herRow())?.deletedAt).not.toBeNull()
    expect(myLeanings(await her.db.diary.toArray(), await her.db.leanings.toArray(), herId).size).toBe(0)
  })

  it('he cannot change her answer, nor answer in her name', async () => {
    await saveLeaning(her.kit, ITEM, { lean: 'yes', pull: 4 })
    await saveLeaning(him.kit, ITEM, { lean: 'yes' })
    await settle(her, him)
    const id = await stableId(herId, 'leaning', ITEM)
    await expect(him.backend.push({ table: 'leanings', kind: 'patch', id, data: { lean: 'dream', pull: 1 } })).rejects.toBeInstanceOf(BackendError)
    expect(await herRow()).toMatchObject({ lean: 'yes', pull: 4 })
  })

  it('another device of hers knows her open answers, not the ones that stayed on the first', async () => {
    await saveLeaning(her.kit, ITEM, { lean: 'yes', pull: 3 })
    await saveLeaning(her.kit, 'looks.mirrors', { lean: 'no' })
    await settle(her)
    const tablet = await anotherDevice(cloud, 'Mia', HER_PIN)
    const known = myLeanings(await tablet.db.diary.toArray(), await tablet.db.leanings.toArray(), herId)
    expect([...known.keys()]).toEqual([ITEM])
    expect(known.get(ITEM)).toMatchObject({ lean: 'yes', pull: 3 })
  })

  it('something written onto the list is read by both, and its author alone can take it off', async () => {
    const id = await addIdea(her.kit, '  Breakfast   in bed ', 'own')
    await settle(her, him)
    expect((await him.db.ideas.get(id))?.label).toBe('Breakfast in bed')
    await expect(removeIdea(him.kit, id)).rejects.toMatchObject({ code: 'not_yours' })
    await expect(him.backend.push({ table: 'ideas', kind: 'patch', id, data: { label: 'Rewritten' } })).rejects.toBeInstanceOf(BackendError)
    await expect(addIdea(her.kit, '   ', 'own')).rejects.toMatchObject({ code: 'no_words' })

    await removeIdea(her.kit, id)
    await settle(her, him)
    expect(inCloud('ideas', id)).toMatchObject({ label: '' })
    expect((await him.db.ideas.get(id))?.deletedAt).not.toBeNull()
    expect(await cloudText(him)).not.toContain('Breakfast')
  })
})

describe('a wish', () => {
  const draft = (changes: Partial<WishDraft> = {}): WishDraft => ({ text: 'A whole evening that is only ours', item: 'pace.unhurried', mode: 'do', want: 5, why: { chips: ['wish.long'], own: [], note: 'Because of that night.' }, ...changes })
  const yes = { decision: 'yes' as const, taps: ['glad'], heat: 4 as const, why: { chips: ['decision.want-too'], own: [], note: 'I thought you would never ask.' } }
  const wishInCloud = (id: ID) => inCloud('wishes', id) as unknown as Wish

  it('reaches the other one as it was said, with its why', async () => {
    const id = await makeWish(her.kit, draft())
    await settle(her, him)
    expect(await him.db.wishes.get(id)).toMatchObject({ authorId: herId, text: 'A whole evening that is only ours', mode: 'do', want: 5, why: { note: 'Because of that night.' }, answer: null })
  })

  it('needs words', async () => {
    await expect(makeWish(her.kit, draft({ text: '   ' }))).rejects.toMatchObject({ code: 'no_words' })
  })

  it('he answers with a decision, how it lands and a why; she cannot answer for him', async () => {
    const id = await makeWish(her.kit, draft())
    await settle(her, him)
    await expect(answerWish(her.kit, id, yes)).rejects.toMatchObject({ code: 'not_yours' })
    await answerWish(him.kit, id, yes)
    await settle(him, her)
    expect((await her.db.wishes.get(id))?.answer).toMatchObject({ decision: 'yes', taps: ['glad'], heat: 4, why: { note: 'I thought you would never ask.' } })
    // Straight at the cloud, past the app: still his alone to write.
    await her.backend.push({ table: 'wishes', kind: 'patch', id, data: { answer: { decision: 'no', taps: [], heat: null, why: NO_WHY, at: new Date().toISOString() } } })
    expect(wishInCloud(id).answer).toMatchObject({ decision: 'yes' })
  })

  it('a wish that asks for a decision gets one; a fantasy that may stay one needs none', async () => {
    const real = await makeWish(her.kit, draft())
    const fantasy = await makeWish(her.kit, draft({ mode: 'dream', text: 'Just so you know what I think about' }))
    await settle(her, him)
    await expect(answerWish(him.kit, real, { ...yes, decision: null })).rejects.toMatchObject({ code: 'no_decision' })
    await answerWish(him.kit, fantasy, { ...yes, decision: null })
    expect((await him.db.wishes.get(fantasy))?.answer).toMatchObject({ decision: null, heat: 4 })
  })

  it('he can answer and nothing else: her words stand', async () => {
    const id = await makeWish(her.kit, draft())
    await settle(her, him)
    await him.backend.push({ table: 'wishes', kind: 'patch', id, data: { text: 'Rewritten', want: 1, mode: 'dream', deletedAt: new Date().toISOString(), answer: { decision: 'later', taps: [], heat: null, why: NO_WHY, at: new Date().toISOString() } } })
    expect(wishInCloud(id)).toMatchObject({ text: 'A whole evening that is only ours', want: 5, mode: 'do', deletedAt: null, answer: { decision: 'later' } })
    await expect(takeBackWish(him.kit, id)).rejects.toMatchObject({ code: 'not_yours' })
  })

  it('a "not now" can become a "yes"; an answer cannot be taken away', async () => {
    const id = await makeWish(her.kit, draft())
    await settle(her, him)
    await answerWish(him.kit, id, { ...yes, decision: 'later' })
    await settle(him, her)
    await answerWish(him.kit, id, yes)
    await settle(him, her)
    expect((await her.db.wishes.get(id))?.answer?.decision).toBe('yes')
    await him.backend.push({ table: 'wishes', kind: 'patch', id, data: { answer: null } })
    expect(wishInCloud(id).answer).toMatchObject({ decision: 'yes' })
  })

  it('she can reword it while it waits; what was answered stays as it was answered', async () => {
    const id = await makeWish(her.kit, draft())
    await changeWish(her.kit, id, draft({ text: 'A whole weekend, then', want: 4 }))
    await settle(her, him)
    expect((await him.db.wishes.get(id))?.text).toBe('A whole weekend, then')
    await answerWish(him.kit, id, yes)
    await settle(him, her)
    await expect(changeWish(her.kit, id, draft({ text: 'Something else entirely' }))).rejects.toMatchObject({ code: 'answered' })
    // The cloud holds the same line, whoever asks.
    await her.backend.push({ table: 'wishes', kind: 'patch', id, data: { text: 'Something else entirely', mode: 'dream' } })
    expect(wishInCloud(id)).toMatchObject({ text: 'A whole weekend, then', mode: 'do' })
  })

  it('taking it back makes the cloud and the other phone forget its words, its why and the answer', async () => {
    const id = await makeWish(her.kit, draft())
    await settle(her, him)
    await answerWish(him.kit, id, yes)
    await settle(him, her)
    await takeBackWish(her.kit, id)
    await settle(her, him)

    expect(wishInCloud(id)).toMatchObject({ text: '', item: null, want: null, why: NO_WHY, answer: null })
    for (const phone of [her, him]) expect(await phone.db.wishes.get(id)).toMatchObject({ text: '', item: null, want: null, why: NO_WHY, answer: null })
    const all = await cloudText(him)
    for (const gone of ['whole evening', 'that night', 'never ask']) expect(all).not.toContain(gone)
  })
})

describe('a cloud that has not been updated yet', () => {
  it('does not refuse what it does not know: the changes wait on the phone and go out once it does', async () => {
    cloud.closer = false
    const wish = await makeWish(her.kit, { text: 'Later, then', item: null, mode: 'do', want: null, why: NO_WHY })
    await saveCheckin(her.kit, { body: { mood: 3 }, share: ['mood'], at: MORNING })
    await saveLeaning(her.kit, 'soft.massage', { lean: 'yes' })
    await her.engine.sync()

    expect(her.engine.status).toMatchObject({ state: 'idle', stuck: 0, pending: 0, later: 3 })
    expect(await her.db.deadLetters.count()).toBe(0)
    // What she noted is on her screen all the same.
    expect((await her.db.wishes.get(wish))?.text).toBe('Later, then')
    // Everything from before still syncs.
    const envelope = await her.envelope()
    await settle(her, him)
    expect(await him.db.envelopes.get(envelope.id)).toBeDefined()
    expect(await him.db.wishes.count()).toBe(0)

    // The owner applies the migration. A phone asks again the next time the app starts.
    cloud.closer = true
    await her.engine.sync()
    expect(her.engine.status.later).toBe(0)
    await settle(her, him)
    expect((await him.db.wishes.get(wish))?.text).toBe('Later, then')
    expect(await him.db.notes.count()).toBe(1)
  })

  it('the later tables are exactly the ones that migration brought', () => {
    expect([...LATER_TABLES].sort()).toEqual(['ideas', 'leanings', 'notes', 'wishes'])
  })
})
