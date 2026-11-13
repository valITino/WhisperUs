import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { answer, markSeen, openLayers, sealEnvelope, takeBack, type Draft } from '../../src/data/actions'
import { PUSH_TYPES, type PushSubscriptionInput } from '../../src/data/backend'
import { FakeCloud, TEST_PUSH_KEY } from '../../src/data/fake/cloudCore'
import { PushControl, type DeviceSubscription, type Permission, type PushDevice, type PushMemory } from '../../src/data/push'
import { NO_WHY, type ID, type Layer } from '../../src/data/types'
import { HIS_PIN, makeCouple, makePhone, type Phone } from './helpers'

// Notifications from end to end against the pretend cloud: a device signs up, the other
// person does something, and the cloud "sends" what the real one would hand to the
// browser's push service. Two phones, one room: Mia tells, Leo listens.
//
// The key a browser signs up with comes from the cloud, never from the build.

const KEY = TEST_PUSH_KEY
/** What the function would make after the owner threw the first pair away. */
const NEXT_KEY = 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM'

/** A browser's push side, as far as the app can see it. */
class FakeDevice implements PushDevice {
  can = true
  state: Permission = 'default'
  /** What the person will answer when the browser asks. */
  answer: Permission = 'granted'
  asked = 0
  held: DeviceSubscription | null = null
  failSubscribe = false
  private made = 0

  constructor(private readonly name: string) {}

  supported = () => this.can
  permission = () => this.state
  async askPermission() {
    this.asked += 1
    this.state = this.answer
    return this.state
  }
  /** The key the held subscription was made with. */
  madeWith = KEY
  async current(vapidPublicKey: string) {
    return this.held && this.madeWith === vapidPublicKey ? this.held : null
  }
  async subscribe(vapidPublicKey: string) {
    if (this.state !== 'granted') throw new Error('permission was never given')
    if (this.failSubscribe || !vapidPublicKey) throw new Error('push service said no')
    if (this.held && this.madeWith !== vapidPublicKey) this.held = null
    this.held ??= { endpoint: `https://push.example.test/${this.name}/${++this.made}`, p256dh: `key-of-${this.name}`, auth: 'secret' }
    this.madeWith = vapidPublicKey
    return this.held
  }
  async unsubscribe() {
    this.held = null
  }
}

function memory(): PushMemory & { data: Map<string, string> } {
  const data = new Map<string, string>()
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v), removeItem: (k) => void data.delete(k) }
}

let cloud: FakeCloud
let her: Phone
let him: Phone
let herId: string
let hisId: string

beforeEach(async () => {
  cloud = new FakeCloud()
  ;({ her, him } = await makeCouple(cloud))
  herId = (await her.store.memberId()) as string
  hisId = (await him.store.memberId()) as string
})
afterEach(() => {
  vi.useRealTimers()
})

function notifications(phone: Phone, name: string) {
  const device = new FakeDevice(name)
  const notes = memory()
  const control = new PushControl(device, phone.backend, notes, `${name} browser`)
  return { device, notes, control }
}

const sub = (name: string, mutedTypes: PushSubscriptionInput['mutedTypes'] = []): PushSubscriptionInput => ({ endpoint: `https://push.example.test/${name}`, p256dh: 'key', auth: 'secret', mutedTypes })

const WORDS = 'I keep thinking about Saturday.'
const TEASER = 'About last weekend'

const draft = (overrides: Partial<Draft> = {}): Draft => ({
  feel: { heat: 4, ease: 2, why: { chips: ['said.aroused'], own: ['greedy'], note: null } },
  words: WORDS,
  voice: null,
  teaser: TEASER,
  heatOutside: 4,
  wants: 'react',
  keep: 'keep',
  openMode: 'hand',
  opensAt: null,
  release: ['feel', 'words', 'voice'],
  ...overrides,
})

/** She seals something for him. It opens by her hand unless the test says otherwise. */
async function seal(by: Phone, overrides: Partial<Draft> = {}): Promise<ID> {
  const id = await sealEnvelope(by.kit, draft(overrides))
  await by.engine.sync()
  return id
}

/** She opens layers of it by hand. */
async function release(by: Phone, id: ID, layers: Layer[] = ['feel', 'words']): Promise<void> {
  await openLayers(by.kit, id, layers)
  await by.engine.sync()
}

