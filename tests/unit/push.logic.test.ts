import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { PUSH_TYPES as APP_TYPES } from '../../src/data/backend'
import {
  audience,
  envelopeEvent,
  keyEvent,
  langOf,
  parseEvent,
  plan,
  PUSH_TYPES,
  roomDay,
  routeFor,
  SAME_OPENING_MS,
  whenWords,
  words,
  worthTelling,
  type Device,
  type EnvelopeChange,
  type Outside,
  type Person,
  type PushEvent,
  type PushType,
  type Room,
} from '../../supabase/functions/push/logic'

// The rules of push notifications: which changes are worth telling, to whom, in which
// words. The Edge Function and the pretend cloud both run exactly this code.
//
// The rule above all others: a notification is read on a lock screen, by anybody who
// picks the phone up. It says who and when. Never what.

const H = '11111111-1111-4111-8111-111111111111'
const MIA = '22222222-2222-4222-8222-222222222222'
const LEO = '33333333-3333-4333-8333-333333333333'
const ENVELOPE = '0f8fad5b-d9cb-469f-a165-70867728950e'
const NOW = new Date('2026-11-10T17:30:00Z') // Tuesday, 18:30 in Zurich
const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString()
const MINUTE = 60_000
const HOUR = 60 * MINUTE

const mia: Person = { id: MIA, name: 'Mia', lang: 'en', paused: false }
const leo: Person = { id: LEO, name: 'Leo', lang: 'en', paused: false }
const device = (memberId: string, name: string, mutedTypes: string[] = []): Device => ({ id: `id-${name}`, memberId, endpoint: `https://push.example.test/${name}`, p256dh: 'p', auth: 'a', mutedTypes })
/** Mia's envelope, sealed a minute ago, opening by her hand. Nothing in it is open yet. */
const sealed = (changes: Partial<Outside> = {}): Outside => ({ deleted: false, authorId: MIA, openMode: 'hand', opensAt: null, createdAt: ago(MINUTE), waiting: 0, openedAt: null, repliedAt: null, ...changes })
/** The same envelope with two layers open for Leo since a moment ago. */
const opened = (changes: Partial<Outside> = {}): Outside => sealed({ waiting: 2, openedAt: ago(2000), ...changes })
const event = (type: PushType, actorId = MIA): PushEvent => ({ type, householdId: H, actorId, envelopeId: ENVELOPE })
const room = (changes: Partial<Room> = {}): Room => ({ people: [mia, leo], devices: [device(MIA, 'mia-phone'), device(LEO, 'leo-phone')], envelope: sealed(), ...changes })

describe('the list of kinds', () => {
  it('is the same in the app and in the cloud', () => {
    expect([...PUSH_TYPES]).toEqual([...APP_TYPES])
  })

  it('is the same in the database: its checks know exactly these three, and its triggers send no other', () => {
    const sql = readFileSync(join(__dirname, '../../supabase/migrations/0003_push.sql'), 'utf8')
    const lists = [...sql.matchAll(/array\['sealed'[^\]]*\]/g)].map(([list]) => [...list.matchAll(/'(\w+)'/g)].map(([, kind]) => kind))
    expect(lists.length).toBeGreaterThanOrEqual(2)
    for (const list of lists) expect(list).toEqual([...PUSH_TYPES])
    // Everything the triggers and the minute job can hand to send_push.
    const sent = new Set([...sql.matchAll(/perform private\.send_push\('(\w+)'/g)].map(([, kind]) => kind))
    expect([...sent].sort()).toEqual([...PUSH_TYPES].sort())
  })

  it('the database sends an event the function can read', () => {
    const sql = readFileSync(join(__dirname, '../../supabase/migrations/0003_push.sql'), 'utf8')
    const [, built] = /body := jsonb_build_object\(([^)]*)\)/.exec(sql) as RegExpExecArray
    const fields = [...built.matchAll(/'(\w+)',/g)].map(([, name]) => name)
    expect(fields).toEqual(['type', 'household_id', 'actor_id', 'envelope_id'])
    expect(parseEvent(Object.fromEntries(fields.map((name) => [name, name === 'type' ? 'sealed' : H])))).not.toBeNull()
  })
})

