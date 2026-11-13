import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FakeCloud } from '../../src/data/fake/cloudCore'
import { lockMinutes, nameKey, pinProblem } from '../../src/data/pin'
import { HER_PIN, HIS_PIN, makeCouple, makePhone } from './helpers'

let cloud: FakeCloud

beforeEach(() => {
  cloud = new FakeCloud()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('PIN rules', () => {
  it('takes six digits and nothing else', () => {
    expect(pinProblem('271828')).toBeNull()
    for (const bad of ['', '12345', '1234567', '12345a', ' 27182', '２７１８２８']) expect(pinProblem(bad)).toBe('pin_invalid')
  })

  it('refuses the PINs everybody tries first', () => {
    for (const simple of ['000000', '999999', '123456', '234567', '567890', '654321', '987654', '109876', '121212', '696969', '123123', '808808']) {
      expect(pinProblem(simple), simple).toBe('pin_too_simple')
    }
    for (const fine of ['112233', '135790', '271828', '314159', '100000', '123457']) expect(pinProblem(fine), fine).toBeNull()
  })

  it('pauses a name for 15 minutes, then twice as long each time, at most a day', () => {
    expect([1, 2, 3, 4, 5, 6, 7, 8, 20].map(lockMinutes)).toEqual([15, 30, 60, 120, 240, 480, 960, 1440, 1440])
  })

  it('treats names the same with or without capitals and outer spaces', () => {
    expect(nameKey('  LEO ')).toBe(nameKey('leo'))
  })
})

describe('opening and joining', () => {
  it('makes whoever opens the room the admin, and nobody else', async () => {
    const { her } = await makeCouple(cloud)
    const members = await her.db.members.toArray()
    expect(members.find((m) => m.name === 'Mia')).toMatchObject({ isAdmin: true, disabledAt: null })
    expect(members.find((m) => m.name === 'Leo')).toMatchObject({ isAdmin: false, disabledAt: null })
  })

  it('keeps the avatar, accessory and status chosen while setting up', async () => {
    const phone = makePhone(cloud)
    await phone.adopt(await phone.backend.createHousehold('Casa', { name: 'Leo', avatar: 'key', color: 'moss', accessory: 'bow', status: 'Thinking of you' }, HIS_PIN))
    await phone.engine.sync()
    expect((await phone.db.members.toArray())[0]).toMatchObject({ name: 'Leo', accessory: 'bow', status: 'Thinking of you', isAdmin: true })
  })

  it('says whether a room exists, so nobody fills in a profile for nothing', async () => {
    const phone = makePhone(cloud)
    expect(await phone.backend.roomExists()).toBe(false)
    await phone.backend.createHousehold('Casa', { name: 'Leo' }, HIS_PIN)
    expect(await makePhone(cloud).backend.roomExists()).toBe(true)
  })

  it('refuses a missing or too simple PIN before anything is created', async () => {
    const phone = makePhone(cloud)
    await expect(phone.backend.createHousehold('Casa', { name: 'Leo' }, '12')).rejects.toMatchObject({ code: 'pin_invalid' })
    await expect(phone.backend.createHousehold('Casa', { name: 'Leo' }, '123456')).rejects.toMatchObject({ code: 'pin_too_simple' })
    expect(await phone.backend.roomExists()).toBe(false)
  })

  it('shows who is inviting before the code is used', async () => {
    const her = makePhone(cloud)
    await her.backend.createHousehold('Casa Mia', { name: 'Mia', avatar: 'moon', color: 'candle', accessory: 'bow' }, HER_PIN)
    const invite = await her.backend.createInvite('join')
    const guest = makePhone(cloud)
    const pretty = `${invite.code.slice(0, 5)}-${invite.code.slice(5).toLowerCase()}`
    expect(await guest.backend.peekInvite(pretty)).toEqual({
      kind: 'join',
      roomName: 'Casa Mia',
      host: { name: 'Mia', avatar: 'moon', color: 'candle', accessory: 'bow' },
      profile: null,
    })
    await expect(guest.backend.peekInvite('NOPENOPE22')).rejects.toMatchObject({ code: 'invite_invalid' })
    // Looking does not use the code up.
    await expect(guest.backend.joinHousehold(invite.code, { name: 'Leo' }, HIS_PIN)).resolves.toMatchObject({ kind: 'join' })
  })

  it('does not let two people share a name, because the name is how they log in', async () => {
    const her = makePhone(cloud)
    await her.adopt(await her.backend.createHousehold('Casa', { name: 'Mia' }, HER_PIN))
    const invite = await her.backend.createInvite('join')
    const guest = makePhone(cloud)
    await expect(guest.backend.joinHousehold(invite.code, { name: ' mia ' }, HIS_PIN)).rejects.toMatchObject({ code: 'name_taken' })
    // The code survives the refusal.
    await guest.adopt(await guest.backend.joinHousehold(invite.code, { name: 'Leo' }, HIS_PIN))
    await guest.engine.sync()

    // Renaming yourself to your partner's name is refused too, and nothing is lost.
    const me = (await guest.store.memberId()) as string
    await guest.store.patch('members', me, { name: 'MIA' })
    await guest.engine.sync()
    await guest.engine.sync()
    await guest.engine.sync()
    expect(await guest.db.deadLetters.count()).toBe(1)
    expect((await guest.db.members.get(me))?.name).toBe('Leo')
  })
})

describe('logging in from another device', () => {
  it('recognises the person by name and PIN and brings everything along', async () => {
    const { her, him } = await makeCouple(cloud)
    await her.envelope({ teaser: 'Sunday' })
    await her.engine.sync()
    const hisId = (await him.store.memberId()) as string
    await him.store.patch('members', hisId, { status: 'Thinking of you', prefs: { theme: 'dark', lang: 'de' } })
    await him.engine.sync()

    const tablet = makePhone(cloud)
    const seat = await tablet.backend.signInWithPin('  leo ', HIS_PIN)
    expect(seat.memberId).toBe(hisId)
    await tablet.adopt(seat)
    await tablet.engine.sync()

    expect((await tablet.db.envelopes.toArray()).map((e) => e.teaser)).toEqual(['Sunday'])
    expect(await tablet.db.members.get(hisId)).toMatchObject({ status: 'Thinking of you', prefs: { theme: 'dark', lang: 'de' } })

    // Both of his devices stay logged in and both can write.
    await tablet.envelope({ teaser: 'From the tablet' })
    await tablet.engine.sync()
    await him.envelope({ teaser: 'From the phone' })
    await him.engine.sync()
    await tablet.engine.sync()
    expect(him.engine.status.state).toBe('idle')
    expect((await tablet.db.envelopes.toArray()).map((e) => e.teaser).sort()).toEqual(['From the phone', 'From the tablet', 'Sunday'])
  })

  it('answers a wrong PIN and an unknown name in exactly the same way', async () => {
    await makeCouple(cloud)
    const stranger = makePhone(cloud)
    const wrongPin = await stranger.backend.signInWithPin('Leo', '864209').catch((e) => e)
    const noSuchName = await stranger.backend.signInWithPin('Nobody', '864209').catch((e) => e)
    expect({ code: wrongPin.code, details: wrongPin.details }).toEqual({ code: 'pin_wrong', details: { triesLeft: 4 } })
    expect({ code: noSuchName.code, details: noSuchName.details }).toEqual({ code: 'pin_wrong', details: { triesLeft: 4 } })
  })

  it('pauses a name after five wrong tries, even for the right PIN, and longer each time', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-11-10T12:00:00Z'))
    await makeCouple(cloud)
    const stranger = makePhone(cloud)

    for (const left of [4, 3, 2, 1]) {
      await expect(stranger.backend.signInWithPin('Leo', '864209')).rejects.toMatchObject({ code: 'pin_wrong', details: { triesLeft: left } })
    }
    await expect(stranger.backend.signInWithPin('Leo', '864209')).rejects.toMatchObject({ code: 'pin_locked', details: { retryAt: '2026-11-10T12:15:00.000Z' } })

    // The lock belongs to the name, not to the device that guessed.
    const hisNewPhone = makePhone(cloud)
    await expect(hisNewPhone.backend.signInWithPin('Leo', HIS_PIN)).rejects.toMatchObject({ code: 'pin_locked' })
    // His partner is not affected.
    await expect(makePhone(cloud).backend.signInWithPin('Mia', HER_PIN)).resolves.toBeTruthy()

    vi.setSystemTime(new Date('2026-11-10T12:15:01Z'))
    for (let i = 0; i < 4; i++) await expect(stranger.backend.signInWithPin('Leo', '864209')).rejects.toMatchObject({ code: 'pin_wrong' })
    await expect(stranger.backend.signInWithPin('Leo', '864209')).rejects.toMatchObject({ code: 'pin_locked', details: { retryAt: '2026-11-10T12:45:01.000Z' } })

    // Once the pause is over, the right PIN works and wipes the slate clean.
    vi.setSystemTime(new Date('2026-11-10T12:45:02Z'))
    await expect(hisNewPhone.backend.signInWithPin('Leo', HIS_PIN)).resolves.toBeTruthy()
    await expect(stranger.backend.signInWithPin('Leo', '864209')).rejects.toMatchObject({ code: 'pin_wrong', details: { triesLeft: 4 } })
  })

  it('lets a person change their PIN; the old one stops working', async () => {
    const { him } = await makeCouple(cloud)
    await expect(him.backend.setPin('111111')).rejects.toMatchObject({ code: 'pin_too_simple' })
    await him.backend.setPin('864209')
    await expect(makePhone(cloud).backend.signInWithPin('Leo', HIS_PIN)).rejects.toMatchObject({ code: 'pin_wrong' })
    await expect(makePhone(cloud).backend.signInWithPin('Leo', '864209')).resolves.toBeTruthy()
  })

  it('logs one device out without touching the others', async () => {
    const { him } = await makeCouple(cloud)
    const tablet = makePhone(cloud)
    await tablet.adopt(await tablet.backend.signInWithPin('Leo', HIS_PIN))
    await tablet.engine.sync()

    await tablet.backend.signOutDevice()
    expect(await tablet.backend.membership()).toBeNull()
    expect((await tablet.backend.pull(null)).seat).toBe('gone')
    expect(await him.backend.membership()).not.toBeNull()
  })

  it('logs all other devices out, and they notice on their next look at the cloud', async () => {
    const { him } = await makeCouple(cloud)
    const tablet = makePhone(cloud)
    await tablet.adopt(await tablet.backend.signInWithPin('Leo', HIS_PIN))
    await tablet.engine.sync()
    expect(tablet.engine.status.state).toBe('idle')

    expect(await him.backend.signOutOtherDevices()).toBe(1)
    // Nothing to send, so the tablet only finds out from the pull.
    await tablet.engine.sync()
    expect(tablet.engine.status.state).toBe('locked-out')
    await him.engine.sync()
    expect(him.engine.status.state).toBe('idle')
  })
})

describe('the admin', () => {
  it('is the only one who can invite, let back in, pause and log out', async () => {
    const { her, him } = await makeCouple(cloud)
    const herId = (await her.store.memberId()) as string
    const hisId = (await him.store.memberId()) as string

    await expect(him.backend.createInvite('restore', herId)).rejects.toMatchObject({ code: 'admin_only' })
    await expect(him.backend.createInvite('join')).rejects.toMatchObject({ code: 'admin_only' })
    await expect(him.backend.setMemberPaused(herId, true)).rejects.toMatchObject({ code: 'admin_only' })
    await expect(him.backend.signOutMember(herId)).rejects.toMatchObject({ code: 'admin_only' })

    // Not even the admin can do these things to themselves.
    await expect(her.backend.setMemberPaused(herId, true)).rejects.toMatchObject({ code: 'not_yourself' })
    await expect(her.backend.createInvite('restore', herId)).rejects.toMatchObject({ code: 'not_yourself' })
    await expect(her.backend.signOutMember(herId)).rejects.toMatchObject({ code: 'not_yourself' })
    await expect(her.backend.createInvite('restore', hisId)).resolves.toMatchObject({ kind: 'restore' })
  })

  it('cannot be made by editing a profile', async () => {
    const { him } = await makeCouple(cloud)
    const hisId = (await him.store.memberId()) as string
    await him.store.patch('members', hisId, { isAdmin: true, disabledAt: null, status: 'Sneaky' } as never)
    await him.engine.sync()
    await him.db.meta.delete('sync.cursor')
    await him.engine.sync()
    expect(await him.db.members.get(hisId)).toMatchObject({ isAdmin: false, status: 'Sneaky' })
  })

  it('pauses a profile: no reading, no writing, no logging in, and nothing is lost', async () => {
    const { her, him } = await makeCouple(cloud)
    const hisId = (await him.store.memberId()) as string
    await her.envelope({ teaser: 'Before the pause' })
    await her.engine.sync()
    await him.engine.sync()

    await her.backend.setMemberPaused(hisId, true)
    await her.engine.sync()
    expect((await her.db.members.get(hisId))?.disabledAt).toEqual(expect.any(String))

    // His phone notices, keeps what he writes, and sees nothing new.
    await him.envelope({ teaser: 'Written while paused' })
    await her.envelope({ teaser: 'Sealed while he was away' })
    await her.engine.sync()
    await him.engine.sync()
    expect(him.engine.status.state).toBe('paused')
    expect(await him.db.outbox.count()).toBe(1)
    expect((await him.backend.pull(null)).tables.envelopes).toEqual([])
    expect(await him.backend.membership()).toMatchObject({ memberId: hisId, paused: true })
    await expect(makePhone(cloud).backend.signInWithPin('Leo', HIS_PIN)).rejects.toMatchObject({ code: 'account_paused' })
    await expect(him.backend.setPin('864209')).rejects.toMatchObject({ code: 'not_in_room' })

    // Switched on again: the phone carries on by itself and delivers what it kept.
    await her.backend.setMemberPaused(hisId, false)
    await him.engine.sync()
    expect(him.engine.status.state).toBe('idle')
    expect(await him.db.outbox.count()).toBe(0)
    await her.engine.sync()
    expect((await her.db.envelopes.toArray()).map((e) => e.teaser).sort()).toEqual(['Before the pause', 'Sealed while he was away', 'Written while paused'])
    expect((await him.db.envelopes.toArray()).map((e) => e.teaser).sort()).toEqual(['Before the pause', 'Sealed while he was away', 'Written while paused'])
  })

  it('logs the partner out everywhere', async () => {
    const { her, him } = await makeCouple(cloud)
    const hisId = (await him.store.memberId()) as string
    const tablet = makePhone(cloud)
    await tablet.adopt(await tablet.backend.signInWithPin('Leo', HIS_PIN))

    expect(await her.backend.signOutMember(hisId)).toBe(2)
    await him.engine.sync()
    expect(him.engine.status.state).toBe('locked-out')
    // His PIN still works: logged out is not paused.
    await expect(makePhone(cloud).backend.signInWithPin('Leo', HIS_PIN)).resolves.toBeTruthy()
  })

  it('lets a partner with a forgotten PIN back in: new PIN, old devices out, lock lifted', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-11-10T12:00:00Z'))
    const { her, him } = await makeCouple(cloud)
    const hisId = (await him.store.memberId()) as string
    const newPhone = makePhone(cloud)
    for (let i = 0; i < 5; i++) await newPhone.backend.signInWithPin('Leo', '864209').catch(() => undefined)
    await expect(newPhone.backend.signInWithPin('Leo', HIS_PIN)).rejects.toMatchObject({ code: 'pin_locked' })

    const invite = await her.backend.createInvite('restore', hisId)
    expect(await newPhone.backend.peekInvite(invite.code)).toMatchObject({ kind: 'restore', profile: { name: 'Leo' }, host: { name: 'Mia' } })
    await expect(newPhone.backend.joinHousehold(invite.code, { name: '' }, '12')).rejects.toMatchObject({ code: 'pin_invalid' })
    await newPhone.adopt(await newPhone.backend.joinHousehold(invite.code, { name: 'ignored' }, '864209'))

    // The code works once.
    await expect(makePhone(cloud).backend.joinHousehold(invite.code, { name: '' }, '864209')).rejects.toMatchObject({ code: 'invite_invalid' })
    // The old PIN is gone, the new one works straight away, and the old phone is logged out.
    await expect(makePhone(cloud).backend.signInWithPin('Leo', HIS_PIN)).rejects.toMatchObject({ code: 'pin_wrong' })
    await expect(makePhone(cloud).backend.signInWithPin('Leo', '864209')).resolves.toMatchObject({ memberId: hisId })
    expect(await him.backend.membership()).toBeNull()
  })

  it('has a master key for the owner when both are locked out', async () => {
    const { her } = await makeCouple(cloud)
    const herId = (await her.store.memberId()) as string
    const code = cloud.rescueCode('mia')
    const fresh = makePhone(cloud)
    await expect(fresh.backend.joinHousehold(code, { name: '' }, '864209')).resolves.toMatchObject({ memberId: herId, kind: 'restore' })
    expect(() => cloud.rescueCode('Nobody')).toThrowError('member_not_found')
  })
})