/** He breaks the seal. */
async function read(by: Phone, id: ID, layers: Layer[] = ['feel', 'words']): Promise<void> {
  await by.engine.sync()
  await markSeen(by.kit, id, layers)
  await by.engine.sync()
}

const kinds = () => cloud.sentPushes().map((p) => p.message.type)
const bodies = () => cloud.sentPushes().map((p) => p.message.body)

describe('signing a device up', () => {
  it('asks for permission only after the tap, then the cloud knows where to send', async () => {
    const leo = notifications(him, 'leo-phone')
    // Nothing is known yet, and the start of the app asks nobody anything.
    expect(leo.control.current).toEqual({ status: 'unknown', muted: [] })
    await leo.control.refresh()
    expect(leo.control.current.status).toBe('unknown')
    // The Notifications page opens: the cloud says notifications are set up.
    await leo.control.refresh(true)
    expect(leo.control.current).toEqual({ status: 'off', muted: [] })
    expect(leo.device.asked).toBe(0)
    expect(cloud.pushSubscriptions()).toEqual([])

    expect(await leo.control.turnOn()).toBeNull()
    expect(leo.device.asked).toBe(1)
    expect(leo.control.current.status).toBe('on')
    expect(cloud.pushSubscriptions()).toEqual([{ endpoint: 'https://push.example.test/leo-phone/1', memberId: hisId, mutedTypes: [] }])
  })

  it('a sealed envelope then reaches him, in words that name her and nothing else, and never herself', async () => {
    const leo = notifications(him, 'leo-phone')
    const mia = notifications(her, 'mia-phone')
    await leo.control.turnOn()
    await mia.control.turnOn()

    const id = await seal(her)
    await release(her, id)

    const sent = cloud.sentPushes()
    expect(sent.map((p) => [p.memberId, p.message.type])).toEqual([
      [hisId, 'sealed'],
      // Two layers opened together are one opening.
      [hisId, 'opened'],
    ])
    expect(sent[0]).toMatchObject({
      endpoint: 'https://push.example.test/leo-phone/1',
      urgency: 'normal',
      message: { title: 'Something is waiting for you', body: 'Mia sealed something. It opens when Mia is ready.', tag: `envelope-${id}`, url: `/envelope/${id}` },
    })
    expect(sent[1]).toMatchObject({ urgency: 'high', message: { title: 'It is open', body: "Mia's envelope is open for you now.", url: `/envelope/${id}` } })
    // One envelope, one tag: the second replaces the first on his phone.
    expect(new Set(sent.map((p) => p.message.tag)).size).toBe(1)
    // A lock screen is read by anybody: nothing of the inside, nothing of the outside.
    for (const secret of [TEASER, 'weekend', 'Saturday', 'greedy', 'aroused']) expect(JSON.stringify(sent)).not.toContain(secret)
  })

  it('an envelope that opens at once says so once: there is nothing to wait for', async () => {
    await notifications(him, 'leo-phone').control.turnOn()
    await seal(her, { openMode: 'now' })
    expect(kinds()).toEqual(['opened'])
  })

  it('his answer travels back to her, once', async () => {
    const leo = notifications(him, 'leo-phone')
    const mia = notifications(her, 'mia-phone')
    await leo.control.turnOn()
    await mia.control.turnOn()
    const id = await seal(her, { openMode: 'now' })

    // Breaking the seal tells her nothing: there are no read receipts.
    await read(him, id)
    expect(kinds()).toEqual(['opened'])

    await answer(him.kit, id, { taps: ['more'], heat: 4, why: NO_WHY })
    await him.engine.sync()
    expect(cloud.sentPushes().at(-1)).toMatchObject({
      memberId: herId,
      endpoint: 'https://push.example.test/mia-phone/1',
      urgency: 'normal',
      message: { type: 'answered', title: 'An answer for you', body: 'Leo answered your envelope.', url: `/envelope/${id}` },
    })

    // Changing the answer is not news again.
    await answer(him.kit, id, { taps: ['more', 'again'], heat: 5, why: { chips: ['received.close'], own: [], note: 'thank you' } })
    await him.engine.sync()
    expect(kinds()).toEqual(['opened', 'answered'])
    expect(JSON.stringify(cloud.sentPushes())).not.toContain('thank you')
  })

  it('an envelope with a time is told twice: when it is sealed, and when its time has come', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-11-13T17:00:00Z')) // Friday, 18:00 in Zurich
    await notifications(him, 'leo-phone').control.turnOn()

    const id = await seal(her, { openMode: 'at', opensAt: '2026-11-13T21:00:00Z' })
    expect(cloud.sentPushes().map((p) => p.message.body)).toEqual(['Mia sealed something. It opens tonight at 22:00.'])

    // The minute job runs and runs, and has nothing to say before 22:00.
    vi.setSystemTime(new Date('2026-11-13T20:59:30Z'))
    cloud.tick()
    expect(kinds()).toEqual(['sealed'])

    // Nobody touches a phone at 22:00. The cloud says it by itself, once for all layers.
    vi.setSystemTime(new Date('2026-11-13T21:00:20Z'))
    cloud.tick()
    expect(cloud.sentPushes().at(-1)).toMatchObject({ memberId: hisId, urgency: 'high', message: { type: 'opened', tag: `envelope-${id}` } })
    cloud.tick()
    vi.setSystemTime(new Date('2026-11-13T21:05:00Z'))
    cloud.tick()
    expect(kinds()).toEqual(['sealed', 'opened'])
  })

  it('layers opened one after the other are each an opening, layers opened together are one', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-11-13T17:00:00Z'))
    await notifications(him, 'leo-phone').control.turnOn()
    const id = await seal(her)

    await release(her, id, ['feel'])
    expect(kinds()).toEqual(['sealed', 'opened'])
    // The words follow five minutes later: that is a new moment.
    vi.setSystemTime(new Date('2026-11-13T17:05:00Z'))
    await release(her, id, ['words'])
    expect(kinds()).toEqual(['sealed', 'opened', 'opened'])
  })

  it('what is taken back or already read is not announced', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-11-13T17:00:00Z'))
    await notifications(him, 'leo-phone').control.turnOn()

    // She seals for 22:00 and thinks better of it.
    const id = await seal(her, { openMode: 'at', opensAt: '2026-11-13T21:00:00Z' })
    await takeBack(her.kit, id)
    await her.engine.sync()
    vi.setSystemTime(new Date('2026-11-13T21:00:20Z'))
    cloud.tick()
    expect(kinds()).toEqual(['sealed'])
  })

  it('ordinary changes send nothing', async () => {
    await notifications(him, 'leo-phone').control.turnOn()
    await notifications(her, 'mia-phone').control.turnOn()
    const id = await seal(her, { openMode: 'now' })
    await read(him, id, ['feel'])
    await read(him, id, ['words'])
    await her.engine.sync()
    await him.store.patch('members', hisId, { status: 'thinking of you' })
    await him.engine.sync()
    expect(kinds()).toEqual(['opened'])
  })

  it('speaks German to a profile that reads German', async () => {
    await notifications(him, 'leo-phone').control.turnOn()
    await him.store.patch('members', hisId, { prefs: { lang: 'de' } })
    await him.engine.sync()
    const id = await seal(her)
    await release(her, id)
    expect(bodies()).toEqual(['Mia hat etwas versiegelt. Es öffnet sich, wenn Mia so weit ist.', 'Der Umschlag von Mia ist jetzt offen für dich.'])
  })
})