describe('reading an event from the database', () => {
  const good = { type: 'sealed', household_id: H, actor_id: MIA, envelope_id: ENVELOPE }

  it('takes what the trigger sends', () => {
    expect(parseEvent(good)).toEqual({ type: 'sealed', householdId: H, actorId: MIA, envelopeId: ENVELOPE })
    expect(parseEvent({ ...good, type: 'answered', actor_id: LEO })).toEqual({ type: 'answered', householdId: H, actorId: LEO, envelopeId: ENVELOPE })
    // Upper-case ids are the same ids.
    expect(parseEvent({ ...good, envelope_id: ENVELOPE.toUpperCase() })?.envelopeId).toBe(ENVELOPE)
    // Whatever else comes along is not looked at.
    expect(parseEvent({ ...good, teaser: 'about Saturday' })).toEqual({ type: 'sealed', householdId: H, actorId: MIA, envelopeId: ENVELOPE })
  })

  it('refuses everything else', () => {
    expect(parseEvent(null)).toBeNull()
    expect(parseEvent('sealed')).toBeNull()
    expect(parseEvent([good])).toBeNull()
    expect(parseEvent({ ...good, type: 'exploded' })).toBeNull()
    expect(parseEvent({ ...good, type: 'served' })).toBeNull()
    expect(parseEvent({ ...good, actor_id: null })).toBeNull()
    expect(parseEvent({ ...good, household_id: 'not-an-id' })).toBeNull()
    expect(parseEvent({ ...good, envelope_id: undefined })).toBeNull()
    // Ids go into a database query: nothing but an id may pass.
    expect(parseEvent({ ...good, envelope_id: `${ENVELOPE}&select=*` })).toBeNull()
    expect(parseEvent({ ...good, household_id: `${H}),or=(id.neq.x` })).toBeNull()
  })
})

describe('which changes to an envelope are worth an event', () => {
  const row = (changes: Partial<EnvelopeChange> = {}): EnvelopeChange => ({ openMode: 'hand', deleted: false, hasReply: false, ...changes })

  it('a new envelope that waits is "sealed", whether for a time or for a hand', () => {
    expect(envelopeEvent(null, row())).toBe('sealed')
    expect(envelopeEvent(null, row({ openMode: 'at' }))).toBe('sealed')
  })

  it('one that opens at once says nothing here: its key arriving is the news', () => {
    expect(envelopeEvent(null, row({ openMode: 'now' }))).toBeNull()
  })

  it('the first answer is "answered"; changing it afterwards is not news again', () => {
    expect(envelopeEvent(row(), row({ hasReply: true }))).toBe('answered')
    expect(envelopeEvent(row({ hasReply: true }), row({ hasReply: true }))).toBeNull()
    expect(envelopeEvent(row({ hasReply: true }), row())).toBeNull()
  })

  it('breaking the seal is not an event: there are no read receipts', () => {
    // "seen" changes and nothing else does.
    expect(envelopeEvent(row(), row())).toBeNull()
    expect(envelopeEvent(row({ openMode: 'now' }), row({ openMode: 'now' }))).toBeNull()
  })

  it('taking an envelope back is silent, and so is anything about one that is gone', () => {
    expect(envelopeEvent(row(), row({ deleted: true }))).toBeNull()
    expect(envelopeEvent(null, row({ deleted: true }))).toBeNull()
    expect(envelopeEvent(row({ deleted: true }), row({ deleted: true, hasReply: true }))).toBeNull()
  })
})

describe('which keys arriving are an opening', () => {
  const now = NOW.getTime()

  it('a key that opens now is "opened"', () => {
    expect(keyEvent(now, now, [])).toBe('opened')
    expect(keyEvent(now - 5000, now, [])).toBe('opened')
  })

  it('a key that waits for its time is nothing yet: the minute job tells it when the time has come', () => {
    expect(keyEvent(now + 1, now, [])).toBeNull()
    expect(keyEvent(now + 4 * HOUR, now, [])).toBeNull()
  })

  it('several layers opening together are one opening', () => {
    expect(keyEvent(now, now, [now - 300])).toBeNull()
    expect(keyEvent(now, now, [now - SAME_OPENING_MS + 1])).toBeNull()
    // A layer she opens five minutes after the first is a new moment.
    expect(keyEvent(now, now, [now - SAME_OPENING_MS])).toBe('opened')
    expect(keyEvent(now, now, [now - 5 * MINUTE])).toBe('opened')
  })

  it('a sibling that has not opened yet does not swallow this one', () => {
    expect(keyEvent(now, now, [now + 2000])).toBe('opened')
    expect(keyEvent(now, now, [now + 4 * HOUR, now - 5 * MINUTE])).toBe('opened')
  })
})

