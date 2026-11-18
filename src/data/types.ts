// The shared vocabulary of WhisperUs. Every part of the app imports from here.
// Rows are camelCase in the app and snake_case in Postgres (see case.ts).

export type ID = string
/** ISO 8601 timestamp, always UTC. */
export type ISO = string

export type Score5 = 1 | 2 | 3 | 4 | 5
/** How hot something is, from "a warm glow" (1) to "on fire" (5). */
export type Heat = Score5

/** Columns every synced row carries. updatedAt is the server's clock once synced. */
export interface SyncRow {
  id: ID
  householdId: ID
  createdAt: ISO
  updatedAt: ISO
  deletedAt: ISO | null
}

/** Shared settings of the room. Nothing lives here yet. */
export type HouseholdSettings = Record<string, never>

/** The room: the private place the two of you share. */
export interface Household {
  id: ID
  name: string
  settings: HouseholdSettings
  createdAt: ISO
  updatedAt: ISO
  deletedAt: ISO | null
}

/**
 * A person's own settings. They live on the profile, so they follow the person to every
 * phone and tablet they log in on.
 */
export interface MemberPrefs {
  theme?: 'auto' | 'light' | 'dark'
  lang?: 'en' | 'de'
  /** The hottest card or question the app may ever show this person. */
  heatMax?: Heat
  /** When this person wants to be asked how they are. Off until they switch it on. */
  checkin?: CheckinTimes
  /** When they finished the first look at themselves after signing up, or put it off. */
  firstLook?: ISO
}

/** Two moments a day, on the room's clock (Europe/Zurich), as "08:30". */
export interface CheckinTimes {
  /** Whether a notification reminds them at those times. */
  remind: boolean
  times: [string, string]
}

export const DEFAULT_CHECKIN_TIMES: CheckinTimes = { remind: false, times: ['08:30', '21:00'] }

export interface Member extends SyncRow {
  name: string
  /** Which sign the avatar shows, for example "moon" or "key". */
  avatar: string
  /** The colour of the avatar's disc. */
  color: string
  /** Something the avatar wears, for example "bow". */
  accessory: string | null
  /** A short line the partner sees. At most 60 characters. */
  status: string | null
  prefs: MemberPrefs
  /** The person who opened the room. Invites, pauses and lets the partner back in. */
  isAdmin: boolean
  /** Set while the admin has paused this profile: no log-in, no reading, no writing. */
  disabledAt: ISO | null
}

// ------------------------------------------------------------------ the why --

/**
 * The reason behind a choice or a rating. Every place where somebody chooses or rates can
 * carry one: this is what the two of you work from, step by step.
 */
export interface Why {
  /** Reasons picked from the app's list, by their id (src/features/why/library.ts). */
  chips: string[]
  /** Reasons in the person's own words. */
  own: string[]
  /** A sentence or two more, if they want. */
  note: string | null
}

export const NO_WHY: Why = { chips: [], own: [], note: null }

// -------------------------------------------------------------- the envelope --

/**
 * What an envelope can hold. Each layer is sealed with its own key and opens by itself:
 * how it felt tonight, the words tomorrow, the voice whenever she is ready.
 */
export type Layer = 'feel' | 'words' | 'voice'
export const LAYERS: readonly Layer[] = ['feel', 'words', 'voice']

/** now: opens as it is sealed. at: opens at a time the author picks. hand: opens when the author taps "Open". */
export type OpenMode = 'now' | 'at' | 'hand'
/** What the author hopes for in return. It takes the guessing out of answering. */
export type Wants = 'listen' | 'react' | 'talk'
/** keep: stays readable. once: the other one gets one opening, then it is gone for them. */
export type Keep = 'keep' | 'once'
export type EnvelopeKind = 'confession'

/** One sealed layer as it travels and rests in the cloud: unreadable without its key. */
export interface Sealed {
  /** AES-GCM nonce, base64. */
  iv: string
  /** The encrypted layer, base64. */
  box: string
}

/** What "how it felt" holds once it is open. */
export interface FeelBody {
  heat: Heat | null
  /** How it was to say it: 1 took all my courage … 5 came easy. */
  ease: Score5 | null
  why: Why
}

export interface WordsBody {
  text: string
}

/** The details of a voice note. The sound itself is a file in `media`, sealed with the same key. */
export interface VoiceBody {
  mediaId: ID
  mime: string
  seconds: number
  /** AES-GCM nonce of the sound file, base64. */
  iv: string
}