describe('muting', () => {
  it('a muted kind is not sent to that device; the other kinds and the other device still are', async () => {
    const phone = notifications(him, 'leo-phone')
    await phone.control.turnOn()
    const tablet = makePhone(cloud)
    await tablet.adopt(await tablet.backend.signInWithPin('Leo', HIS_PIN))
    const second = notifications(tablet, 'leo-tablet')
    await second.control.turnOn()

    expect(await phone.control.setMuted('sealed', true)).toBe(true)
    expect(phone.control.current.muted).toEqual(['sealed'])
    expect(cloud.pushSubscriptions().find((s) => s.endpoint.includes('leo-phone'))?.mutedTypes).toEqual(['sealed'])

    const id = await seal(her)
    await release(her, id)
    expect(cloud.sentPushes().map((p) => [p.endpoint.split('/')[3], p.message.type])).toEqual([
      ['leo-tablet', 'sealed'],
      ['leo-phone', 'opened'],
      ['leo-tablet', 'opened'],
    ])

    expect(await phone.control.setMuted('sealed', false)).toBe(true)
    expect(cloud.pushSubscriptions().find((s) => s.endpoint.includes('leo-phone'))?.mutedTypes).toEqual([])
  })

  it('a choice made offline is kept on the device and reaches the cloud later', async () => {
    const leo = notifications(him, 'leo-phone')
    await leo.control.turnOn()
    him.backend.online = false
    expect(await leo.control.setMuted('opened', true)).toBe(false)
    expect(leo.control.current.muted).toEqual(['opened'])
    expect(cloud.pushSubscriptions()[0].mutedTypes).toEqual([])

    him.backend.online = true
    await leo.control.refresh()
    expect(cloud.pushSubscriptions()[0].mutedTypes).toEqual(['opened'])

    // And it survives closing the app: the next start reads it from the device.
    const again = new PushControl(leo.device, him.backend, leo.notes)
    expect(again.current).toEqual({ status: 'on', muted: ['opened'] })
  })

  it('repairs a row the cloud lost instead of failing', async () => {
    const leo = notifications(him, 'leo-phone')
    await leo.control.turnOn()
    cloud.removePushSubscription('nobody', 'https://push.example.test/unknown')
    await him.backend.removePushSubscription('https://push.example.test/leo-phone/1')
    expect(cloud.pushSubscriptions()).toEqual([])

    expect(await leo.control.setMuted('sealed', true)).toBe(true)
    expect(cloud.pushSubscriptions()).toEqual([{ endpoint: 'https://push.example.test/leo-phone/1', memberId: hisId, mutedTypes: ['sealed'] }])
  })

  it('muted kinds chosen while off are sent along when notifications are turned on', async () => {
    const leo = notifications(him, 'leo-phone')
    expect(await leo.control.setMuted('answered', true)).toBe(true)
    await leo.control.turnOn()
    expect(cloud.pushSubscriptions()[0].mutedTypes).toEqual(['answered'])
  })
})

