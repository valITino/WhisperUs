// The thinking behind push notifications, free of Deno, the database and the network,
// so every rule can be unit-tested (tests/unit/push.logic.test.ts):
//
//   - which changes are worth an event (the triggers in the migration decide the same
//     way; the pretend cloud in src/data/fake uses these functions directly),
//   - whether an event is still true by the time it is handled,
//   - who gets told (the other person, on the devices that did not mute this kind),
//   - the words, in the language of whoever reads them.
//
// A notification shows on a lock screen, where anybody may read it. So the words never
// carry what is inside an envelope, nor what is written on its outside.
//
// This file must stay self-contained: the function is deployed from this folder alone.

export const PUSH_TYPES = ['sealed', 'opened', 'answered'] as const
/**
 * sealed: something was sealed for you and waits.   opened: something opened for you.
 * answered: the other one answered what you opened for them.
 */
export type PushType = (typeof PUSH_TYPES)[number]
export type Lang = 'en' | 'de'

export const isPushType = (value: unknown): value is PushType => PUSH_TYPES.includes(value as PushType)

// ------------------------------------------------------------------ events --

/** One thing that happened in the room. Sent by the database, read by the function. */
export interface PushEvent {
  type: PushType
  householdId: string
  /** The member who did it. They are never told about it themselves. */
  actorId: string
  /** The envelope it is about. */
  envelopeId: string
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const uuid = (value: unknown): string | null => (typeof value === 'string' && UUID.test(value) ? value.toLowerCase() : null)

/** Read what the database trigger sent. Null when it is not an event we know. */
export function parseEvent(body: unknown): PushEvent | null {
  if (typeof body !== 'object' || body === null) return null
  const raw = body as Record<string, unknown>
  const householdId = uuid(raw.household_id)
  const actorId = uuid(raw.actor_id)
  const envelopeId = uuid(raw.envelope_id)
  if (!isPushType(raw.type) || !householdId || !actorId || !envelopeId) return null
  return { type: raw.type, householdId, actorId, envelopeId }
}

// ------------------------------------------------------- which events fire --

/** An envelope as far as "is this news?" cares. */
export interface EnvelopeChange {
  openMode: string
  deleted: boolean
  hasReply: boolean
}

/**
 * What a change to an envelope is worth telling, if anything. `before` is null for a new
 * row. A new envelope that waits (for its time, or for its author's hand) is "sealed".
 * One that opens at once says nothing here: its key arriving is the news ("opened").
 * The first answer is "answered"; changing an answer afterwards is not news again.
 */
export function envelopeEvent(before: EnvelopeChange | null, after: EnvelopeChange): PushType | null {
  if (after.deleted) return null
  if (!before) return after.openMode === 'now' ? null : 'sealed'
  if (!before.hasReply && after.hasReply) return 'answered'
  return null
}

/** How close together keys of one envelope count as one opening. */
export const SAME_OPENING_MS = 10_000

/**
 * Whether a key arriving in the cloud is an opening worth telling: it opens now (not at
 * a later time), and it is not just the next layer of an opening that was told a moment ago.
 * `siblingsOpenedAt` are the opening times of the envelope's other keys, in milliseconds.
 */
export function keyEvent(opensAt: number, now: number, siblingsOpenedAt: readonly number[]): PushType | null {
  if (opensAt > now) return null
  return siblingsOpenedAt.some((other) => other <= now && now - other < SAME_OPENING_MS) ? null : 'opened'
}

// ------------------------------------------------------------ still true? --

/** An envelope as far as a notification cares. Nothing of its content, nothing of its outside. */
export interface Outside {
  deleted: boolean
  authorId: string
  openMode: string
  opensAt: string | null
  createdAt: string | null
  /** How many of its layers the reader can open right now and has not opened yet. */
  waiting: number
  /** When the newest of those opened. */
  openedAt: string | null
  repliedAt: string | null
}

const HOUR = 3_600_000
const within = (at: string | null, ms: number, now: Date): boolean => at === null || Number.isNaN(Date.parse(at)) || now.getTime() - Date.parse(at) <= ms

/**
 * Events arrive a moment after the change, sometimes much later (a phone that was offline
 * for days sends everything at once). Old news is not worth a notification.
 */
export function worthTelling(event: PushEvent, envelope: Outside | null, now: Date): boolean {
  if (!envelope || envelope.deleted) return false
  switch (event.type) {
    case 'sealed':
      // Still sealed: once something in it is open, "opened" has said so already.
      return envelope.authorId === event.actorId && envelope.waiting === 0 && within(envelope.createdAt, 48 * HOUR, now)
    case 'opened':
      return envelope.authorId === event.actorId && envelope.waiting > 0 && within(envelope.openedAt, 24 * HOUR, now)
    case 'answered':
      return envelope.authorId !== event.actorId && envelope.repliedAt !== null && within(envelope.repliedAt, 48 * HOUR, now)
  }
}

// ----------------------------------------------------------- who gets told --

export interface Person {
  id: string
  name: string
  lang: Lang
  /** The admin has paused this profile: it hears nothing. */
  paused: boolean
}

/** One device that asked for notifications. */
export interface Device {
  id: string
  memberId: string
  endpoint: string
  p256dh: string
  auth: string
  mutedTypes: readonly string[]
}

/** The language a profile reads in. English unless it says German. */
export const langOf = (prefs: unknown): Lang => ((prefs as { lang?: unknown } | null)?.lang === 'de' ? 'de' : 'en')

/** Everybody but the one who did it, on every device that did not mute this kind of news. */
export function audience(event: PushEvent, people: readonly Person[], devices: readonly Device[]): { person: Person; device: Device }[] {
  const listening = people.filter((person) => person.id !== event.actorId && !person.paused)
  const seen = new Set<string>()
  const out: { person: Person; device: Device }[] = []
  for (const device of devices) {
    const person = listening.find((p) => p.id === device.memberId)
    if (!person || device.mutedTypes.includes(event.type) || seen.has(device.endpoint)) continue
    seen.add(device.endpoint)
    out.push({ person, device })
  }
  return out
}

// --------------------------------------------------------------- the words --

const ZONE = 'Europe/Zurich'
const DAY = new Intl.DateTimeFormat('en-CA', { timeZone: ZONE, year: 'numeric', month: '2-digit', day: '2-digit' })

/** The calendar day in the room's time zone: "2026-11-13". */
export const roomDay = (at: Date): string => DAY.format(at)

/** "tonight at 22:00", "tomorrow at 08:00", "on Friday at 20:00". Empty when the time is unknown or past. */
export function whenWords(opensAt: string | null, now: Date, lang: Lang): string {
  const at = opensAt ? Date.parse(opensAt) : Number.NaN
  if (Number.isNaN(at) || at <= now.getTime()) return ''
  const then = new Date(at)
  const locale = lang === 'de' ? 'de-CH' : 'en-GB'
  const clock = new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: ZONE }).format(then)
  const hour = Number(new Intl.DateTimeFormat('en-GB', { hour: '2-digit', hour12: false, timeZone: ZONE }).format(then))
  const away = Math.round((Date.parse(`${roomDay(then)}T12:00:00Z`) - Date.parse(`${roomDay(now)}T12:00:00Z`)) / (24 * HOUR))
  const weekday = new Intl.DateTimeFormat(locale, { weekday: 'long', timeZone: ZONE }).format(then)
  const dayMonth = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'long', timeZone: ZONE }).format(then)
  if (lang === 'de') {
    const day = away === 0 ? (hour >= 18 ? 'heute Abend' : 'heute') : away === 1 ? 'morgen' : away < 7 ? `am ${weekday}` : `am ${dayMonth}`
    return `${day} um ${clock}`
  }
  const day = away === 0 ? (hour >= 18 ? 'tonight' : 'today') : away === 1 ? 'tomorrow' : away < 7 ? `on ${weekday}` : `on ${dayMonth}`
  return `${day} at ${clock}`
}

