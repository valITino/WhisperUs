import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { BackendError } from '../../src/data/backend'
import type { DeadLetter } from '../../src/data/db'
import { FakeCloud } from '../../src/data/fake/cloudCore'
import { sealEnvelope } from '../../src/data/actions'
import { describeRefused } from '../../src/data/refused'
import { MAX_UPLOAD_ATTEMPTS } from '../../src/data/sync'
import type { ID } from '../../src/data/types'
import { makeCouple, type Phone } from './helpers'

const voiceDraft = () => ({
  feel: null,
  words: null,
  voice: { blob: new Blob([new Uint8Array(900).fill(5)]), mime: 'audio/webm', seconds: 2 },
  teaser: null,
  heatOutside: null,
  wants: 'listen' as const,
  keep: 'keep' as const,
  openMode: 'now' as const,
  opensAt: null,
  release: ['voice' as const],
})

let cloud: FakeCloud

beforeEach(() => {
  cloud = new FakeCloud()
})

/** Make the cloud say no to every change to these rows, until they are taken out of the set again. */
function refuse(phone: Phone): Set<ID> {
  const blocked = new Set<ID>()
  const push = phone.backend.push.bind(phone.backend)
  phone.backend.push = async (op) => {
    if (blocked.has(op.id)) throw new BackendError('rejected', 'forbidden')
    return push(op)
  }
  return blocked
}

const letters = (phone: Phone) => phone.db.deadLetters.orderBy('seq').toArray()

describe('a new row the cloud refused', () => {
  it('"Try again" sends it as it is now, later edits included', async () => {
    const { her, him } = await makeCouple(cloud)
    const blocked = refuse(her)
    const envelope = await her.envelope({ teaser: 'About Saturday' })
    blocked.add(envelope.id)
    await her.engine.sync()
    expect(await letters(her)).toMatchObject([{ table: 'envelopes', rowId: envelope.id, kind: 'put', attempts: 3, lastError: 'forbidden' }])
    expect(her.engine.status.stuck).toBe(1)
    // Still on her phone, nowhere else.
    expect((await her.db.envelopes.get(envelope.id))?.teaser).toBe('About Saturday')
    await him.engine.sync()
    expect(await him.db.envelopes.get(envelope.id)).toBeUndefined()

    // She keeps working on it. The cloud has no such row, so this edit alone would go nowhere.
    blocked.delete(envelope.id)
    await her.store.patch('envelopes', envelope.id, { teaser: 'About Saturday, again' })
    await her.engine.sync()
    await him.engine.sync()
    expect(await him.db.envelopes.get(envelope.id)).toBeUndefined()

    const [letter] = await letters(her)
    await her.engine.retryRefused(letter.seq as number)
    expect(await her.db.deadLetters.count()).toBe(0)
    expect(await her.db.outbox.toArray()).toMatchObject([{ table: 'envelopes', rowId: envelope.id, kind: 'put', attempts: 0, data: { teaser: 'About Saturday, again' } }])

    await her.engine.sync()
    await him.engine.sync()
    expect((await him.db.envelopes.get(envelope.id))?.teaser).toBe('About Saturday, again')
    expect(her.engine.status).toMatchObject({ stuck: 0, pending: 0 })
  })

  it('a second refusal sets it aside again instead of losing it', async () => {
    const { her } = await makeCouple(cloud)
    const blocked = refuse(her)
    const envelope = await her.envelope({ teaser: 'About Saturday' })
    blocked.add(envelope.id)
    await her.engine.sync()
    const [first] = await letters(her)
    await her.engine.retryRefused(first.seq as number)
    await her.engine.sync()
    const again = await letters(her)
    expect(again).toHaveLength(1)
    expect(again[0].seq).not.toBe(first.seq)
    expect(await her.db.envelopes.get(envelope.id)).toBeTruthy()
  })

  it('"Discard" removes it from this device too, with the edits that were waiting for it', async () => {
    const { her, him } = await makeCouple(cloud)
    const blocked = refuse(her)
    const envelope = await her.envelope({ teaser: 'About Saturday' })
    const other = await her.envelope({ teaser: 'About Sunday' })
    blocked.add(envelope.id)
    await her.engine.sync()
    const [letter] = await letters(her)

    // Offline nobody can tell whether the cloud has the row: nothing is thrown away.
    her.backend.online = false
    await her.store.patch('envelopes', envelope.id, { teaser: 'About Saturday, edited offline' })
    await expect(her.engine.discardRefused(letter.seq as number)).rejects.toMatchObject({ kind: 'network' })
    expect(await her.db.deadLetters.count()).toBe(1)
    expect(await her.db.envelopes.get(envelope.id)).toBeTruthy()

    her.backend.online = true
    await her.engine.discardRefused(letter.seq as number)
    expect(await her.db.deadLetters.count()).toBe(0)
    expect(await her.db.envelopes.get(envelope.id)).toBeUndefined()
    expect(await her.db.outbox.count()).toBe(0)
    expect(her.engine.status.stuck).toBe(0)
    // Everything else is untouched, here and there.
    expect((await her.db.envelopes.get(other.id))?.teaser).toBe('About Sunday')
    await him.engine.sync()
    expect((await him.db.envelopes.get(other.id))?.teaser).toBe('About Sunday')
  })

  it('"Discard" keeps the row when the cloud has it after all', async () => {
    const { her } = await makeCouple(cloud)
    const blocked = refuse(her)
    const envelope = await her.envelope({ teaser: 'About Saturday' })
    blocked.add(envelope.id)
    await her.engine.sync()
    // It arrived some other way in the meantime.
    blocked.delete(envelope.id)
    await her.backend.push({ table: 'envelopes', kind: 'put', id: envelope.id, data: { ...envelope } })

    const [letter] = await letters(her)
    await her.engine.discardRefused(letter.seq as number)
    expect(await her.db.deadLetters.count()).toBe(0)
    expect((await her.db.envelopes.get(envelope.id))?.teaser).toBe('About Saturday')
  })

  it('a refused voice note takes its sealed sound along when it is discarded', async () => {
    const { her } = await makeCouple(cloud)
    const blocked = refuse(her)
    await sealEnvelope(her.kit, voiceDraft())
    const [media] = await her.db.media.toArray()
    blocked.add(media.id)
    await her.engine.sync()
    const letter = (await letters(her)).find((l) => l.kind === 'put')
    expect(letter).toMatchObject({ table: 'media', kind: 'put' })
    for (const other of await letters(her)) if (other.seq !== letter?.seq) await her.db.deadLetters.delete(other.seq as number)

    await her.engine.discardRefused(letter?.seq as number)
    expect(await her.db.media.get(media.id)).toBeUndefined()
    expect(await her.db.blobs.get(media.id)).toBeUndefined()
  })
})