describe('old news is no news', () => {
  it('tells what is still true', () => {
    expect(worthTelling(event('sealed'), sealed(), NOW)).toBe(true)
    expect(worthTelling(event('opened'), opened(), NOW)).toBe(true)
    expect(worthTelling(event('answered', LEO), opened({ waiting: 0, repliedAt: ago(1000) }), NOW)).toBe(true)
  })

  it('keeps quiet when the envelope was taken back or never existed', () => {
    for (const type of PUSH_TYPES) {
      expect(worthTelling(event(type), null, NOW)).toBe(false)
      expect(worthTelling(event(type), opened({ deleted: true, repliedAt: ago(1000) }), NOW)).toBe(false)
    }
  })

  it('"sealed" is too late once something in it is open', () => {
    expect(worthTelling(event('sealed'), opened(), NOW)).toBe(false)
  })

  it('"opened" needs something that is open and unread', () => {
    // Its time has not come, or he has read it already, or it burnt after one reading.
    expect(worthTelling(event('opened'), sealed(), NOW)).toBe(false)
    expect(worthTelling(event('opened'), opened({ waiting: 0, openedAt: null }), NOW)).toBe(false)
    expect(worthTelling(event('opened'), opened({ waiting: 1 }), NOW)).toBe(true)
  })

  it('"answered" needs an answer, from the one who did not write it', () => {
    expect(worthTelling(event('answered', LEO), opened(), NOW)).toBe(false)
    expect(worthTelling(event('answered', MIA), opened({ repliedAt: ago(1000) }), NOW)).toBe(false)
  })

  it('only the author seals and opens', () => {
    expect(worthTelling(event('sealed', LEO), sealed(), NOW)).toBe(false)
    expect(worthTelling(event('opened', LEO), opened(), NOW)).toBe(false)
  })

  it('keeps quiet about things a phone sent days late', () => {
    expect(worthTelling(event('sealed'), sealed({ createdAt: ago(47 * HOUR) }), NOW)).toBe(true)
    expect(worthTelling(event('sealed'), sealed({ createdAt: ago(49 * HOUR) }), NOW)).toBe(false)
    expect(worthTelling(event('opened'), opened({ openedAt: ago(23 * HOUR) }), NOW)).toBe(true)
    expect(worthTelling(event('opened'), opened({ openedAt: ago(25 * HOUR) }), NOW)).toBe(false)
    expect(worthTelling(event('answered', LEO), opened({ repliedAt: ago(47 * HOUR) }), NOW)).toBe(true)
    expect(worthTelling(event('answered', LEO), opened({ repliedAt: ago(49 * HOUR) }), NOW)).toBe(false)
    // A time nobody can read is not held against the news.
    expect(worthTelling(event('sealed'), sealed({ createdAt: null }), NOW)).toBe(true)
    expect(worthTelling(event('sealed'), sealed({ createdAt: 'yesterday-ish' }), NOW)).toBe(true)
  })

  it('knows which day it is in the room, not in Greenwich', () => {
    expect(roomDay(new Date('2026-11-10T22:59:00Z'))).toBe('2026-11-10')
    expect(roomDay(new Date('2026-11-10T23:00:00Z'))).toBe('2026-11-11')
    expect(roomDay(new Date('2026-07-10T21:59:00Z'))).toBe('2026-07-10')
    expect(roomDay(new Date('2026-07-10T22:00:00Z'))).toBe('2026-07-11')
  })
})