export interface Facts {
  /** Who did it. */
  actor: string
  /** sealed: from whenWords(). Empty when it opens by hand. */
  when: string
}

/** Title and body, short enough for a lock screen, and safe to be read there. No em dashes, no arrows. */
export function words(type: PushType, lang: Lang, facts: Facts): { title: string; body: string } {
  const who = facts.actor.trim() || (lang === 'de' ? 'Jemand' : 'Someone')
  if (lang === 'de') {
    switch (type) {
      case 'sealed':
        return { title: 'Etwas wartet auf dich', body: facts.when ? `${who} hat etwas versiegelt. Es öffnet sich ${facts.when}.` : `${who} hat etwas versiegelt. Es öffnet sich, wenn ${who} so weit ist.` }
      case 'opened':
        return { title: 'Es ist offen', body: `Der Umschlag von ${who} ist jetzt offen für dich.` }
      case 'answered':
        return { title: 'Eine Antwort für dich', body: `${who} hat auf deinen Umschlag geantwortet.` }
    }
  }
  switch (type) {
    case 'sealed':
      return { title: 'Something is waiting for you', body: facts.when ? `${who} sealed something. It opens ${facts.when}.` : `${who} sealed something. It opens when ${who} is ready.` }
    case 'opened':
      return { title: 'It is open', body: `${who}'s envelope is open for you now.` }
    case 'answered':
      return { title: 'An answer for you', body: `${who} answered your envelope.` }
  }
}

