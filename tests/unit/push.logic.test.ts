import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { PUSH_TYPES as APP_TYPES } from '../../src/data/backend'
import {
  audience,
  checkinDue,
  envelopeEvent,
  keyEvent,
  langOf,
  MATCH_QUIET_MS,
  matchEvent,
  parseEvent,
  plan,
  PUSH_TYPES,
  roomDay,
  routeFor,
  SAME_OPENING_MS,
  whenWords,
  wishEvent,
  words,
  worthTelling,
  type Device,
  type EnvelopeChange,
  type Outside,
  type Person,
  type PushEvent,
  type PushType,
  type Room,
  type WishOutside,
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
const WISH = '7c9e6679-7425-40de-944b-e07fc1f90ae7'
/** The three kinds that are about an envelope. */
const ENVELOPE_TYPES = ['sealed', 'opened', 'answered'] as const
/** News about Mia's wish, about the list, and the reminder. */
const wishNews = (type: 'wished' | 'decided', actorId = MIA): PushEvent => ({ type, householdId: H, actorId, wishId: WISH })
const plainNews = (type: 'matched' | 'checkin', actorId = MIA): PushEvent => ({ type, householdId: H, actorId })
/** Mia's wish, said a minute ago, not answered yet. */
const wish = (changes: Partial<WishOutside> = {}): WishOutside => ({ deleted: false, authorId: MIA, createdAt: ago(MINUTE), answeredAt: null, ...changes })
const room = (changes: Partial<Room> = {}): Room => ({ people: [mia, leo], devices: [device(MIA, 'mia-phone'), device(LEO, 'leo-phone')], envelope: sealed(), ...changes })

describe('the list of kinds', () => {
  it('is the same in the app and in the cloud', () => {
    expect([...PUSH_TYPES]).toEqual([...APP_TYPES])
  })

  it('is the same in the database: its checks know exactly these, and its triggers send no other', () => {
    const first = readFileSync(join(__dirname, '../../supabase/migrations/0003_push.sql'), 'utf8')
    const later = readFileSync(join(__dirname, '../../supabase/migrations/0004_closer.sql'), 'utf8')
    const listsIn = (sql: string) => [...sql.matchAll(/array\['sealed'[^\]]*\]/g)].map(([list]) => [...list.matchAll(/'(\w+)'/g)].map(([, kind]) => kind))
    // The first migration knew the three kinds about envelopes. The later one replaces both lists with all of them.
    expect(listsIn(first).length).toBeGreaterThanOrEqual(2)
    for (const list of listsIn(first)) expect(list).toEqual([...ENVELOPE_TYPES])
    expect(listsIn(later).length).toBeGreaterThanOrEqual(2)
    for (const list of listsIn(later)) expect(list).toEqual([...PUSH_TYPES])
    // Everything the triggers and the minute jobs can hand to the function.
    const sent = new Set([...[...first.matchAll(/perform private\.send_push\('(\w+)'/g)], ...[...later.matchAll(/perform private\.send_news\(jsonb_build_object\('type', '(\w+)'/g)]].map(([, kind]) => kind))
    expect([...sent].sort()).toEqual([...PUSH_TYPES].sort())
  })

  it('the later kinds are sent in a shape the function can read too', () => {
    const later = readFileSync(join(__dirname, '../../supabase/migrations/0004_closer.sql'), 'utf8')
    // jsonb_build_object('type', 'wished', 'household_id', new.household_id, …): every other argument is a name.
    const built = [...later.matchAll(/perform private\.send_news\(jsonb_build_object\(([^)]*)\)\)/g)].map(([, args]) =>
      args
        .split(',')
        .map((part) => part.trim())
        .filter((_, index) => index % 2 === 0)
        .map((name) => name.replaceAll("'", '')),
    )
    expect(built.length).toBe(4)
    for (const names of built) {
      const body: Record<string, string> = { type: names.includes('wish_id') ? 'wished' : 'matched', household_id: H, actor_id: MIA, wish_id: WISH }
      expect(names.every((name) => name in body), names.join(',')).toBe(true)
      expect(parseEvent(Object.fromEntries(names.map((name) => [name, body[name]])))).not.toBeNull()
    }
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
    for (const type of ENVELOPE_TYPES) {
      expect(worthTelling(event(type), null, NOW)).toBe(false)
      expect(worthTelling(event(type), opened({ deleted: true, repliedAt: ago(1000) }), NOW)).toBe(false)
    }
  })

  it('a wish is told while it waits, its answer while it is fresh, and neither once it was taken back', () => {
    expect(worthTelling(wishNews('wished'), null, NOW, wish())).toBe(true)
    expect(worthTelling(wishNews('decided', LEO), null, NOW, wish({ answeredAt: ago(1000) }))).toBe(true)
    // Answered meanwhile: "a wish for you" would be old news.
    expect(worthTelling(wishNews('wished'), null, NOW, wish({ answeredAt: ago(1000) }))).toBe(false)
    expect(worthTelling(wishNews('wished'), null, NOW, wish({ createdAt: ago(49 * HOUR) }))).toBe(false)
    expect(worthTelling(wishNews('decided', LEO), null, NOW, wish({ answeredAt: ago(49 * HOUR) }))).toBe(false)
    // Nobody is told about their own doing.
    expect(worthTelling(wishNews('wished', LEO), null, NOW, wish())).toBe(false)
    expect(worthTelling(wishNews('decided', MIA), null, NOW, wish({ answeredAt: ago(1000) }))).toBe(false)
    for (const type of ['wished', 'decided'] as const) {
      expect(worthTelling(wishNews(type, type === 'wished' ? MIA : LEO), null, NOW, null)).toBe(false)
      expect(worthTelling(wishNews(type, type === 'wished' ? MIA : LEO), null, NOW, wish({ deleted: true, answeredAt: ago(1000) }))).toBe(false)
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
          // A reminder to check in is for oneself: it names nobody.
          if (type === 'checkin') expect(body, body).not.toContain('Mia')
          else expect(body, body).toContain('Mia')
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
    for (const hint of ['hot', 'heiss', 'secret', 'geheim', 'confess', 'beicht', 'fantas', 'sex', 'naught', 'dirty', 'voice', 'stimme', 'whisper', 'flüster', 'kink', 'lust', 'desire', 'mood', 'stimmung', 'yes', 'no ', 'nein', 'match']) expect(all).not.toContain(hint)
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

describe('wishes, the list and the reminder', () => {
  it('a new wish is news, and so is its answer; rewording either is not', () => {
    expect(wishEvent(null, { deleted: false, decision: null })).toBe('wished')
    expect(wishEvent({ deleted: false, decision: null }, { deleted: false, decision: null })).toBeNull()
    expect(wishEvent({ deleted: false, decision: null }, { deleted: false, decision: 'later' })).toBe('decided')
    // The same decision with other words around it.
    expect(wishEvent({ deleted: false, decision: 'later' }, { deleted: false, decision: 'later' })).toBeNull()
    // A "not now" that becomes a "yes".
    expect(wishEvent({ deleted: false, decision: 'later' }, { deleted: false, decision: 'yes' })).toBe('decided')
    // An answer without a decision, to a fantasy that may stay one, is an answer.
    expect(wishEvent({ deleted: false, decision: null }, { deleted: false, decision: '' })).toBe('decided')
    expect(wishEvent({ deleted: false, decision: 'yes' }, { deleted: true, decision: null })).toBeNull()
    expect(wishEvent(null, { deleted: true, decision: null })).toBeNull()
  })

  it('something in common is told when an answer becomes open and meets one, and not twenty times in a row', () => {
    const now = NOW.getTime()
    expect(matchEvent(true, true, null, now)).toBe('matched')
    expect(matchEvent(true, false, null, now)).toBeNull()
    // Changing the strength of an answer that was open already is no news.
    expect(matchEvent(false, true, null, now)).toBeNull()
    expect(matchEvent(true, true, now - MATCH_QUIET_MS + 1, now)).toBeNull()
    expect(matchEvent(true, true, now - MATCH_QUIET_MS, now)).toBe('matched')
  })

  it('a reminder is due at the two minutes somebody chose, on the room\'s clock, and only if they switched it on', () => {
    const at = new Date('2026-11-17T20:00:30Z') // 21:00 in Zurich
    const prefs = { checkin: { remind: true, times: ['08:30', '21:00'] } }
    expect(checkinDue(prefs, at)).toBe(true)
    expect(checkinDue(prefs, new Date('2026-11-17T07:30:00Z'))).toBe(true)
    expect(checkinDue(prefs, new Date('2026-11-17T20:01:00Z'))).toBe(false)
    // Summer: Zurich is two hours ahead.
    expect(checkinDue(prefs, new Date('2026-07-01T19:00:00Z'))).toBe(true)
    expect(checkinDue({ checkin: { remind: false, times: ['08:30', '21:00'] } }, at)).toBe(false)
    for (const odd of [null, undefined, {}, { checkin: 'soon' }, { checkin: { remind: true } }, { checkin: { remind: 'yes', times: ['21:00'] } }, { checkin: { remind: true, times: '21:00' } }]) expect(checkinDue(odd, at)).toBe(false)
    // Only two moments a day, whatever else was slipped into the list.
    expect(checkinDue({ checkin: { remind: true, times: ['08:30', '12:00', '21:00'] } }, at)).toBe(false)
  })

  it('reads the events of the later kinds, and refuses one that names no wish', () => {
    expect(parseEvent({ type: 'wished', household_id: H, actor_id: MIA, wish_id: WISH })).toEqual(wishNews('wished'))
    expect(parseEvent({ type: 'decided', household_id: H, actor_id: LEO, wish_id: WISH })).toEqual(wishNews('decided', LEO))
    expect(parseEvent({ type: 'wished', household_id: H, actor_id: MIA })).toBeNull()
    expect(parseEvent({ type: 'wished', household_id: H, actor_id: MIA, envelope_id: ENVELOPE })).toBeNull()
    expect(parseEvent({ type: 'matched', household_id: H, actor_id: LEO, item: 'soft.massage' })).toEqual(plainNews('matched', LEO))
    expect(parseEvent({ type: 'checkin', household_id: H, actor_id: MIA })).toEqual(plainNews('checkin'))
    expect(parseEvent({ type: 'sealed', household_id: H, actor_id: MIA })).toBeNull()
  })

  it('a wish reaches the other one and opens the wish; the words say who, never what', () => {
    const out = plan(wishNews('wished'), room({ envelope: null, wish: wish() }), NOW)
    expect(out).toEqual([
      {
        device: device(LEO, 'leo-phone'),
        message: { type: 'wished', title: 'A wish for you', body: 'Mia has a wish for you.', tag: `wish-${WISH}`, url: `/wishes/${WISH}` },
        urgency: 'normal',
        topic: WISH.replaceAll('-', ''),
        ttl: 48 * 3600,
      },
    ])
    const answered = plan(wishNews('decided', LEO), room({ envelope: null, wish: wish({ answeredAt: ago(1000) }) }), NOW)
    expect(answered.map((d) => [d.device.memberId, d.message.body, d.message.url])).toEqual([[MIA, 'Leo answered your wish.', `/wishes/${WISH}`]])
    expect(plan(wishNews('wished'), room({ envelope: null, wish: null }), NOW)).toEqual([])
  })

  it('something in common is told to the other one and leads to the list', () => {
    const out = plan(plainNews('matched', LEO), room({ envelope: null }), NOW)
    expect(out.map((d) => [d.device.memberId, d.message.title, d.message.body, d.message.tag, d.message.url, d.topic])).toEqual([[MIA, 'Something in common', 'You and Leo have something new in common.', 'list', '/list', 'list']])
  })

  it('the reminder goes to the one who asked for it, on their devices only, and does not wait for hours', () => {
    const devices = [device(MIA, 'mia-phone'), device(MIA, 'mia-tablet', ['checkin']), device(LEO, 'leo-phone')]
    expect(audience(plainNews('checkin'), [mia, leo], devices).map((a) => a.device.endpoint)).toEqual(['https://push.example.test/mia-phone'])
    const out = plan(plainNews('checkin'), room({ envelope: null, devices }), NOW)
    expect(out).toEqual([
      {
        device: device(MIA, 'mia-phone'),
        message: { type: 'checkin', title: 'A moment for you', body: 'How are you right now?', tag: 'checkin', url: '/checkin' },
        urgency: 'normal',
        topic: 'checkin',
        ttl: 3 * 3600,
      },
    ])
    expect(plan(plainNews('checkin'), room({ envelope: null, people: [{ ...mia, paused: true }, leo], devices }), NOW)).toEqual([])
    const german = plan(plainNews('checkin'), room({ envelope: null, people: [{ ...mia, lang: 'de' }, leo], devices }), NOW)
    expect(german[0].message).toMatchObject({ title: 'Ein Moment für dich', body: 'Wie geht es dir gerade?' })
  })
})
