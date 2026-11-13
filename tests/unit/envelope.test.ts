// An envelope's whole life, played by two phones (and a tablet) against the pretend
// cloud: sealing, what the other one can and cannot get before its time, opening by hand,
// one opening only, taking back, answering.

import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ActionError, answer, markSeen, openLayers, readLayer, readVoice, sealEnvelope, takeBack, type Draft } from '../../src/data/actions'
import { mediaPath } from '../../src/data/backend'
import { viewOf } from '../../src/data/envelopes'
import { FakeCloud } from '../../src/data/fake/cloudCore'
import { NO_WHY, type ID, type VoiceBody } from '../../src/data/types'
import { anotherDevice, HER_PIN, makeCouple, settle, type Phone } from './helpers'

let cloud: FakeCloud

beforeEach(() => {
  cloud = new FakeCloud()
})
afterEach(() => {
  vi.useRealTimers()
})

const HOUR = 3_600_000
const sound = () => new Blob([new Uint8Array(3000).fill(42)], { type: 'audio/webm' })

function draft(overrides: Partial<Draft> = {}): Draft {
  return {
    feel: { heat: 4, ease: 2, why: { chips: ['said.aroused', 'said.seen-differently'], own: ['greedy'], note: 'Because I never thought I would like it.' } },
    words: 'I keep thinking about Saturday.',
    voice: null,
    teaser: 'About Saturday',
    heatOutside: null,
    wants: 'react',
    keep: 'keep',
    openMode: 'now',
    opensAt: null,
    release: ['feel', 'words', 'voice'],
    ...overrides,
  }
}

async function view(phone: Phone, id: ID, now = Date.now()) {
  const envelope = await phone.db.envelopes.get(id)
  if (!envelope) throw new Error('no such envelope on this phone')
  const meId = (await phone.store.memberId()) as ID
  return viewOf(envelope, meId, { keys: await phone.db.keys.toArray(), vault: await phone.db.vault.toArray() }, now)
}

/** Everything the cloud holds about an envelope, as one string: for "is it in there anywhere?". */
function cloudDump(id: ID, extra: (ID | undefined)[] = []): string {
  return JSON.stringify([cloud.peek('envelopes', id), ...extra.map((key) => (key ? cloud.peek('keys', key) : null))])
}

describe('sealing', () => {
  it('keeps the words out of everything that leaves the phone', async () => {
    const { her, him } = await makeCouple(cloud)
    const id = await sealEnvelope(her.kit, draft())
    await settle(her, him)

    const keys = await her.db.keys.toArray()
    const stored = cloudDump(id, keys.map((k) => k.id))
    expect(stored).not.toContain('Saturday.')
    expect(stored).not.toContain('greedy')
    expect(stored).not.toContain('never thought')
    // The outside is meant to be readable.
    expect(stored).toContain('About Saturday')
    // And nothing readable sits in the queue or the local row either: only sealed layers.
    expect(JSON.stringify(await him.db.envelopes.get(id))).not.toContain('thinking')
  })

  it('refuses an empty envelope, a time that has passed and an opening that opens nothing', async () => {
    const { her } = await makeCouple(cloud)
    await expect(sealEnvelope(her.kit, draft({ feel: null, words: '   ', voice: null }))).rejects.toMatchObject({ code: 'nothing_inside' })
    await expect(sealEnvelope(her.kit, draft({ openMode: 'at', opensAt: new Date(Date.now() - 1000).toISOString() }))).rejects.toMatchObject({ code: 'time_past' })
    await expect(sealEnvelope(her.kit, draft({ openMode: 'now', release: [] }))).rejects.toBeInstanceOf(ActionError)
    expect(await her.db.envelopes.count()).toBe(0)
    expect(await her.db.outbox.count()).toBe(0)
  })

  it('lets its author read it again at once, on the phone that sealed it', async () => {
    const { her } = await makeCouple(cloud)
    const id = await sealEnvelope(her.kit, draft({ openMode: 'hand' }))
    const envelope = await her.db.envelopes.get(id)
    expect((await readLayer(her.kit, envelope!, 'words'))?.text).toBe('I keep thinking about Saturday.')
    expect((await readLayer(her.kit, envelope!, 'feel'))?.why.own).toEqual(['greedy'])
  })
})