describe('an edit the cloud refused', () => {
  async function refusedRename() {
    const { her, him } = await makeCouple(cloud)
    const blocked = refuse(her)
    const envelope = await her.envelope({ teaser: 'About Saturday' })
    await her.engine.sync()
    blocked.add(envelope.id)
    await her.store.patch('envelopes', envelope.id, { teaser: 'About Saturday night' })
    await her.engine.sync()
    const [letter] = await letters(her)
    expect(letter).toMatchObject({ table: 'envelopes', kind: 'patch', data: { teaser: 'About Saturday night' } })
    // Her phone has fallen back in line with the cloud: the old name is back on screen.
    expect((await her.db.envelopes.get(envelope.id))?.teaser).toBe('About Saturday')
    return { her, him, blocked, envelope, seq: letter.seq as number }
  }

  it('"Try again" applies it again and sends it', async () => {
    const { her, him, blocked, envelope, seq } = await refusedRename()
    blocked.delete(envelope.id)
    await her.engine.retryRefused(seq)
    expect((await her.db.envelopes.get(envelope.id))?.teaser).toBe('About Saturday night')
    await her.engine.sync()
    await him.engine.sync()
    expect((await him.db.envelopes.get(envelope.id))?.teaser).toBe('About Saturday night')
    expect(await her.db.deadLetters.count()).toBe(0)
  })

  it('"Discard" drops the edit and leaves the row as the cloud has it, even offline', async () => {
    const { her, him, envelope, seq } = await refusedRename()
    her.backend.online = false
    await her.engine.discardRefused(seq)
    expect(await her.db.deadLetters.count()).toBe(0)
    expect((await her.db.envelopes.get(envelope.id))?.teaser).toBe('About Saturday')
    her.backend.online = true
    await her.engine.sync()
    await him.engine.sync()
    expect((await him.db.envelopes.get(envelope.id))?.teaser).toBe('About Saturday')
  })

  it('both do nothing for a change that is no longer in the list', async () => {
    const { her, seq } = await refusedRename()
    await her.engine.discardRefused(seq)
    await expect(her.engine.discardRefused(seq)).resolves.toBeUndefined()
    await expect(her.engine.retryRefused(seq)).resolves.toBeUndefined()
    expect(await her.db.outbox.count()).toBe(0)
  })
})