describe('switching people on one device', () => {
  it("does not carry one person's unsent work into the other person's session", async () => {
    const { him } = await makeCouple(cloud)
    const hisId = (await him.store.memberId()) as string
    await him.envelope({ teaser: 'His, not sent yet' })
    await him.store.patch('members', hisId, { status: 'Mine' })
    expect(await him.db.outbox.count()).toBe(2)

    // He logs out, she logs in on his phone.
    await him.backend.signOutDevice()
    await him.backend.signOut()
    await him.adopt(await him.backend.signInWithPin('Mia', HER_PIN))
    expect(await him.db.outbox.count()).toBe(0)
    await him.engine.sync()
    expect(him.engine.status.state).toBe('idle')
    expect(await him.db.envelopes.count()).toBe(0)
    expect((await him.db.members.toArray()).map((m) => m.name).sort()).toEqual(['Leo', 'Mia'])
  })

  it('keeps unsent work when the same person logs in again', async () => {
    const { him } = await makeCouple(cloud)
    await him.envelope({ teaser: 'Not sent yet' })
    await him.backend.signOutDevice()
    await him.backend.signOut()
    await him.engine.sync()
    expect(him.engine.status.state).toBe('locked-out')

    await him.adopt(await him.backend.signInWithPin('Leo', HIS_PIN))
    expect(await him.db.outbox.count()).toBe(1)
  })
})