describe('an envelope that opens right away', () => {
  it('is open for him as soon as both phones have synced', async () => {
    const { her, him } = await makeCouple(cloud)
    const id = await sealEnvelope(her.kit, draft())
    await settle(her, him)

    const his = await view(him, id)
    expect(his.standing).toBe('ready')
    expect(his.layers.map((l) => [l.layer, l.state, l.readable])).toEqual([
      ['feel', 'open', true],
      ['words', 'open', true],
    ])
    const envelope = await him.db.envelopes.get(id)
    expect((await readLayer(him.kit, envelope!, 'words'))?.text).toBe('I keep thinking about Saturday.')
    expect((await readLayer(him.kit, envelope!, 'feel'))?.heat).toBe(4)
    expect((await view(her, id)).standing).toBe('out')
  })

  it('carries a voice note, sealed in the cloud and whole on his phone', async () => {
    const { her, him } = await makeCouple(cloud)
    const id = await sealEnvelope(her.kit, draft({ voice: { blob: sound(), mime: 'audio/webm', seconds: 7.4 } }))
    await settle(her, him)

    const envelope = (await him.db.envelopes.get(id))!
    const voice = (await readLayer(him.kit, envelope, 'voice')) as VoiceBody
    expect(voice).toMatchObject({ mime: 'audio/webm', seconds: 7 })
    const heard = await readVoice(him.kit, envelope, voice)
    expect(new Uint8Array(await heard!.arrayBuffer())).toEqual(new Uint8Array(3000).fill(42))

    // What lies in cloud storage is not the sound.
    const stored = await her.backend.downloadBlob(mediaPath(envelope.householdId, voice.mediaId))
    const bytes = new Uint8Array(await stored!.arrayBuffer())
    expect(bytes.length).toBeGreaterThan(3000)
    expect(bytes.subarray(0, 64).every((b) => b === 42)).toBe(false)
  })
})

describe('an envelope with a time', () => {
  it('hands him nothing before its time, and the keys from that moment on', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-11-13T19:00:00Z'))
    const { her, him } = await makeCouple(cloud)
    const opensAt = new Date(Date.now() + 2 * HOUR).toISOString()
    const id = await sealEnvelope(her.kit, draft({ openMode: 'at', opensAt }))
    await settle(her, him)

    // He knows it is there and when it opens. He holds sealed layers and no key.
    let his = await view(him, id)
    expect(his.standing).toBe('waiting')
    expect(his.nextOpening).toBe(opensAt)
    expect(his.layers.map((l) => [l.layer, l.state, l.readable])).toEqual([
      ['feel', 'sealed', false],
      ['words', 'sealed', false],
    ])
    expect(await him.db.keys.count()).toBe(0)
    expect((await him.backend.pull(null)).tables.keys).toEqual([])
    expect(await readLayer(him.kit, (await him.db.envelopes.get(id))!, 'words')).toBeNull()

    // A minute before: still nothing, however often he asks.
    vi.setSystemTime(new Date(Date.parse(opensAt) - 60_000))
    await him.engine.sync()
    expect(await him.db.keys.count()).toBe(0)

    // The time has come. Nobody changed anything, and still the next sync brings the keys.
    vi.setSystemTime(new Date(Date.parse(opensAt) + 1000))
    await him.engine.sync()
    expect(await him.db.keys.count()).toBe(2)
    his = await view(him, id)
    expect(his.standing).toBe('ready')
    expect((await readLayer(him.kit, (await him.db.envelopes.get(id))!, 'words'))?.text).toBe('I keep thinking about Saturday.')
  })

  it('shows its author the time, on every device of hers, and lets her read it there', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-11-13T19:00:00Z'))
    const { her } = await makeCouple(cloud)
    const opensAt = new Date(Date.now() + 2 * HOUR).toISOString()
    const id = await sealEnvelope(her.kit, draft({ openMode: 'at', opensAt }))
    await her.engine.sync()

    const tablet = await anotherDevice(cloud, 'Mia', HER_PIN)
    const there = await view(tablet, id)
    expect(there.standing).toBe('sealed')
    expect(there.layers.every((l) => l.state === 'sealed' && l.opensAt === opensAt && l.readable)).toBe(true)
    expect((await readLayer(tablet.kit, (await tablet.db.envelopes.get(id))!, 'words'))?.text).toBe('I keep thinking about Saturday.')
  })

  it('can be opened ahead of its time by its author, and not called back afterwards', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-11-13T19:00:00Z'))
    const { her, him } = await makeCouple(cloud)
    const id = await sealEnvelope(her.kit, draft({ openMode: 'at', opensAt: new Date(Date.now() + 2 * HOUR).toISOString() }))
    await settle(her, him)

    vi.setSystemTime(new Date('2026-11-13T19:05:00Z'))
    expect(await openLayers(her.kit, id, ['feel', 'words'])).toEqual(['feel', 'words'])
    vi.setSystemTime(new Date('2026-11-13T19:05:02Z'))
    await settle(her, him)
    expect((await view(him, id)).standing).toBe('ready')

    // She tries to push the time back out: the cloud keeps the key where it is.
    const key = (await her.db.keys.toArray())[0]
    await her.backend.push({ table: 'keys', kind: 'patch', id: key.id, data: { opensAt: new Date(Date.now() + 5 * HOUR).toISOString() } })
    expect((await him.backend.pull(null)).tables.keys).toHaveLength(2)
  })

  it('holds back what its author leaves out, on her phone only', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-11-13T19:00:00Z'))
    const { her, him } = await makeCouple(cloud)
    const id = await sealEnvelope(her.kit, draft({ openMode: 'now', release: ['feel'] }))
    await settle(her, him)

    // He gets how it felt. Of the words there is no trace: not sealed, not as a key.
    expect((await view(him, id)).layers.map((l) => l.layer)).toEqual(['feel'])
    expect(Object.keys(cloud.peek('envelopes', id)!.layers as object)).toEqual(['feel'])
    expect((await view(her, id)).layers.map((l) => [l.layer, l.state])).toEqual([
      ['feel', 'open'],
      ['words', 'held'],
    ])

    // Tomorrow she opens the words too.
    vi.setSystemTime(new Date('2026-11-14T08:00:00Z'))
    expect(await openLayers(her.kit, id, ['words'])).toEqual(['words'])
    vi.setSystemTime(new Date('2026-11-14T08:00:02Z'))
    await settle(her, him)
    const his = await view(him, id)
    expect(his.layers.map((l) => [l.layer, l.state])).toEqual([
      ['feel', 'open'],
      ['words', 'open'],
    ])
    expect((await readLayer(him.kit, his.envelope, 'words'))?.text).toBe('I keep thinking about Saturday.')
  })
})