describe('when it cannot be turned on', () => {
  it('says "not set up" while the cloud has no key, and switches itself on when there is one', async () => {
    cloud.setPushPublicKey(null)
    const leo = notifications(him, 'leo-phone')
    await leo.control.refresh(true)
    expect(leo.control.current.status).toBe('unconfigured')
    expect(await leo.control.turnOn()).toBe('subscribe_failed')
    expect(leo.device.asked).toBe(0)
    expect(leo.device.held).toBeNull()

    // The owner sets notifications up. The next look at the page offers them.
    cloud.setPushPublicKey(KEY)
    await leo.control.refresh(true)
    expect(leo.control.current.status).toBe('off')
    expect(await leo.control.turnOn()).toBeNull()
    expect(leo.device.madeWith).toBe(KEY)
  })

  it('cannot tell while the cloud has never been reached, and says so instead of guessing', async () => {
    const leo = notifications(him, 'leo-phone')
    him.backend.online = false
    await leo.control.refresh(true)
    expect(leo.control.current.status).toBe('unknown')
    expect(await leo.control.turnOn()).toBe('offline')
    expect(leo.device.asked).toBe(0)

    him.backend.online = true
    expect(await leo.control.turnOn()).toBeNull()
    expect(leo.control.current.status).toBe('on')
  })

  it('remembers the key it last heard of, so an offline start still knows where it stands', async () => {
    const leo = notifications(him, 'leo-phone')
    await leo.control.refresh(true)
    him.backend.online = false
    const nextStart = new PushControl(leo.device, him.backend, leo.notes)
    expect(nextStart.current.status).toBe('off')
    await nextStart.refresh(true)
    expect(nextStart.current.status).toBe('off')
  })

  it('says so when the browser cannot do it', async () => {
    const leo = notifications(him, 'leo-phone')
    leo.device.can = false
    await leo.control.refresh()
    expect(leo.control.current.status).toBe('unsupported')
    expect(await leo.control.turnOn()).toBe('subscribe_failed')
    expect(leo.device.asked).toBe(0)
  })

  it('"Block" is remembered by the browser: no second question, and the page says how to undo it', async () => {
    const leo = notifications(him, 'leo-phone')
    leo.device.answer = 'denied'
    expect(await leo.control.turnOn()).toBe('blocked')
    expect(leo.control.current.status).toBe('blocked')
    expect(await leo.control.turnOn()).toBe('blocked')
    expect(leo.device.asked).toBe(1)
    expect(cloud.pushSubscriptions()).toEqual([])

    // Unblocked in the browser's settings: back to "off", ready for another try.
    leo.device.state = 'default'
    leo.device.answer = 'granted'
    await leo.control.refresh()
    expect(leo.control.current.status).toBe('off')
    expect(await leo.control.turnOn()).toBeNull()
  })

  it('a closed question is not a no', async () => {
    const leo = notifications(him, 'leo-phone')
    leo.device.answer = 'default'
    expect(await leo.control.turnOn()).toBe('dismissed')
    expect(leo.control.current.status).toBe('off')
  })

  it('reports a push service that will not answer', async () => {
    const leo = notifications(him, 'leo-phone')
    leo.device.failSubscribe = true
    expect(await leo.control.turnOn()).toBe('subscribe_failed')
    expect(leo.control.current.status).toBe('off')
    expect(cloud.pushSubscriptions()).toEqual([])
  })

  it('never ends up half on: if the cloud cannot be told, the browser lets go again', async () => {
    const leo = notifications(him, 'leo-phone')
    await leo.control.refresh(true)
    him.backend.online = false
    expect(await leo.control.turnOn()).toBe('offline')
    expect(leo.control.current.status).toBe('off')
    expect(leo.device.held).toBeNull()

    him.backend.online = true
    const stranger = makePhone(cloud)
    const lost = notifications(stranger, 'stranger')
    expect(await lost.control.turnOn()).toBe('refused')
    expect(lost.device.held).toBeNull()
    expect(cloud.pushSubscriptions()).toEqual([])
  })
})