describe('who gets told', () => {
  it('the other person, on each of their devices, and never the one who did it', () => {
    const devices = [device(MIA, 'mia-phone'), device(LEO, 'leo-phone'), device(LEO, 'leo-tablet')]
    expect(audience(event('sealed'), [mia, leo], devices).map((a) => a.device.endpoint)).toEqual(['https://push.example.test/leo-phone', 'https://push.example.test/leo-tablet'])
    expect(audience(event('answered', LEO), [mia, leo], devices).map((a) => a.device.endpoint)).toEqual(['https://push.example.test/mia-phone'])
  })

  it('not a device that muted this kind, not a paused profile, not a device of nobody', () => {
    const devices = [device(LEO, 'leo-phone', ['sealed']), device(LEO, 'leo-tablet', ['opened']), device('someone-else', 'stray')]
    expect(audience(event('sealed'), [mia, leo], devices).map((a) => a.device.id)).toEqual(['id-leo-tablet'])
    expect(audience(event('opened'), [mia, leo], devices).map((a) => a.device.id)).toEqual(['id-leo-phone'])
    expect(audience(event('sealed'), [mia, { ...leo, paused: true }], devices)).toEqual([])
  })

  it('one device, one notification, even if the list names it twice', () => {
    expect(audience(event('sealed'), [mia, leo], [device(LEO, 'leo-phone'), device(LEO, 'leo-phone')])).toHaveLength(1)
  })

  it('reads the language off the profile, English unless it says German', () => {
    expect(langOf({ lang: 'de' })).toBe('de')
    expect(langOf({ lang: 'en' })).toBe('en')
    expect(langOf({ lang: 'fr' })).toBe('en')
    expect(langOf({})).toBe('en')
    expect(langOf(null)).toBe('en')
  })
})

describe('when it opens, in words', () => {
  it('says tonight, today, tomorrow, the weekday, then the date', () => {
    expect(whenWords('2026-11-10T21:00:00Z', NOW, 'en')).toBe('tonight at 22:00')
    expect(whenWords('2026-11-10T17:45:00Z', NOW, 'en')).toBe('tonight at 18:45')
    expect(whenWords('2026-11-11T07:00:00Z', NOW, 'en')).toBe('tomorrow at 08:00')
    expect(whenWords('2026-11-13T19:00:00Z', NOW, 'en')).toBe('on Friday at 20:00')
    expect(whenWords('2026-11-16T19:00:00Z', NOW, 'en')).toBe('on Monday at 20:00')
    expect(whenWords('2026-11-17T19:00:00Z', NOW, 'en')).toBe('on 17 November at 20:00')
    // Before six in the evening it is simply today.
    expect(whenWords('2026-11-11T14:00:00Z', new Date('2026-11-11T07:00:00Z'), 'en')).toBe('today at 15:00')
  })

  it('says it in German too', () => {
    expect(whenWords('2026-11-10T21:00:00Z', NOW, 'de')).toBe('heute Abend um 22:00')
    expect(whenWords('2026-11-11T07:00:00Z', NOW, 'de')).toBe('morgen um 08:00')
    expect(whenWords('2026-11-13T19:00:00Z', NOW, 'de')).toBe('am Freitag um 20:00')
    expect(whenWords('2026-11-17T19:00:00Z', NOW, 'de')).toBe('am 17. November um 20:00')
    expect(whenWords('2026-11-11T14:00:00Z', new Date('2026-11-11T07:00:00Z'), 'de')).toBe('heute um 15:00')
  })

  it('counts days in the room, not in Greenwich, and follows summer time', () => {
    // Half past midnight in Zurich is tomorrow there, although Greenwich still has today.
    expect(whenWords('2026-11-10T23:30:00Z', NOW, 'en')).toBe('tomorrow at 00:30')
    // A summer evening: 20:00 in Zurich is 18:00 in Greenwich.
    expect(whenWords('2026-07-10T18:00:00Z', new Date('2026-07-10T10:00:00Z'), 'en')).toBe('tonight at 20:00')
    // Across the night the clocks go back (25 October 2026): still the right hour.
    expect(whenWords('2026-10-25T19:00:00Z', new Date('2026-10-24T18:00:00Z'), 'en')).toBe('tomorrow at 20:00')
  })

  it('has nothing to say about a time that is past, missing or unreadable', () => {
    expect(whenWords(null, NOW, 'en')).toBe('')
    expect(whenWords('soon', NOW, 'en')).toBe('')
    expect(whenWords(ago(1000), NOW, 'de')).toBe('')
    expect(whenWords(NOW.toISOString(), NOW, 'en')).toBe('')
  })
})