describe('an envelope that opens by hand', () => {
  it('leaves nothing of its inside in the cloud until she opens it', async () => {
    const { her, him } = await makeCouple(cloud)
    const id = await sealEnvelope(her.kit, draft({ openMode: 'hand', voice: { blob: sound(), mime: 'audio/webm', seconds: 3 } }))
    await settle(her, him)

    // He sees an envelope waiting, with its outside. Nothing else exists outside her phone.
    const his = await view(him, id)
    expect(his.standing).toBe('waiting')
    expect(his.nextOpening).toBeNull()
    expect(his.layers).toEqual([])
    expect(his.envelope.teaser).toBe('About Saturday')
    expect(cloud.peek('envelopes', id)!.layers).toEqual({})
    expect(await him.db.keys.count()).toBe(0)
    expect(await him.db.media.count()).toBe(0)

    expect((await view(her, id)).layers.map((l) => [l.layer, l.state, l.readable])).toEqual([
      ['feel', 'held', true],
      ['words', 'held', true],
      ['voice', 'held', true],
    ])
  })

  it('opens what she picks, when she says so, sound included', async () => {
    const { her, him } = await makeCouple(cloud)
    const id = await sealEnvelope(her.kit, draft({ openMode: 'hand', voice: { blob: sound(), mime: 'audio/webm', seconds: 3 } }))
    await settle(her, him)

    expect(await openLayers(her.kit, id, ['words', 'voice'])).toEqual(['words', 'voice'])
    await settle(her, him)

    const his = await view(him, id)
    expect(his.standing).toBe('ready')
    expect(his.layers.map((l) => [l.layer, l.state])).toEqual([
      ['words', 'open'],
      ['voice', 'open'],
    ])
    const voice = (await readLayer(him.kit, his.envelope, 'voice')) as VoiceBody
    expect((await readVoice(him.kit, his.envelope, voice))?.size).toBe(3000)
    expect((await view(her, id)).layers.find((l) => l.layer === 'feel')?.state).toBe('held')

    // Opening the same thing twice changes nothing.
    expect(await openLayers(her.kit, id, ['words'])).toEqual([])
  })

  it('cannot be read on another device of hers before it is opened', async () => {
    const { her } = await makeCouple(cloud)
    const id = await sealEnvelope(her.kit, draft({ openMode: 'hand' }))
    await her.engine.sync()
    const tablet = await anotherDevice(cloud, 'Mia', HER_PIN)
    const there = await view(tablet, id)
    expect(there.layers).toEqual([])
    expect(await readLayer(tablet.kit, there.envelope, 'words')).toBeNull()
  })

  it('is hers alone to open', async () => {
    const { her, him } = await makeCouple(cloud)
    const id = await sealEnvelope(her.kit, draft({ openMode: 'hand' }))
    await settle(her, him)
    await expect(openLayers(him.kit, id, ['words'])).rejects.toMatchObject({ code: 'not_yours' })
    await expect(takeBack(him.kit, id)).rejects.toMatchObject({ code: 'not_yours' })
  })
})