describe('keeping the cloud and the browser in step', () => {
  it('tells the cloud again at every start, which brings back a row it lost', async () => {
    const leo = notifications(him, 'leo-phone')
    await leo.control.turnOn()
    await him.backend.removePushSubscription('https://push.example.test/leo-phone/1')

    const nextStart = new PushControl(leo.device, him.backend, leo.notes)
    expect(nextStart.current.status).toBe('on')
    await nextStart.refresh()
    expect(cloud.pushSubscriptions().map((s) => s.endpoint)).toEqual(['https://push.example.test/leo-phone/1'])
    expect(leo.device.asked).toBe(1)
  })

  it('signs up again quietly when the browser dropped its subscription, and retires the old address', async () => {
    const leo = notifications(him, 'leo-phone')
    await leo.control.turnOn()
    leo.device.held = null

    await leo.control.refresh()
    expect(leo.control.current.status).toBe('on')
    expect(leo.device.asked).toBe(1)
    expect(cloud.pushSubscriptions().map((s) => s.endpoint)).toEqual(['https://push.example.test/leo-phone/2'])
  })

  it('signs up again when the room got new keys: the old subscription would never ring', async () => {
    const leo = notifications(him, 'leo-phone')
    await leo.control.turnOn()
    expect(leo.device.madeWith).toBe(KEY)

    // The owner throws the keys away. Until there are new ones, nothing can be sent.
    cloud.setPushPublicKey(null)
    await leo.control.refresh()
    expect(leo.control.current.status).toBe('unconfigured')

    // The function has made a new pair. The next start of the app picks it up by itself.
    cloud.setPushPublicKey(NEXT_KEY)
    await leo.control.refresh()
    expect(leo.control.current.status).toBe('on')
    expect(leo.device.madeWith).toBe(NEXT_KEY)
    expect(leo.device.asked).toBe(1)
    expect(cloud.pushSubscriptions().map((s) => s.endpoint)).toEqual(['https://push.example.test/leo-phone/2'])
  })

  it('shows "off" when the subscription is gone and cannot be renewed', async () => {
    const leo = notifications(him, 'leo-phone')
    await leo.control.turnOn()
    leo.device.held = null
    leo.device.failSubscribe = true
    await leo.control.refresh()
    expect(leo.control.current.status).toBe('off')
  })

  it('shows "blocked" when the permission was taken away in the browser', async () => {
    const leo = notifications(him, 'leo-phone')
    await leo.control.turnOn()
    leo.device.state = 'denied'
    await leo.control.refresh()
    expect(leo.control.current.status).toBe('blocked')
  })

  it('a device that never turned notifications on asks the cloud nothing', async () => {
    // (Not even a login may be created for it: the start screen has to stay free of calls.)
    const calls: string[] = []
    const silent = {
      pushPublicKey: async () => {
        calls.push('key')
        return KEY
      },
      savePushSubscription: async () => void calls.push('save'),
      setPushMuted: async () => void calls.push('mute'),
      removePushSubscription: async () => void calls.push('remove'),
    }
    const control = new PushControl(new FakeDevice('new-phone'), silent, memory())
    await control.refresh()
    await control.setMuted('sealed', true)
    expect(calls).toEqual([])
    expect(control.current).toEqual({ status: 'unknown', muted: ['sealed'] })

    // Only opening the Notifications page asks, and then only for the key.
    await control.refresh(true)
    expect(calls).toEqual(['key'])
    expect(control.current.status).toBe('off')
  })

  it('tells whoever is listening when something changes, and only then', async () => {
    const leo = notifications(him, 'leo-phone')
    let heard = 0
    const stop = leo.control.subscribe(() => (heard += 1))
    await leo.control.refresh()
    expect(heard).toBe(0)
    await leo.control.refresh(true)
    expect(heard).toBe(1)
    await leo.control.refresh(true)
    expect(heard).toBe(1)
    await leo.control.turnOn()
    expect(heard).toBe(2)
    await leo.control.setMuted('sealed', true)
    expect(heard).toBe(3)
    stop()
    await leo.control.turnOff()
    expect(heard).toBe(3)
  })
})

