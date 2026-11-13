// Every change the app makes goes through here: it lands in the phone's own database
// at once (so the screen updates instantly, online or not) and is queued in the outbox
// for the cloud.

import type { AppDB, OutboxOp } from './db'
import { META } from './db'
import { nowIso, WRITABLE_TABLES, type ID, type SyncTable, type TableRows } from './types'

type Patchable = SyncTable

export class Store {
  /** Called after every local write. The sync engine hooks in here. */
  onWrite: () => void = () => {}
  /** seq of the outbox entry being sent right now. It must not be merged into. */
  inFlightSeq: number | null = null
  private readonly localListeners = new Set<(table: SyncTable) => void>()

  /**
   * Hear about every change made on this phone (never about what a sync brings in),
   * with the table it was made to. Returns a function that stops listening.
   */
  onLocal(listener: (table: SyncTable) => void): () => void {
    this.localListeners.add(listener)
    return () => this.localListeners.delete(listener)
  }

  private wrote(table: SyncTable): void {
    this.onWrite()
    for (const listener of this.localListeners) listener(table)
  }

  /**
   * @param localOnly The demo room: changes stay on this phone and are never queued for the cloud.
   */
  constructor(
    readonly db: AppDB,
    readonly localOnly = false,
  ) {}

  async householdId(): Promise<ID | undefined> {
    return this.db.getMeta<ID>(META.householdId)
  }

  async memberId(): Promise<ID | undefined> {
    return this.db.getMeta<ID>(META.memberId)
  }

  /** Add a new row. */
  async put<T extends SyncTable>(table: T, row: TableRows[T]): Promise<void> {
    if (!WRITABLE_TABLES.includes(table)) throw new Error(`Rows in "${table}" are created by pairing, not by the app.`)
    await this.db.transaction('rw', this.db.table(table), this.db.outbox, async () => {
      await this.db.rows(table).put(row as never)
      await this.enqueue({ table, rowId: row.id, kind: 'put', data: { ...row } })
    })
    this.wrote(table)
  }

  /** Change some fields of an existing row. Only the changed fields travel to the cloud. */
  async patch<T extends Patchable>(table: T, id: ID, changes: Partial<TableRows[T]>): Promise<void> {
    await this.patchAll(table, [{ id, changes }])
  }

  /**
   * Change several rows of one table in a single step. The screen sees all of them at
   * once or none of them, never a half-done state in between (a list being renumbered
   * would otherwise shuffle on screen while its rows are saved one by one).
   */
  async patchAll<T extends Patchable>(table: T, patches: { id: ID; changes: Partial<TableRows[T]> }[]): Promise<void> {
    const wanted = patches
      .map(({ id, changes }) => {
        const clean = stripUndefined(changes as Record<string, unknown>)
        delete clean.id
        delete clean.householdId
        delete clean.createdAt
        delete clean.updatedAt
        return { id, clean }
      })
      .filter(({ clean }) => Object.keys(clean).length > 0)
    if (wanted.length === 0) return
    if (table === 'members') {
      const me = await this.memberId()
      if (wanted.some(({ id }) => id !== me)) throw new Error('You can only edit your own profile.')
    }

    await this.db.transaction('rw', this.db.table(table), this.db.outbox, async () => {
      for (const { id, clean } of wanted) {
        const current = await this.db.rows(table).get(id)
        if (!current) throw new Error(`Cannot change a missing row: ${table}/${id}`)
        await this.db.rows(table).put({ ...current, ...clean, updatedAt: nowIso() })
        await this.enqueue({ table, rowId: id, kind: 'patch', data: clean })
      }
    })
    this.wrote(table)
  }

  /** Soft delete: the row stays in the database so the removal can sync. */
  async remove(table: Exclude<SyncTable, 'households' | 'members'>, id: ID): Promise<void> {
    await this.patch(table, id, { deletedAt: nowIso() } as never)
  }

  private async enqueue(op: Pick<OutboxOp, 'table' | 'rowId' | 'kind' | 'data'>): Promise<void> {
    if (this.localOnly) return
    // Rapid edits to the same row (typing, dragging) collapse into one entry. Only the
    // very last entry in the queue may absorb a change, which keeps cause before effect.
    const last = await this.db.outbox.orderBy('seq').last()
    if (
      last &&
      last.seq !== this.inFlightSeq &&
      last.table === op.table &&
      last.rowId === op.rowId &&
      (op.kind === 'patch' || last.kind === 'put')
    ) {
      const data = op.kind === 'put' ? op.data : { ...last.data, ...op.data }
      await this.db.outbox.update(last.seq!, { data, kind: last.kind === 'put' ? 'put' : op.kind })
      return
    }
    await this.db.outbox.add({ ...op, createdAt: nowIso(), attempts: 0 })
  }
}

function stripUndefined(obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(obj)) if (v !== undefined) out[k] = v
  return out
}