describe('opening and answering', () => {
  it('notes what he opened, once, and brings his answer to her', async () => {
    const { her, him } = await makeCouple(cloud)
    const id = await sealEnvelope(her.kit, draft())
    await settle(her, him)

    await expect(answer(him.kit, id, { taps: ['fire'], heat: 5, why: NO_WHY })).rejects.toMatchObject({ code: 'not_open' })
    await markSeen(him.kit, id, ['words'])
    const first = (await him.db.envelopes.get(id))!.seen.words
    await markSeen(him.kit, id, ['words', 'feel'])
    expect((await him.db.envelopes.get(id))!.seen.words).toBe(first)
    expect((await view(him, id)).standing).toBe('opened')

    await answer(him.kit, id, { taps: ['safe', 'fire'], heat: 5, why: { chips: ['received.safe'], own: [], note: 'Nothing about you changes for me.' } })
    await settle(him, her)
    const hers = await view(her, id)
    expect(hers.answered).toBe(true)
    expect(hers.envelope.reply).toMatchObject({ taps: ['safe', 'fire'], heat: 5, why: { note: 'Nothing about you changes for me.' } })

    // She cannot answer her own envelope, and cannot mark it opened for him.
    await expect(answer(her.kit, id, { taps: [], heat: null, why: NO_WHY })).rejects.toMatchObject({ code: 'not_yours' })
    await markSeen(her.kit, id, ['feel'])
    expect(await her.db.outbox.count()).toBe(0)
  })

  it('keeps the first answer time when the answer is changed', async () => {
    const { her, him } = await makeCouple(cloud)
    const id = await sealEnvelope(her.kit, draft())
    await settle(her, him)
    await markSeen(him.kit, id, ['words'])
    await answer(him.kit, id, { taps: ['fire'], heat: null, why: NO_WHY })
    const at = (await him.db.envelopes.get(id))!.reply!.at
    await answer(him.kit, id, { taps: ['fire', 'again'], heat: 4, why: NO_WHY })
    expect((await him.db.envelopes.get(id))!.reply).toMatchObject({ at, taps: ['fire', 'again'], heat: 4 })
  })
})