describe('turning off and logging out', () => {
  it('"Turn off" removes the row and the browser lets go', async () => {
    const leo = notifications(him, 'leo-phone')
    await leo.control.turnOn()
    await leo.control.turnOff()
    expect(leo.control.current.status).toBe('off')
    expect(leo.device.held).toBeNull()
    expect(cloud.pushSubscriptions()).toEqual([])

    await release(her, await seal(her))
    expect(cloud.sentPushes()).toEqual([])
  })

  it('turning off works without a connection too', async () => {
    const leo = notifications(him, 'leo-phone')
    await leo.control.turnOn()
    him.backend.online = false
    await leo.control.turnOff()
    expect(leo.control.current.status).toBe('off')
    expect(leo.device.held).toBeNull()
  })

  it('logging a device out removes its subscription', async () => {
    const leo = notifications(him, 'leo-phone')
    await leo.control.turnOn()
    // What logOut() in app.ts does, step by step.
    await leo.control.removeFromCloud()
    expect(cloud.pushSubscriptions()).toEqual([])
    await him.backend.signOutDevice()
    await leo.control.forget()
    expect(leo.device.held).toBeNull()
    expect(leo.notes.data.size).toBe(0)
    expect(leo.control.current).toEqual({ status: 'unknown', muted: [] })
  })

  it('the cloud drops it by itself when the device is logged out from elsewhere', async () => {
    await notifications(him, 'leo-phone').control.turnOn()
    const tablet = makePhone(cloud)
    await tablet.adopt(await tablet.backend.signInWithPin('Leo', HIS_PIN))
    await notifications(tablet, 'leo-tablet').control.turnOn()
    expect(cloud.pushSubscriptions()).toHaveLength(2)

    // "Log out my other devices", from the tablet.
    await tablet.backend.signOutOtherDevices()
    expect(cloud.pushSubscriptions().map((s) => s.endpoint)).toEqual(['https://push.example.test/leo-tablet/1'])
    // The admin's "log out everywhere".
    await her.backend.signOutMember(hisId)
    expect(cloud.pushSubscriptions()).toEqual([])

    await release(her, await seal(her))
    expect(cloud.sentPushes()).toEqual([])
  })

  it('a restore code logs the old devices out, notifications included', async () => {
    await notifications(him, 'lost-phone').control.turnOn()
    const invite = await her.backend.createInvite('restore', hisId)
    const fresh = makePhone(cloud)
    await fresh.adopt(await fresh.backend.joinHousehold(invite.code, { name: 'whoever' }, '864209'))
    expect(cloud.pushSubscriptions()).toEqual([])
  })

  it('a paused profile hears nothing, and can change nothing', async () => {
    const leo = notifications(him, 'leo-phone')
    await leo.control.turnOn()
    await her.backend.setMemberPaused(hisId, true)
    const id = await seal(her)
    expect(cloud.sentPushes()).toEqual([])
    await expect(him.backend.setPushMuted('https://push.example.test/leo-phone/1', ['sealed'])).rejects.toMatchObject({ code: 'not_in_room' })

    await her.backend.setMemberPaused(hisId, false)
    await release(her, id)
    expect(bodies()).toEqual(["Mia's envelope is open for you now."])
  })
})