describe('a voice note the cloud keeps refusing', () => {
  it('stops being sent after five tries, and "Try again" gives it a fresh start', async () => {
    const { her, him } = await makeCouple(cloud)
    let refusing = true
    const upload = her.backend.uploadBlob.bind(her.backend)
    her.backend.uploadBlob = async (path, blob) => {
      if (refusing) throw new BackendError('rejected', 'storage_refused')
      return upload(path, blob)
    }
    await sealEnvelope(her.kit, voiceDraft())
    const [media] = await her.db.media.toArray()
    for (let pass = 0; pass < MAX_UPLOAD_ATTEMPTS + 2; pass++) await her.engine.sync()
    expect(await her.db.blobs.get(media.id)).toMatchObject({ pending: 1, attempts: MAX_UPLOAD_ATTEMPTS })
    expect(her.engine.status.uploads).toBe(1)

    // The cloud takes files again, but this one has given up.
    refusing = false
    await her.engine.sync()
    expect((await her.db.blobs.get(media.id))?.pending).toBe(1)

    await her.engine.retryUploads()
    await her.engine.sync()
    expect(await her.db.blobs.get(media.id)).toMatchObject({ pending: 0, attempts: 0 })
    await him.engine.sync()
    expect(((await him.db.blobs.get(media.id))?.data as Blob).size).toBeGreaterThan(900)
    expect((await him.db.media.get(media.id))?.uploaded).toBe(true)
  })
})

describe('saying what a refused change was', () => {
  const letter = (table: DeadLetter['table'], kind: 'put' | 'patch', data: Record<string, unknown> = {}): DeadLetter => ({ seq: 7, table, rowId: 'row', kind, data, createdAt: '2026-11-10T07:00:00.000Z', attempts: 3, lastError: 'forbidden', failedAt: '2026-11-10T07:01:00.000Z' })
  const said = (l: DeadLetter) => {
    const { thing, what } = describeRefused(l)
    return [thing, what]
  }

  it('says what kind of thing it was', () => {
    expect(said(letter('envelopes', 'patch', { teaser: 'Reworded' }))).toEqual(['envelope', 'change'])
    expect(said(letter('keys', 'put', { key: 'k' }))).toEqual(['key', 'new'])
    expect(said(letter('media', 'put', { bytes: 12 }))).toEqual(['voice', 'new'])
    expect(said(letter('members', 'patch', { status: 'x' }))).toEqual(['profile', 'change'])
    expect(said(letter('households', 'patch', { name: 'Room 12' }))).toEqual(['room', 'change'])
    expect(describeRefused(letter('envelopes', 'patch'))).toMatchObject({ seq: 7, failedAt: '2026-11-10T07:01:00.000Z' })
  })

  it('tells new things, edits and removals apart', () => {
    expect(said(letter('envelopes', 'put', { teaser: 'About Saturday' }))).toEqual(['envelope', 'new'])
    expect(said(letter('envelopes', 'patch', { deletedAt: '2026-11-10T07:00:00.000Z' }))).toEqual(['envelope', 'removal'])
    expect(said(letter('envelopes', 'patch', { deletedAt: null }))).toEqual(['envelope', 'change'])
  })

  it('never carries anything from the envelope itself', () => {
    const told = describeRefused(letter('envelopes', 'put', { teaser: 'About Saturday', layers: { words: { iv: 'a', box: 'b' } }, reply: { taps: ['fire'] } }))
    expect(Object.keys(told).sort()).toEqual(['failedAt', 'seq', 'thing', 'what'])
    expect(JSON.stringify(told)).not.toContain('Saturday')
  })
})