describe('one opening', () => {
  it('burns what he opened: gone from the cloud and from his phone, kept on hers', async () => {
    const { her, him } = await makeCouple(cloud)
    const id = await sealEnvelope(her.kit, draft({ keep: 'once', voice: { blob: sound(), mime: 'audio/webm', seconds: 3 } }))
    await settle(her, him)

    const before = await view(him, id)
    const voice = (await readLayer(him.kit, before.envelope, 'voice')) as VoiceBody
    const path = mediaPath(before.envelope.householdId, voice.mediaId)
    expect(cloud.hasBlob(path)).toBe(true)

    // He breaks the seal on the words and the voice. How it felt stays for later.
    await markSeen(him.kit, id, ['words', 'voice'])
    await settle(him, her)

    const stored = cloud.peek('envelopes', id)!
    expect(Object.keys(stored.layers as object)).toEqual(['feel'])
    expect(cloud.hasBlob(path)).toBe(false)
    const keys = await her.db.keys.toArray()
    expect(keys.filter((k) => k.layer !== 'feel').every((k) => k.key === '' && k.deletedAt)).toBe(true)
    expect(keys.find((k) => k.layer === 'feel')?.key).not.toBe('')

    // His phone has nothing left of them: no key, no sealed layer, no sound.
    const his = await view(him, id)
    expect(his.layers.map((l) => [l.layer, l.state, l.readable])).toEqual([
      ['feel', 'open', true],
      ['words', 'gone', false],
      ['voice', 'gone', false],
    ])
    expect((await him.db.keys.toArray()).map((k) => k.layer)).toEqual(['feel'])
    expect(await him.db.blobs.get(voice.mediaId)).toBeUndefined()
    expect(await readLayer(him.kit, his.envelope, 'words')).toBeNull()
    // Asking the cloud again from scratch brings nothing back.
    expect((await him.backend.pull(null)).tables.keys!.map((k) => k.layer)).toEqual(['feel'])

    // She still has her own copy, on the phone she sealed it on.
    const hers = await view(her, id)
    expect(hers.layers.find((l) => l.layer === 'words')).toMatchObject({ state: 'gone', readable: true })
    expect((await readLayer(her.kit, hers.envelope, 'words'))?.text).toBe('I keep thinking about Saturday.')
    expect((await readVoice(her.kit, hers.envelope, voice))?.size).toBe(3000)
  })

  it('throws away a key that comes back from a sync that was already on its way', async () => {
    const { her, him } = await makeCouple(cloud)
    const id = await sealEnvelope(her.kit, draft({ keep: 'once', release: ['words'] }))
    await settle(her, him)

    // His phone is in the middle of fetching when he breaks the seal: the answer it gets
    // was written before the burn and still carries the key.
    const realPull = him.backend.pull.bind(him.backend)
    him.backend.pull = async (since) => {
      const stale = await realPull(null)
      await markSeen(him.kit, id, ['words'])
      him.backend.pull = realPull
      return { ...stale, ...(since ? {} : {}) }
    }
    await him.engine.sync()
    await settle(him, her)
    expect(await him.db.keys.count()).toBe(0)
    expect((await view(him, id)).layers).toEqual([{ layer: 'words', state: 'gone', opensAt: null, seenAt: expect.any(String), readable: false }])
  })
})

describe('taking back', () => {
  it('makes the envelope disappear for both, and the cloud forget what was inside', async () => {
    const { her, him } = await makeCouple(cloud)
    const id = await sealEnvelope(her.kit, draft({ heatOutside: 4, voice: { blob: sound(), mime: 'audio/webm', seconds: 3 } }))
    await settle(her, him)
    const voice = (await readLayer(him.kit, (await him.db.envelopes.get(id))!, 'voice')) as VoiceBody
    const path = mediaPath((await him.db.envelopes.get(id))!.householdId, voice.mediaId)
    expect(await him.db.blobs.get(voice.mediaId)).toBeTruthy()
    await markSeen(him.kit, id, ['words'])
    await answer(him.kit, id, { taps: ['safe'], heat: 5, why: { chips: [], own: [], note: 'I am here.' } })
    await settle(him, her)
    expect(JSON.stringify(cloud.peek('envelopes', id))).toContain('I am here.')

    await takeBack(her.kit, id)
    await settle(her, him)

    // An empty shell stays, so both phones learn it is gone. It says nothing: not the
    // line from the outside, not how hot, not his answer.
    const stored = cloud.peek('envelopes', id)!
    expect(stored.deletedAt).toBeTruthy()
    expect(stored).toMatchObject({ layers: {}, teaser: null, heatOutside: null, reply: null })
    expect(JSON.stringify(stored)).not.toMatch(/Saturday|I am here/)
    expect(cloud.hasBlob(path)).toBe(false)
    for (const phone of [her, him]) {
      expect(await phone.db.envelopes.get(id)).toMatchObject({ layers: {}, teaser: null, heatOutside: null, reply: null })
      expect((await phone.db.envelopes.get(id))?.deletedAt).toBeTruthy()
      expect(await phone.db.vault.count()).toBe(0)
      expect(await phone.db.blobs.count()).toBe(0)
      expect((await phone.db.keys.toArray()).filter((k) => k.key !== '')).toEqual([])
    }
    expect((await him.backend.pull(null)).tables.keys).toEqual([])
  })

  it('works for an envelope that never left the phone', async () => {
    const { her, him } = await makeCouple(cloud)
    const id = await sealEnvelope(her.kit, draft({ openMode: 'hand', voice: { blob: sound(), mime: 'audio/webm', seconds: 3 } }))
    await takeBack(her.kit, id)
    await settle(her, him)
    expect(await her.db.vault.count()).toBe(0)
    expect(await her.db.blobs.count()).toBe(0)
    expect((await him.db.envelopes.get(id))?.deletedAt).toBeTruthy()
  })
})
