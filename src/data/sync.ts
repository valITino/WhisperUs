// The sync engine. One pass does four things, in this order:
//   1. send queued changes (the outbox), oldest first
//   2. upload sealed files (voice notes) that are still only on this phone
//   3. pull whatever changed in the room since the last pass
//   4. fetch sealed files the partner added, and clear away what was taken back or burned
// It never blocks the app: if the cloud is unreachable the pass ends quietly and the
// next trigger (reconnect, app focus, a change from the partner, a timer) tries again.

import { BackendError, isBackendError, mediaPath, type Backend } from './backend'
import { META, type AppDB } from './db'
import type { Store } from './store'
import { LATER_TABLES, nowIso, SYNC_TABLES, type ID, type ISO, type SyncTable } from './types'

/**
 * locked-out: this device is no longer logged in. paused: the admin has paused the profile;
 * the engine keeps asking and carries on by itself once it is switched on again.
 */
export type SyncState = 'idle' | 'syncing' | 'offline' | 'error' | 'locked-out' | 'paused'

export interface SyncStatus {
  state: SyncState
  /** Changes waiting to be sent. */
  pending: number
  /** Sealed files waiting to be uploaded. */
  uploads: number
  /** Changes the cloud refused. Shown in Settings so nothing disappears silently. */
  stuck: number
  /** Changes to a table this cloud does not have yet. They wait on the phone until it does. */
  later: number
  lastSyncAt: ISO | null
  lastError: string | null
}

export interface SyncOptions {
  /** Safety-net interval between passes while the app is open. */
  intervalMs?: number
}

/** Each pull re-reads this much history, so a row committed "late" is never missed. */
const OVERLAP_MS = 30_000
const MAX_ATTEMPTS = 3
/** A file the cloud refused this often waits until somebody taps "Try again". */
export const MAX_UPLOAD_ATTEMPTS = 5
const MISSING_RETRY_MS = 5 * 60_000

export class SyncEngine {
  status: SyncStatus = { state: 'idle', pending: 0, uploads: 0, stuck: 0, later: 0, lastSyncAt: null, lastError: null }

  /** True when this phone must never talk to the cloud (tests of single screens). */
  disabled = false

  private listeners = new Set<(s: SyncStatus) => void>()
  private current: Promise<void> | null = null
  private again = false
  private kickTimer: ReturnType<typeof setTimeout> | null = null
  private interval: ReturnType<typeof setInterval> | null = null
  private unsubscribe: (() => void) | null = null
  private detach: (() => void) | null = null
  private missingBlobs = new Map<ID, number>()
  /** Wakes the engine at the moment the next timed envelope opens. */
  private dueTimer: ReturnType<typeof setTimeout> | null = null
  /** Whether the cloud has confirmed, since the app opened, that this phone still has its seat. */
  private seatConfirmed = false
  /** Tables this cloud does not have yet (found out by asking). Their changes wait in the outbox. */
  private readonly notYet = new Set<SyncTable>()
  private readonly opts: Required<SyncOptions>

  constructor(
    readonly db: AppDB,
    readonly backend: Backend,
    readonly store: Store,
    opts: SyncOptions = {},
  ) {
    this.opts = { intervalMs: 60_000, ...opts }
    // A local change shows up as "waiting" at once, then a pass is scheduled.
    // The timer matters: a write can happen inside a larger database transaction, and
    // counting must wait until that has finished.
    this.store.onWrite = () => {
      setTimeout(() => void this.refreshCounts(), 0)
      this.kick()
    }
  }