describe('the words', () => {
  it('"sealed" names the person and the time, or says it is in her hands', () => {
    expect(words('sealed', 'en', { actor: 'Mia', when: 'tonight at 22:00' })).toEqual({ title: 'Something is waiting for you', body: 'Mia sealed something. It opens tonight at 22:00.' })
    expect(words('sealed', 'en', { actor: 'Mia', when: '' }).body).toBe('Mia sealed something. It opens when Mia is ready.')
    expect(words('sealed', 'de', { actor: 'Mia', when: 'heute Abend um 22:00' })).toEqual({ title: 'Etwas wartet auf dich', body: 'Mia hat etwas versiegelt. Es öffnet sich heute Abend um 22:00.' })
    expect(words('sealed', 'de', { actor: 'Mia', when: '' }).body).toBe('Mia hat etwas versiegelt. Es öffnet sich, wenn Mia so weit ist.')
  })

  it('"opened" and "answered" name the person and nothing else', () => {
    expect(words('opened', 'en', { actor: 'Mia', when: '' })).toEqual({ title: 'It is open', body: "Mia's envelope is open for you now." })
    expect(words('opened', 'de', { actor: 'Mia', when: '' })).toEqual({ title: 'Es ist offen', body: 'Der Umschlag von Mia ist jetzt offen für dich.' })
    expect(words('answered', 'en', { actor: 'Leo', when: '' })).toEqual({ title: 'An answer for you', body: 'Leo answered your envelope.' })
    expect(words('answered', 'de', { actor: 'Leo', when: '' })).toEqual({ title: 'Eine Antwort für dich', body: 'Leo hat auf deinen Umschlag geantwortet.' })
  })

  it('has something to say when the name is gone', () => {
    expect(words('sealed', 'en', { actor: ' ', when: '' }).body).toBe('Someone sealed something. It opens when Someone is ready.')
    expect(words('answered', 'de', { actor: '', when: '' }).body).toBe('Jemand hat auf deinen Umschlag geantwortet.')
  })

  it('follows the house rules in both languages: short, no em dashes, no arrows, Swiss spelling', () => {
    for (const lang of ['en', 'de'] as const) {
      for (const type of PUSH_TYPES) {
        for (const opensAt of [null, '2026-11-13T19:00:00Z', '2026-12-24T19:00:00Z']) {
          const { title, body } = words(type, lang, { actor: 'Mia', when: whenWords(opensAt, NOW, lang) })
          const all = `${title} ${body}`
          expect(all, all).not.toMatch(/[—–→·ß]/)
          expect(title.length, title).toBeLessThanOrEqual(30)
          expect(body.length, body).toBeLessThanOrEqual(120)
          expect(body, body).toContain('Mia')
          // Sentence case: no shouting, no Title Case Like This.
          expect(title, title).not.toMatch(/[A-ZÄÖÜ]{3,}/)
          expect(title, title).not.toMatch(/!/)
        }
      }
    }
  })

  it('reads the same to anybody who picks the phone up: nothing that hints at what is inside', () => {
    // No word about heat, mood or kind. A notification about a letter, and that is all.
    const all = (['en', 'de'] as const).flatMap((lang) => PUSH_TYPES.map((type) => words(type, lang, { actor: 'Mia', when: '' }))).map(({ title, body }) => `${title} ${body}`).join(' ').toLowerCase()
    for (const hint of ['hot', 'heiss', 'secret', 'geheim', 'confess', 'beicht', 'fantas', 'sex', 'naught', 'dirty', 'voice', 'stimme', 'whisper', 'flüster']) expect(all).not.toContain(hint)
  })
})

