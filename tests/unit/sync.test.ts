import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { BackendError } from '../../src/data/backend'
import { FakeCloud } from '../../src/data/fake/cloudCore'
import type { Reply } from '../../src/data/types'
import { anotherDevice, HER_PIN, makeCouple, makePhone } from './helpers'

let cloud: FakeCloud

beforeEach(() => {
  cloud = new FakeCloud()
})

const answer = (taps: string[]): Reply => ({ taps, heat: null, why: { chips: [], own: [], note: null }, at: new Date().toISOString() })

describe('pairing', () => {
  it('gives both phones the room and both profiles, and nothing else', async () => {
    const { her, him } = await makeCouple(cloud)
    for (const phone of [her, him]) {
      expect(await phone.db.households.count()).toBe(1)
      expect((await phone.db.members.toArray()).map((m) => m.name).sort()).toEqual(['Leo', 'Mia'])
      expect(await phone.db.envelopes.count()).toBe(0)
    }
  })

  it('refuses a second room, a third person and a wrong code', async () => {
    const { her } = await makeCouple(cloud)
    const stranger = makePhone(cloud)
    await expect(stranger.backend.createHousehold('Mine', { name: 'X' }, '864209')).rejects.toMatchObject({ code: 'room_already_exists' })
    await expect(stranger.backend.joinHousehold('WRONGCODE1', { name: 'X' }, '864209')).rejects.toMatchObject({ code: 'invite_invalid' })
    await expect(her.backend.createInvite('join')).rejects.toMatchObject({ code: 'room_full' })
    expect((await stranger.backend.pull(null)).tables.envelopes).toEqual([])
  })
})

describe('sync between two phones', () => {
  it('carries a new envelope from her phone to his', async () => {
    const { her, him } = await makeCouple(cloud)
    const envelope = await her.envelope({ teaser: 'Über Samstag' })
    await her.engine.sync()
    await him.engine.sync()
    expect((await him.db.envelopes.get(envelope.id))?.teaser).toBe('Über Samstag')
    expect(her.engine.status).toMatchObject({ state: 'idle', pending: 0 })
  })

  it('works offline and catches up later, without the phones ever being online together', async () => {
    const { her, him } = await makeCouple(cloud)

    // She seals something at 22:00 while his phone is asleep.
    him.backend.online = false
    const hers = await her.envelope({ teaser: 'Hers' })
    await her.engine.sync()
    her.backend.online = false

    // He seals something of his own while offline: it queues up.
    const his = await him.envelope({ teaser: 'His' })
    await him.engine.sync()
    expect(him.engine.status).toMatchObject({ state: 'offline', pending: 1 })

    // His phone wakes up while hers is off.
    him.backend.online = true
    await him.engine.sync()
    expect((await him.db.envelopes.get(hers.id))?.teaser).toBe('Hers')
    expect(him.engine.status).toMatchObject({ state: 'idle', pending: 0 })

    her.backend.online = true
    await her.engine.sync()
    expect((await her.db.envelopes.get(his.id))?.teaser).toBe('His')
  })

  it('merges her change to the outside and his answer to the same envelope', async () => {
    const { her, him } = await makeCouple(cloud)
    const envelope = await her.envelope()
    await her.engine.sync()
    await him.engine.sync()

    him.backend.online = false
    await him.store.patch('envelopes', envelope.id, { seen: { words: '2026-11-13T21:00:00.000Z' }, reply: answer(['fire']) })
    await her.store.patch('envelopes', envelope.id, { teaser: 'Reworded' })
    await her.engine.sync()

    him.backend.online = true
    await him.engine.sync()
    await her.engine.sync()

    for (const phone of [her, him]) {
      const row = await phone.db.envelopes.get(envelope.id)
      expect(row?.teaser).toBe('Reworded')
      expect(row?.reply?.taps).toEqual(['fire'])
    }
  })

  it('settles on one value when two of her devices change the same field', async () => {
    const { her, him } = await makeCouple(cloud)
    const tablet = await anotherDevice(cloud, 'Mia', HER_PIN)
    const envelope = await her.envelope()
    await her.engine.sync()
    await tablet.engine.sync()

    await her.store.patch('envelopes', envelope.id, { teaser: 'From the phone' })
    await tablet.store.patch('envelopes', envelope.id, { teaser: 'From the tablet' })
    await her.engine.sync()
    await tablet.engine.sync() // arrives last, so it wins
    await her.engine.sync()
    await him.engine.sync()

    for (const phone of [her, tablet, him]) expect((await phone.db.envelopes.get(envelope.id))?.teaser).toBe('From the tablet')
  })

  it('keeps an answer written during a sync pass instead of overwriting it with older cloud data', async () => {
    const { her, him } = await makeCouple(cloud)
    const envelope = await her.envelope()
    await her.engine.sync()
    await him.engine.sync()

    await her.store.patch('envelopes', envelope.id, { teaser: 'Reworded by her' })
    await her.engine.sync()

    // He answers at the exact moment his phone is pulling her new wording.
    const realPull = him.backend.pull.bind(him.backend)
    him.backend.pull = async (since) => {
      const result = await realPull(since)
      await him.store.patch('envelopes', envelope.id, { reply: answer(['melt']) })
      him.backend.pull = realPull
      return result
    }
    await him.engine.sync()
    expect(await him.db.envelopes.get(envelope.id)).toMatchObject({ teaser: 'Reworded by her', reply: { taps: ['melt'] } })

    await him.engine.sync()
    await her.engine.sync()
    expect(await her.db.envelopes.get(envelope.id)).toMatchObject({ teaser: 'Reworded by her', reply: { taps: ['melt'] } })
  })

  it('syncs a soft delete', async () => {
    const { her, him } = await makeCouple(cloud)
    const envelope = await her.envelope()
    await her.engine.sync()
    await him.engine.sync()
    await her.store.remove('envelopes', envelope.id)
    await her.engine.sync()
    await him.engine.sync()
    expect((await him.db.envelopes.get(envelope.id))?.deletedAt).toBeTruthy()
  })
})