export interface LayerBodies {
  feel: FeelBody
  words: WordsBody
  voice: VoiceBody
}

/** The other one's answer to an opened envelope. Never sealed: reassurance should not wait. */
export interface Reply {
  /** Quick answers, by id (src/features/envelope/replies.ts). */
  taps: string[]
  /** What it did to me. */
  heat: Heat | null
  why: Why
  at: ISO
}

/**
 * Something one of you sealed for the other. The outside (this row) is readable by both
 * at once. The inside is in `layers`, sealed; the keys travel separately (`keys`).
 */
export interface Envelope extends SyncRow {
  authorId: ID
  kind: EnvelopeKind
  /** A line written on the outside, readable while it is sealed. */
  teaser: string | null
  /** How hot the author says it is, if they want that on the outside. */
  heatOutside: Heat | null
  wants: Wants
  keep: Keep
  openMode: OpenMode
  /** openMode "at": the promised moment. */
  opensAt: ISO | null
  /**
   * The sealed layers that have left the author's phone. A layer the author holds back is
   * not here at all: it stays on their phone until they open it by hand.
   */
  layers: Partial<Record<Layer, Sealed>>
  /** When the other one first opened each layer. Only they can write this. */
  seen: Partial<Record<Layer, ISO>>
  /** Only the other one can write this. */
  reply: Reply | null
}

/**
 * The key to one layer of one envelope. The cloud hands it to the other person only from
 * `opensAt` on, never earlier. The author sees their own keys always.
 */
export interface LayerKey extends SyncRow {
  envelopeId: ID
  authorId: ID
  layer: Layer
  /** The layer's AES-256 key, base64. Empty once the layer is burned. */
  key: string
  opensAt: ISO
}

/** A sealed file: today the sound of a voice note. The bytes live in cloud storage. */
export interface Media extends SyncRow {
  envelopeId: ID
  authorId: ID
  kind: 'voice'
  bytes: number
  /** True once the sealed bytes are in cloud storage and the partner can fetch them. */
  uploaded: boolean
}

// --------------------------------------------- what I note about myself --
//
// A check-in, an answer to one of the questions about myself, what I said to an item on
// the list: the whole of it stays on the phone it was noted on (the local `diary`).
// What its author chooses to show travels as a row of `notes` or `leanings`, and nothing
// else of it ever does.

/** How often something crossed my mind: 0 not at all … 4 all the time. */
export type Often = 0 | 1 | 2 | 3 | 4

/** How I am right now. Every part can be left out, and each part is shown by itself. */
export interface CheckinBody {
  /** 1 drained … 5 wide awake */
  energy?: Score5
  /** 1 heavy … 5 light */
  mood?: Score5
  /** How close I feel to the other one: 1 far away … 5 very close */
  close?: Score5
  /** How open I am for closeness: 1 slow today, please … 5 come closer */
  open?: Score5
  /** 1 quiet … 5 on fire */
  desire?: Score5
  /** 1 not at all … 5 very */
  kinky?: Score5
  /** How often sex crossed my mind since the last check-in. */
  thoughts?: Often
  /** What was on my mind: items of the list, by id. */
  fantasies?: string[]
  /** What there was since the last check-in, by id (src/features/checkin/library.ts). */
  happened?: string[]
  why?: Why
}

export type CheckinPart = keyof CheckinBody
export const CHECKIN_PARTS: readonly CheckinPart[] = ['energy', 'mood', 'close', 'open', 'desire', 'kinky', 'thoughts', 'fantasies', 'happened', 'why']
/** The parts of a check-in that are a step on a scale of five. */
export const CHECKIN_SCALES = ['energy', 'mood', 'close', 'open', 'desire', 'kinky'] as const
export type CheckinScale = (typeof CHECKIN_SCALES)[number]

/** The first or the second check-in of a day. The day turns at four in the morning. */
export type Half = 'am' | 'pm'

/** An answer to one of the questions about myself (src/features/about/library.ts). */
export interface AboutBody {
  value?: Score5
  why?: Why
}
export type AboutPart = keyof AboutBody

/** yes: I would like that.  maybe: I am curious.  dream: only in my head.  no: not for me. */
export type Lean = 'yes' | 'maybe' | 'dream' | 'no'
/** What can meet the other one's answer. A "no" never does. */
export type OpenLean = Exclude<Lean, 'no'>

