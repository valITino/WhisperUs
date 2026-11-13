// The phone's own copy of everything: an IndexedDB database (through Dexie).
// Screens read from here, so they open instantly and work offline.

import Dexie, { type Table } from 'dexie'
import type { Envelope, Household, ID, ISO, Layer, LayerKey, Media, Member, Sealed, SyncTable } from './types'

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
  blobs!: Table<BlobEntry, ID>
  vault!: Table<VaultEntry, string>
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
} as const