describe('profiles', () => {
  it('shows his status line on her phone, and only he can change it', async () => {
    const { her, him } = await makeCouple(cloud)
    const hisId = (await him.store.memberId()) as string

    await him.store.patch('members', hisId, { status: 'Thinking of you', avatar: 'key', accessory: 'bow' })
    await him.engine.sync()
    await her.engine.sync()
    expect(await her.db.members.get(hisId)).toMatchObject({ status: 'Thinking of you', accessory: 'bow' })

    // She cannot rewrite his status: the app refuses, and so does the cloud if asked directly.
    await expect(her.store.patch('members', hisId, { status: 'Not thinking at all' })).rejects.toThrow('own profile')
    await her.backend.push({ table: 'members', kind: 'patch', id: hisId, data: { status: 'Not thinking at all' } })
    await him.engine.sync()
    await her.engine.sync()
    expect((await him.db.members.get(hisId))?.status).toBe('Thinking of you')
    expect((await her.db.members.get(hisId))?.status).toBe('Thinking of you')
  })

  it('refuses a status longer than 60 characters', async () => {
    const { him } = await makeCouple(cloud)
    const hisId = (await him.store.memberId()) as string
    await expect(him.backend.push({ table: 'members', kind: 'patch', id: hisId, data: { status: 'h'.repeat(61) } })).rejects.toMatchObject({ kind: 'rejected' })
  })
})

describe('outbox', () => {
  it('collapses rapid edits to one row into a single queued change', async () => {
    const { her } = await makeCouple(cloud)
    const envelope = await her.envelope()
    await her.engine.sync()

    await her.store.patch('envelopes', envelope.id, { teaser: 'A' })
    await her.store.patch('envelopes', envelope.id, { teaser: 'Ab' })
    await her.store.patch('envelopes', envelope.id, { wants: 'talk' })
    const queued = await her.db.outbox.toArray()
    expect(queued).toHaveLength(1)
    expect(queued[0].data).toEqual({ teaser: 'Ab', wants: 'talk' })
  })

  it('never reorders: a change to another row in between starts a new entry', async () => {
    const { her } = await makeCouple(cloud)
    const first = await her.envelope({ teaser: 'A' })
    const second = await her.envelope({ teaser: 'B' })
    await her.store.patch('envelopes', first.id, { teaser: 'A2' })
    const queued = await her.db.outbox.orderBy('seq').toArray()
    expect(queued.map((op) => [op.kind, op.rowId])).toEqual([
      ['put', first.id],
      ['put', second.id],
      ['patch', first.id],
    ])
  })

  it('sets a refused change aside after three tries and keeps the rest moving', async () => {
    const { her, him } = await makeCouple(cloud)
    const bad = await her.envelope({ teaser: 'Smuggled', householdId: crypto.randomUUID() })
    const good = await her.envelope({ teaser: 'Honest' })
    await her.engine.sync()

    expect(await her.db.outbox.count()).toBe(0)
    const stuck = await her.db.deadLetters.toArray()
    expect(stuck).toHaveLength(1)
    expect(stuck[0]).toMatchObject({ rowId: bad.id, attempts: 3 })
    expect(her.engine.status.stuck).toBe(1)

    await him.engine.sync()
    expect(await him.db.envelopes.get(good.id)).toBeTruthy()
    expect(await him.db.envelopes.get(bad.id)).toBeUndefined()
  })

  it('does not lose queued changes when the connection drops halfway', async () => {
    const { her, him } = await makeCouple(cloud)
    const a = await her.envelope({ teaser: 'First' })
    const b = await her.envelope({ teaser: 'Second' })

    const realPush = her.backend.push.bind(her.backend)
    let calls = 0
    her.backend.push = async (op) => {
      if (++calls === 2) throw new BackendError('network', 'offline')
      return realPush(op)
    }
    await her.engine.sync()
    expect(her.engine.status).toMatchObject({ state: 'offline', pending: 1 })

    her.backend.push = realPush
    await her.engine.sync()
    await him.engine.sync()
    expect((await him.db.envelopes.bulkGet([a.id, b.id])).map((e) => e?.teaser)).toEqual(['First', 'Second'])
  })
})

describe('restore and lock-out', () => {
  it('lets a person back in on a new phone and logs the old one out without losing its unsent work', async () => {
    const { her, him } = await makeCouple(cloud)
    const hisMemberId = (await him.store.memberId()) as string

    const invite = await her.backend.createInvite('restore', hisMemberId)
    const newPhone = makePhone(cloud)
    const membership = await newPhone.backend.joinHousehold(invite.code, { name: 'ignored' }, '864209')
    expect(membership).toMatchObject({ memberId: hisMemberId, kind: 'restore' })
    await newPhone.adopt(membership)
    await newPhone.engine.sync()
    expect((await newPhone.db.members.toArray()).map((m) => m.name).sort()).toEqual(['Leo', 'Mia'])

    await him.envelope({ teaser: 'Sealed on the old phone' })
    await him.engine.sync()
    expect(him.engine.status.state).toBe('locked-out')
    expect(await him.db.outbox.count()).toBe(1)
    expect(await him.db.deadLetters.count()).toBe(0)
  })
})