describe('from one event to the messages', () => {
  it('"sealed" reaches the other one once, opens the envelope page and can wait a moment', () => {
    const out = plan(event('sealed'), room(), NOW)
    expect(out).toEqual([
      {
        device: device(LEO, 'leo-phone'),
        message: { type: 'sealed', title: 'Something is waiting for you', body: 'Mia sealed something. It opens when Mia is ready.', tag: `envelope-${ENVELOPE}`, url: `/envelope/${ENVELOPE}` },
        urgency: 'normal',
        topic: '0f8fad5bd9cb469fa16570867728950e',
        ttl: 48 * 3600,
      },
    ])
    expect(routeFor(ENVELOPE)).toBe(`/envelope/${ENVELOPE}`)
  })

  it('names the time only when the envelope has one', () => {
    const timed = sealed({ openMode: 'at', opensAt: '2026-11-13T19:00:00Z' })
    expect(plan(event('sealed'), room({ envelope: timed }), NOW)[0].message.body).toBe('Mia sealed something. It opens on Friday at 20:00.')
    // By hand: a time left over on the row means nothing.
    expect(plan(event('sealed'), room({ envelope: sealed({ opensAt: '2026-11-13T19:00:00Z' }) }), NOW)[0].message.body).toBe('Mia sealed something. It opens when Mia is ready.')
  })

  it('an opening is a moment: it wakes the phone and does not wait around for a day', () => {
    const [delivery] = plan(event('opened'), room({ envelope: opened() }), NOW)
    expect(delivery).toMatchObject({ urgency: 'high', ttl: 24 * 3600, message: { type: 'opened', title: 'It is open', url: `/envelope/${ENVELOPE}` } })
  })

  it('the answer goes to whoever sealed it', () => {
    const out = plan(event('answered', LEO), room({ envelope: opened({ waiting: 0, repliedAt: ago(1000) }) }), NOW)
    expect(out.map((d) => [d.device.memberId, d.message.title, d.message.body, d.urgency])).toEqual([[MIA, 'An answer for you', 'Leo answered your envelope.', 'normal']])
  })

  it('every reader gets their own language, and one envelope keeps one tag', () => {
    const people = [mia, { ...leo, lang: 'de' as const }]
    const devices = [device(LEO, 'leo-phone'), device(LEO, 'leo-tablet')]
    const first = plan(event('sealed'), room({ people, devices }), NOW)
    expect(first.map((d) => d.message.body)).toEqual(['Mia hat etwas versiegelt. Es öffnet sich, wenn Mia so weit ist.', 'Mia hat etwas versiegelt. Es öffnet sich, wenn Mia so weit ist.'])
    const second = plan(event('opened'), room({ people, devices, envelope: opened() }), NOW)
    // The newer notification replaces the older one on the phone, and at the push service.
    expect(new Set([...first, ...second].map((d) => d.message.tag)).size).toBe(1)
    expect(new Set([...first, ...second].map((d) => d.topic)).size).toBe(1)
  })

  it('sends nothing when there is nothing to say or nobody to say it to', () => {
    expect(plan(event('sealed'), room({ envelope: opened() }), NOW)).toEqual([])
    expect(plan(event('sealed'), room({ envelope: null }), NOW)).toEqual([])
    expect(plan(event('sealed'), room({ devices: [device(MIA, 'mia-phone')] }), NOW)).toEqual([])
    expect(plan(event('sealed'), room({ devices: [device(LEO, 'leo-phone', ['sealed'])] }), NOW)).toEqual([])
    // Somebody who does not sit in this room cannot announce anything in it.
    expect(plan(event('sealed', '99999999-9999-4999-8999-999999999999'), room(), NOW)).toEqual([])
  })

  it('a push service takes the topic as it is: 32 characters, letters and digits', () => {
    const [delivery] = plan(event('sealed'), room(), NOW)
    expect(delivery.topic).toMatch(/^[a-z0-9]{32}$/)
  })

  it('fits into one push message with room to spare', () => {
    const [delivery] = plan(event('sealed'), room({ people: [{ ...mia, name: 'Ü'.repeat(40) }, { ...leo, lang: 'de' }], envelope: sealed({ openMode: 'at', opensAt: '2026-12-24T19:00:00Z' }) }), NOW)
    expect(new TextEncoder().encode(JSON.stringify(delivery.message)).length).toBeLessThan(1000)
  })
})
