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
}

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

export interface TableRows {
  households: Household
  members: Member
  envelopes: Envelope
  keys: LayerKey
  media: Media
}

export type SyncTable = keyof TableRows

/** Order matters: parents before children, so a first sync never trips a foreign key. */
export const SYNC_TABLES: readonly SyncTable[] = ['households', 'members', 'envelopes', 'keys', 'media']

/** Tables the app may create rows in. Rooms and members are made by pairing only. */
export const WRITABLE_TABLES: readonly SyncTable[] = ['envelopes', 'keys', 'media']

/**
 * Tables that came with a later migration. A cloud that has not been updated yet does not
 * know them: changes to them wait on the phone instead of being refused. None so far.
 */
export const LATER_TABLES: readonly SyncTable[] = []

export const newId = (): ID => crypto.randomUUID()
export const nowIso = (): ISO => new Date().toISOString()