  onStatus(fn: (s: SyncStatus) => void): () => void {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  /** Begin syncing in the background. Call once the phone is paired. */
  async start(): Promise<void> {
    this.stop()
    if (this.disabled) return
    this.seatConfirmed = false
    const householdId = await this.db.getMeta<ID>(META.householdId)
    if (!householdId) return
    // Starting fresh also clears a lock-out: the phone has just been paired (again).
    this.status = { ...this.status, state: 'idle', lastError: null, lastSyncAt: (await this.db.getMeta<ISO>(META.lastSyncAt)) ?? null }
    this.unsubscribe = this.backend.subscribe(householdId, () => this.kick(150))
    this.interval = setInterval(() => this.kick(), this.opts.intervalMs)

    if (typeof window !== 'undefined') {
      const wake = () => {
        if (document.visibilityState !== 'hidden') this.kick()
      }
      window.addEventListener('online', wake)
      window.addEventListener('focus', wake)
      document.addEventListener('visibilitychange', wake)
      this.detach = () => {
        window.removeEventListener('online', wake)
        window.removeEventListener('focus', wake)
        document.removeEventListener('visibilitychange', wake)
      }
    }
    this.kick(0)
  }

  stop(): void {
    this.unsubscribe?.()
    this.unsubscribe = null
    this.detach?.()
    this.detach = null
    if (this.interval) clearInterval(this.interval)
    if (this.kickTimer) clearTimeout(this.kickTimer)
    if (this.dueTimer) clearTimeout(this.dueTimer)
    this.interval = null
    this.kickTimer = null
    this.dueTimer = null
  }

  /** Ask for a pass soon. Many kicks in a row become one pass. */
  kick(delayMs = 30): void {
    if (this.disabled) return
    if (this.kickTimer) clearTimeout(this.kickTimer)
    this.kickTimer = setTimeout(() => {
      this.kickTimer = null
      void this.sync()
    }, delayMs)
  }

  /** Run a pass now. Resolves once it, and any pass requested meanwhile, has finished. */
  sync(): Promise<void> {
    if (this.disabled) return Promise.resolve()
    if (this.current) {
      this.again = true
      return this.current
    }
    this.current = this.loop().finally(() => {
      this.current = null
    })
    return this.current
  }

  private async loop(): Promise<void> {
    do {
      this.again = false
      await this.pass()
    } while (this.again)
  }

  private async pass(): Promise<void> {
    const householdId = await this.db.getMeta<ID>(META.householdId)
    if (!householdId || this.status.state === 'locked-out') return
    // A paused seat stays "paused" while it asks again, so its screen does not flicker.
    if (this.status.state !== 'paused') this.setStatus({ state: 'syncing' })
    try {
      // Ask the cloud whether this device still has its seat: once after opening the app,
      // and before every pass that has something to send. A device that was logged out or
      // paused must keep its changes instead of sending them into the void.
      if (!this.seatConfirmed || this.status.state === 'paused' || (await this.db.outbox.count()) > 0) await this.confirmSeat()
      await this.pushOutbox()
      if (await this.uploadBlobs(householdId)) await this.pushOutbox()
      await this.pull()
      await this.tidy()
      await this.downloadBlobs(householdId)
      await this.watchDue()
      const at = nowIso()
      await this.db.setMeta(META.lastSyncAt, at)
      this.setStatus({ state: 'idle', lastSyncAt: at, lastError: null })
    } catch (e) {
      if (isLockedOut(e)) {
        this.setStatus({ state: 'locked-out', lastError: null })
      } else if (e instanceof Paused) {
        this.setStatus({ state: 'paused', lastError: null })
      } else if (isBackendError(e) && e.kind === 'network') {
        this.setStatus({ state: 'offline', lastError: null })
      } else {
        const message = e instanceof Error ? e.message : String(e)
        await this.db.setMeta(META.lastError, { message, at: nowIso() })
        this.setStatus({ state: 'error', lastError: message })
      }
    } finally {
      await this.refreshCounts()
    }
  }

  private async confirmSeat(): Promise<void> {
    this.seatConfirmed = false
    const seat = await this.backend.membership()
    if (seat === null) throw new LockedOut()
    if (seat.paused) throw new Paused()
    this.seatConfirmed = true
  }

  // ---------------------------------------------------------------- 1. push --

  private async pushOutbox(): Promise<void> {
    let membershipChecked = false
    for (;;) {
      const op = await this.db.outbox
        .orderBy('seq')
        .filter((waiting) => !this.notYet.has(waiting.table))
        .first()
      if (!op) return
      const seq = op.seq as number
      this.store.inFlightSeq = seq
      try {
        await this.backend.push({ table: op.table, kind: op.kind, id: op.rowId, data: op.data })
        await this.db.outbox.delete(seq)
      } catch (e) {
        // The cloud does not have this table yet (the room's owner has not applied its
        // migration). Nothing is wrong with the change: it waits here, and everything
        // else goes on. Asked again the next time the app starts.
        if (isBackendError(e) && e.code === 'table_missing') {
          this.notYet.add(op.table)
          continue
        }
        if (!isBackendError(e) || e.kind !== 'rejected') throw e

        // A refusal can mean this phone was unpaired. Never throw data away in that case.
        if (!membershipChecked) {
          membershipChecked = true
          await this.confirmSeat()
        }

        const attempts = op.attempts + 1
        if (attempts < MAX_ATTEMPTS) {
          await this.db.outbox.update(seq, { attempts, lastError: e.message })
          continue
        }
        await this.db.transaction('rw', this.db.outbox, this.db.deadLetters, this.db.meta, async () => {
          const { seq: _seq, ...rest } = op
          await this.db.deadLetters.add({ ...rest, attempts, lastError: e.message, failedAt: nowIso() })
          await this.db.outbox.delete(seq)
          // Start the next pull from scratch so the phone falls back in line with the cloud.
          await this.db.meta.delete(META.cursor)
        })
      } finally {
        this.store.inFlightSeq = null
      }
    }
  }

  // -------------------------------------------------------- 2. upload files --

  private async uploadBlobs(householdId: ID): Promise<boolean> {
    const waiting = await this.db.blobs.where('pending').equals(1).toArray()
    let uploadedAny = false
    for (const entry of waiting) {
      if (entry.attempts >= MAX_UPLOAD_ATTEMPTS) continue
      try {
        if (entry.data) await this.backend.uploadBlob(mediaPath(householdId, entry.id), entry.data)
      } catch (e) {
        if (isBackendError(e) && e.kind === 'rejected') {
          await this.db.blobs.update(entry.id, { attempts: entry.attempts + 1 })
          continue
        }
        throw e
      }
      await this.db.blobs.update(entry.id, { pending: 0, attempts: 0 })
      if (await this.db.media.get(entry.id)) {
        await this.store.patch('media', entry.id, { uploaded: true })
      }
      uploadedAny = true
    }
    return uploadedAny
  }

  // ---------------------------------------------------------------- 3. pull --

  private async pull(): Promise<void> {
    const since = (await this.db.getMeta<ISO>(META.cursor)) ?? null
    const result = await this.backend.pull(since)
    // An idle device learns here that it was logged out or paused from somewhere else.
    if (result.seat === 'gone') throw new LockedOut()
    if (result.seat === 'paused') throw new Paused()
    // A table this cloud did not know before and hands out now: its waiting changes can go.
    for (const table of LATER_TABLES) if (result.tables[table] !== undefined) this.notYet.delete(table)

    const tables = SYNC_TABLES.map((t) => this.db.table(t))
    await this.db.transaction('rw', [...tables, this.db.outbox, this.db.meta], async () => {
      for (const table of SYNC_TABLES) {
        for (const row of result.tables[table] ?? []) {
          const id = row.id as ID
          // Changes made on this phone that the cloud has not seen yet win over what
          // just arrived; they are re-applied on top of the fresh row.
          const unsent = await this.db.outbox.where('[table+rowId]').equals([table, id]).sortBy('seq')
          if (unsent.some((op) => op.kind === 'put')) continue
          let merged = row
          for (const op of unsent) merged = { ...merged, ...op.data }
          await this.db.rows(table).put(merged as never)
        }
      }
      const cursor = new Date(Date.parse(result.serverTime) - OVERLAP_MS).toISOString()
      await this.db.setMeta(META.cursor, cursor)
    })
  }

  // ------------------------------------------------- 4. tidy, fetch, wake --

  /**
   * An envelope that was taken back leaves nothing behind on this phone: not its keys, not
   * its sealed layers, not its sound, not the line on its outside, not the answer. The same for a layer that was burned after its one
   * opening: a key of the other one's that fits no sealed layer any more is thrown away.
   */
  private async tidy(): Promise<void> {
    const me = await this.db.getMeta<ID>(META.memberId)
    const envelopes = new Map((await this.db.envelopes.toArray()).map((e) => [e.id, e]))
    const gone = [...envelopes.values()].filter((e) => e.deletedAt).map((e) => e.id)
    // The shell that stays says nothing: no line from the outside, no answer, no sealed layer.
    const telling = [...envelopes.values()].filter((e) => e.deletedAt && (e.teaser !== null || e.heatOutside !== null || e.reply !== null || Object.keys(e.layers).length > 0)).map((e) => e.id)
    // A burned sound goes from the phone of the one it was for. Its author keeps theirs,
    // unless the whole envelope was taken back.
    const dead = (await this.db.media.filter((m) => gone.includes(m.envelopeId) || (Boolean(m.deletedAt) && m.authorId !== me)).primaryKeys()) as ID[]
    const stale = (await this.db.keys.toArray())
      .filter((k) => {
        const envelope = envelopes.get(k.envelopeId)
        if (!envelope || envelope.deletedAt) return true
        return k.authorId !== me && envelope.layers[k.layer] == null
      })
      .map((k) => k.id)
    if (gone.length === 0 && dead.length === 0 && stale.length === 0) return
    await this.db.transaction('rw', this.db.vault, this.db.blobs, this.db.keys, this.db.envelopes, async () => {
      for (const id of telling) await this.db.envelopes.update(id, { teaser: null, heatOutside: null, reply: null, layers: {} })
      if (gone.length > 0) await this.db.vault.where('envelopeId').anyOf(gone).delete()
      if (dead.length > 0) await this.db.blobs.bulkDelete(dead)
      if (stale.length > 0) await this.db.keys.bulkDelete(stale)
    })
  }

  /** Sealed files are fetched as soon as they are in the cloud, so an opening works at once, online or not. */
  private async downloadBlobs(householdId: ID): Promise<void> {
    const media = await this.db.media.filter((m) => m.uploaded && !m.deletedAt).toArray()
    if (!media.length) return
    const have = await this.db.blobs.bulkGet(media.map((m) => m.id))
    const now = Date.now()
    for (let i = 0; i < media.length; i++) {
      if (have[i]?.data) continue
      const id = media[i].id
      const lastMiss = this.missingBlobs.get(id)
      if (lastMiss && now - lastMiss < MISSING_RETRY_MS) continue
      const data = await this.backend.downloadBlob(mediaPath(householdId, id))
      if (!data) {
        this.missingBlobs.set(id, now)
        continue
      }
      await this.db.blobs.put({ id, data, pending: 0, attempts: 0 })
    }
  }

  /**
   * The cloud hands out a key from its opening time on, and says nothing at that moment.
   * So this phone sets an alarm for the next envelope that is promised to it.
   */
  private async watchDue(): Promise<void> {
    if (this.dueTimer) clearTimeout(this.dueTimer)
    this.dueTimer = null
    const me = await this.db.getMeta<ID>(META.memberId)
    const now = Date.now()
    const soonest = (await this.db.envelopes.toArray())
      .filter((e) => !e.deletedAt && e.authorId !== me && e.opensAt !== null && Date.parse(e.opensAt) > now)
      .map((e) => Date.parse(e.opensAt as ISO))
      .sort((a, b) => a - b)[0]
    if (soonest === undefined) return
    // Timers longer than about 24 days overflow; the minute timer catches anything that far out.
    const wait = soonest - now + 800
    if (wait < 2 ** 31 - 1) this.dueTimer = setTimeout(() => this.kick(0), wait)
  }

  // --------------------------------------------------------- refused changes --
  //
  // A change the cloud said no to three times is set aside in `deadLetters`, and the
  // device then falls back in line with the cloud. Nothing is thrown away until a person
  // says so: these two are the only ways out of that list.

  /**
   * Send a refused change once more. A refused new row goes out as it is on this device
   * now, later edits included. A refused edit is applied to the row again and sent.
   */
  async retryRefused(seq: number): Promise<void> {
    const letter = await this.db.deadLetters.get(seq)
    if (!letter) return
    const rows = this.db.rows(letter.table)
    await this.db.transaction('rw', rows, this.db.outbox, this.db.deadLetters, async () => {
      if (!(await this.db.deadLetters.get(seq))) return
      const current = await rows.get(letter.rowId)
      let data = letter.data
      if (letter.kind === 'put') {
        data = { ...(current ?? letter.data) }
        if (!current) await rows.put(data as never)
      } else if (current) {
        await rows.put({ ...current, ...letter.data })
      }
      await this.db.outbox.add({ table: letter.table, rowId: letter.rowId, kind: letter.kind, data, createdAt: nowIso(), attempts: 0 })
      await this.db.deadLetters.delete(seq)
    })
    await this.refreshCounts()
    this.kick(0)
  }

  /**
   * Give up on a refused change. A refused edit simply goes: the row already shows what
   * the cloud has. A refused new row never reached the cloud, so it leaves this device as
   * well; that needs a connection, because only the cloud knows whether the row arrived
   * some other way after all. Rejects with a network error when the cloud cannot be asked.
   */
  async discardRefused(seq: number): Promise<void> {
    const letter = await this.db.deadLetters.get(seq)
    if (!letter) return
    let inCloud = true
    if (letter.kind === 'put') {
      const everything = await this.backend.pull(null)
      if (everything.seat !== 'ok') throw new BackendError('auth', 'not_in_room')
      inCloud = (everything.tables[letter.table] ?? []).some((row) => row.id === letter.rowId)
    }
    const rows = this.db.rows(letter.table)
    await this.db.transaction('rw', rows, this.db.outbox, this.db.deadLetters, this.db.blobs, async () => {
      if (!inCloud) {
        // Later edits to a row the cloud does not have would go nowhere: they leave with it.
        await this.db.outbox.where('[table+rowId]').equals([letter.table, letter.rowId]).delete()
        await rows.delete(letter.rowId)
        if (letter.table === 'media') await this.db.blobs.delete(letter.rowId)
      }
      await this.db.deadLetters.delete(seq)
    })
    await this.refreshCounts()
    this.kick()
  }

  /** Files the cloud refused five times stop being sent. This gives each of them a fresh start. */
  async retryUploads(): Promise<void> {
    await this.db.blobs
      .where('pending')
      .equals(1)
      .modify((entry) => {
        entry.attempts = 0
      })
    this.kick(0)
  }

  // ------------------------------------------------------------------ status --

  private async refreshCounts(): Promise<void> {
    if (this.disabled) return this.setStatus({ pending: 0, uploads: 0, stuck: 0, later: 0 })
    const [waiting, uploads, stuck] = await Promise.all([
      this.db.outbox.toArray(),
      this.db.blobs.where('pending').equals(1).count(),
      this.db.deadLetters.count(),
    ])
    const later = waiting.filter((op) => this.notYet.has(op.table)).length
    this.setStatus({ pending: waiting.length - later, uploads, stuck, later })
  }

  private setStatus(patch: Partial<SyncStatus>): void {
    this.status = { ...this.status, ...patch }
    for (const fn of this.listeners) fn(this.status)
  }
}

class LockedOut extends Error {
  constructor() {
    super('locked_out')
  }
}

class Paused extends Error {
  constructor() {
    super('paused')
  }
}

const isLockedOut = (e: unknown): e is LockedOut => e instanceof LockedOut