// ------------------------------------------------------------- the message --

/** What travels to the phone. The service worker (src/sw/notify.ts) turns it into a notification. */
export interface PushMessage {
  type: PushType
  title: string
  body: string
  /** One per envelope: a newer notification about the same envelope replaces the older one. */
  tag: string
  /** The page a tap opens, as an in-app route. */
  url: string
}

export interface Delivery {
  device: Device
  message: PushMessage
  /** "high" wakes a sleeping phone at once. An opening is a moment: it should not arrive late. */
  urgency: 'normal' | 'high'
  /** Push services keep only the newest waiting message per topic: one per envelope. */
  topic: string
  /** How long the push service keeps trying to deliver, in seconds. */
  ttl: number
}

const TTL_HOURS: Record<PushType, number> = { sealed: 48, opened: 24, answered: 48 }

/** The page a tap opens. */
export const routeFor = (envelopeId: string): string => `/envelope/${envelopeId}`

/** Everything the function looked up about the room for one event. */
export interface Room {
  people: readonly Person[]
  devices: readonly Device[]
  envelope: Outside | null
}

/**
 * From one event to the messages to send: none when the news is stale or nobody listens,
 * otherwise exactly one per device of the other person.
 */
export function plan(event: PushEvent, room: Room, now: Date): Delivery[] {
  const actor = room.people.find((person) => person.id === event.actorId)
  // An event about a room the actor does not sit in is not ours to announce.
  if (!actor) return []
  const { envelope } = room
  if (!envelope || !worthTelling(event, envelope, now)) return []

  return audience(event, room.people, room.devices).map(({ person, device }) => {
    const said = words(event.type, person.lang, {
      actor: actor.name,
      when: envelope.openMode === 'at' ? whenWords(envelope.opensAt, now, person.lang) : '',
    })
    return {
      device,
      message: { type: event.type, ...said, tag: `envelope-${event.envelopeId}`, url: routeFor(event.envelopeId) },
      urgency: event.type === 'opened' ? 'high' : 'normal',
      topic: event.envelopeId.replaceAll('-', ''),
      ttl: TTL_HOURS[event.type] * 3600,
    }
  })
}