/** What I said to one item of the list. */
export interface LeaningBody {
  lean: Lean
  /** How strong the pull is. */
  pull?: Score5
  why?: Why
  /** Kept to myself: it does not leave this phone and can meet nothing. */
  quiet?: boolean
}

export type NoteKind = 'checkin' | 'about'
export type DiaryKind = NoteKind | 'leaning'

/**
 * Something a person noted about themselves and chose to show. `body` holds only the
 * parts they opened; an empty body means nothing is shown (any more).
 */
export interface Note extends SyncRow {
  memberId: ID
  kind: NoteKind
  /** checkin: the day and its half, "2026-11-17.am". about: the question's id. */
  ref: string
  /** When it was noted. */
  at: ISO
  body: Record<string, unknown>
}

/**
 * "I would like that", "I am curious" or "only in my head" to one item of the list. The
 * other one's phone receives this row only once they have answered that item with one
 * of the three as well. A "not for me" has no row at all: it never leaves the phone it
 * was tapped on. Neither does anything kept quiet.
 */
export interface Leaning extends SyncRow {
  memberId: ID
  /** An item of the app's list ("soft.massage") or the id of something the two of them wrote. */
  item: string
  lean: OpenLean
  pull: Score5 | null
  /** Only once its author shows it. */
  why: Why | null
}

/** An item one of the two wrote onto the list, in their own words. */
export interface Idea extends SyncRow {
  authorId: ID
  label: string
  /** The group of the list it stands in (src/features/list/library.ts). */
  section: string
}

/** yes: I am in.  later: not now, ask me again.  talk: let us talk first.  no: not for me. */
export type Decision = 'yes' | 'later' | 'talk' | 'no'
/** do: I would like us to do this.  dream: a fantasy that may stay one; I want you to know it. */
export type WishMode = 'do' | 'dream'

/** The other one's answer to a wish. Always with room for a why. */
export interface WishAnswer {
  /** Null for a wish that asks for no decision ("dream") when none was given. */
  decision: Decision | null
  /** Warm lines to go with it, by id (src/features/wishes/library.ts). */
  taps: string[]
  /** What it does to me. */
  heat: Heat | null
  why: Why
  at: ISO
}

/**
 * Something one of you wishes for and says so. The other one reads it at once and
 * answers; nothing about it is sealed.
 */
export interface Wish extends SyncRow {
  authorId: ID
  /** The wish, in its author's words. */
  text: string
  /** The item of the list it belongs to, if any. */
  item: string | null
  mode: WishMode
  /** How much I want it: 1 a passing thought … 5 I long for it. */
  want: Score5 | null
  why: Why
  /** Only the other one can write this. */
  answer: WishAnswer | null
}

export interface TableRows {
  households: Household
  members: Member
  envelopes: Envelope
  keys: LayerKey
  media: Media
  notes: Note
  leanings: Leaning
  ideas: Idea
  wishes: Wish
}

export type SyncTable = keyof TableRows

/** Order matters: parents before children, so a first sync never trips a foreign key. */
export const SYNC_TABLES: readonly SyncTable[] = ['households', 'members', 'envelopes', 'keys', 'media', 'notes', 'leanings', 'ideas', 'wishes']

/** Tables the app may create rows in. Rooms and members are made by pairing only. */
export const WRITABLE_TABLES: readonly SyncTable[] = ['envelopes', 'keys', 'media', 'notes', 'leanings', 'ideas', 'wishes']

/**
 * Tables that came with a later migration (0004). A cloud that has not been updated yet
 * does not know them: changes to them wait on the phone instead of being refused.
 */
export const LATER_TABLES: readonly SyncTable[] = ['notes', 'leanings', 'ideas', 'wishes']

export const newId = (): ID => crypto.randomUUID()
export const nowIso = (): ISO => new Date().toISOString()

/**
 * An id that is the same on every device for the same thing: my check-in of this
 * morning, my answer to this question, what I said to this item. So two of my devices
 * can never make two rows of it.
 */
export async function stableId(...parts: string[]): Promise<ID> {
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(parts.join('\u0000'))))
  const bytes = hash.slice(0, 16)
  // Marked as a name-based id (version 5, RFC 4122 variant), so it reads as a proper UUID.
  bytes[6] = (bytes[6] & 0x0f) | 0x50
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}
