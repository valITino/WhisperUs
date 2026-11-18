// The phone's own copy of everything: an IndexedDB database (through Dexie).
// Screens read from here, so they open instantly and work offline.

import Dexie, { type Table } from 'dexie'
import type { DiaryKind, Envelope, Household, ID, Idea, ISO, Layer, LayerKey, Leaning, Media, Member, Note, Sealed, SyncTable, Wish } from './types'

/** A change waiting to reach the cloud. Sent strictly in seq order. */
export interface OutboxOp {
  seq?: number
  table: SyncTable
  rowId: ID
  kind: 'put' | 'patch'
  data: Record<string, unknown>
  createdAt: ISO
  attempts: number
  lastError?: string
}

/** A change the cloud refused three times. Kept so nothing vanishes silently. */
export interface DeadLetter extends OutboxOp {
  failedAt: ISO
}

/** The sealed bytes of a media row. pending = 1 means "still needs uploading". */
export interface BlobEntry {
  id: ID
  data: Blob | null
  pending: 0 | 1
  attempts: number
}

/**
 * What this phone keeps to itself about a layer it sealed: the key, and the sealed layer.
 * Never synced. A layer that is held back exists only here until its author opens it.
 */
export interface VaultEntry {
  /** "<envelopeId>:<layer>" */
  id: string
  envelopeId: ID
  layer: Layer
  /** The layer's AES-256 key, base64. */
  key: string
  sealed: Sealed
  /** True while the layer has not left this phone. */
  held: boolean
}

/**
 * What a person noted about themselves, whole: a check-in, an answer to a question
 * about themselves, what they said to an item of the list. Never synced. The parts
 * named in `shared` are also in a row of `notes` or `leanings`, with the same id.
 */
export interface DiaryEntry {
  id: ID
  kind: DiaryKind
  /** checkin: "2026-11-17.am". about: the question's id. leaning: the item's id. */
  ref: string
  /** When it was noted. */
  at: ISO
  body: Record<string, unknown>
  /** The parts of the body the other one may see. */
  shared: string[]
  updatedAt: ISO
}

export interface MetaEntry {
  key: string
  value: unknown
}

export const vaultId = (envelopeId: ID, layer: Layer): string => `${envelopeId}:${layer}`

export class AppDB extends Dexie {
  households!: Table<Household, ID>
  members!: Table<Member, ID>
  envelopes!: Table<Envelope, ID>
  keys!: Table<LayerKey, ID>
  media!: Table<Media, ID>
  notes!: Table<Note, ID>
  leanings!: Table<Leaning, ID>
  ideas!: Table<Idea, ID>
  wishes!: Table<Wish, ID>
  blobs!: Table<BlobEntry, ID>
  vault!: Table<VaultEntry, string>
  diary!: Table<DiaryEntry, ID>
  outbox!: Table<OutboxOp, number>
  deadLetters!: Table<DeadLetter, number>
  meta!: Table<MetaEntry, string>

  constructor(name = 'whisperus') {
    super(name)
    this.version(1).stores({
      households: 'id',
      members: 'id, householdId',
      envelopes: 'id, householdId, authorId, createdAt',
      keys: 'id, householdId, envelopeId',
      media: 'id, householdId, envelopeId',
      blobs: 'id, pending',
      vault: 'id, envelopeId',
      outbox: '++seq, [table+rowId]',
      deadLetters: '++seq',
      meta: 'key',
    })
    // What a person notes about themselves, wishes and the list.
    this.version(2).stores({
      notes: 'id, householdId, memberId',
      leanings: 'id, householdId, memberId, item',
      ideas: 'id, householdId',
      wishes: 'id, householdId, authorId',
      diary: 'id, kind, [kind+ref]',
    })
  }

  /** The Dexie table for a synced table name. */
  rows(table: SyncTable): Table<Record<string, unknown> & { id: ID }, ID> {
    return this.table(table)
  }

  async getMeta<T>(key: string): Promise<T | undefined> {
    return (await this.meta.get(key))?.value as T | undefined
  }

  async setMeta(key: string, value: unknown): Promise<void> {
    await this.meta.put({ key, value })
  }
}

export const META = {
  /** ISO timestamp: only rows changed after this are pulled. */
  cursor: 'sync.cursor',
  householdId: 'me.householdId',
  memberId: 'me.memberId',
  lastSyncAt: 'sync.lastSyncAt',
  lastError: 'sync.lastError',
  /** Wish answers I have looked at: { wishId: answeredAt }. About this screen, not about the two of us. */
  answersSeen: 'wishes.answersSeen',
  /** Wishes for me that I have opened: { wishId: true }. */
  wishesSeen: 'wishes.seen',
  /** Items of the list I have seen as "in common". */
  matchesSeen: 'list.matchesSeen',
  /** The last time the first look at myself was finished or put off. */
  helloDone: 'hello.done',
  /** Until which of the other one's changes I have looked at what they showed about themselves. */
  aboutSeen: 'profile.aboutSeen',
  /** Until which of the other one's items I have looked at what they wrote onto the list. */
  ideasSeen: 'list.ideasSeen',
} as const