describe("the cloud's rules for subscriptions", () => {
  it('hands the public key to any device with a login, and null while notifications are not set up', async () => {
    expect(await him.backend.pushPublicKey()).toBe(KEY)
    expect(await makePhone(cloud).backend.pushPublicKey()).toBe(KEY)
    cloud.setPushPublicKey(null)
    expect(await him.backend.pushPublicKey()).toBeNull()
    cloud.reset()
    expect(cloud.pushPublicKey('anyone')).toBe(KEY)
  })

  it('only somebody in the room can sign a device up', async () => {
    const stranger = makePhone(cloud)
    await expect(stranger.backend.savePushSubscription(sub('stranger'))).rejects.toMatchObject({ kind: 'rejected', code: 'not_in_room' })
    await expect(stranger.backend.setPushMuted('https://push.example.test/x', [])).rejects.toMatchObject({ code: 'not_in_room' })
    expect(cloud.pushSubscriptions()).toEqual([])
  })

  it('refuses addresses and keys that cannot be real', async () => {
    for (const bad of [{ endpoint: 'http://push.example.test/plain' }, { endpoint: 'javascript:alert(1)' }, { endpoint: `https://push.example.test/${'x'.repeat(2000)}` }, { p256dh: '' }, { auth: '' }, { auth: 'x'.repeat(101) }]) {
      await expect(him.backend.savePushSubscription({ ...sub('leo'), ...bad })).rejects.toMatchObject({ code: 'push_invalid' })
    }
    expect(cloud.pushSubscriptions()).toEqual([])
  })

  it('keeps only kinds that exist, each once, in the usual order', async () => {
    await him.backend.savePushSubscription({ ...sub('leo'), mutedTypes: ['opened', 'nonsense', 'sealed', 'opened'] as never })
    expect(cloud.pushSubscriptions()[0].mutedTypes).toEqual(['sealed', 'opened'])
    await him.backend.setPushMuted(sub('leo').endpoint, [...PUSH_TYPES].reverse())
    expect(cloud.pushSubscriptions()[0].mutedTypes).toEqual([...PUSH_TYPES])
  })

  it('one row per device: a renewed address replaces the old one', async () => {
    await him.backend.savePushSubscription(sub('leo-old'))
    await him.backend.savePushSubscription(sub('leo-new', ['opened']))
    expect(cloud.pushSubscriptions()).toEqual([{ endpoint: 'https://push.example.test/leo-new', memberId: hisId, mutedTypes: ['opened'] }])
  })

  it('one row per browser: it belongs to whoever is logged in on it now', async () => {
    await him.backend.savePushSubscription(sub('shared-browser'))
    await her.backend.savePushSubscription(sub('shared-browser'))
    expect(cloud.pushSubscriptions()).toEqual([{ endpoint: 'https://push.example.test/shared-browser', memberId: herId, mutedTypes: [] }])
  })

  it('nobody mutes or removes the partner\'s device', async () => {
    await him.backend.savePushSubscription(sub('leo'))
    await expect(her.backend.setPushMuted(sub('leo').endpoint, ['opened'])).rejects.toMatchObject({ code: 'push_missing' })
    await her.backend.removePushSubscription(sub('leo').endpoint)
    expect(cloud.pushSubscriptions()).toHaveLength(1)
    // Removing your own works, and removing what is not there is not an error.
    await him.backend.removePushSubscription(sub('leo').endpoint)
    await him.backend.removePushSubscription(sub('leo').endpoint)
    expect(cloud.pushSubscriptions()).toEqual([])
  })

  it('a reset forgets devices and what was sent', async () => {
    await him.backend.savePushSubscription(sub('leo'))
    await seal(her)
    expect(cloud.sentPushes()).toHaveLength(1)
    cloud.reset()
    expect(cloud.sentPushes()).toEqual([])
    expect(cloud.pushSubscriptions()).toEqual([])
  })
})
