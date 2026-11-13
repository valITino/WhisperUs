// A pretend cloud that behaves like the real database: one room, two seats, the same
// pairing rules and error codes, the same "server clock stamps every write" behaviour,
// the same guard around envelopes and the same patience with keys.
// Tests and local development run against it, because they must never touch real data.
// Keep its rules in step with supabase/migrations.

import { envelopeEvent, keyEvent, langOf, plan, type Delivery, type EnvelopeChange, type PushEvent } from '../../../supabase/functions/push/logic.ts'
import { BackendError, PUSH_TYPES, type BackendErrorDetails, type Invite, type InvitePeek, type Membership, type PersonCard, type ProfileInput, type PullResult, type PushOp, type PushSubscriptionInput, type PushType } from '../backend.ts'
import { lockMinutes, nameKey, PIN_TRIES, pinProblem } from '../pin.ts'
import { LAYERS, SYNC_TABLES, type ID, type ISO, type Layer, type SyncTable } from '../types.ts'

type Row = Record<string, unknown> & { id: ID }

interface MemberRow extends Row {
  householdId: ID
  name: string
  avatar: string
  color: string
  accessory: string | null
  status: string | null
  prefs: Record<string, unknown>
  isAdmin: boolean
  disabledAt: ISO | null
  createdAt: ISO
  updatedAt: ISO
  deletedAt: ISO | null
}

interface InviteRow {
  code: string
  householdId: ID
  kind: 'join' | 'restore'
  memberId: ID | null
  createdBy: ID
  expiresAt: number
  usedAt: number | null
}

interface Attempts {
  failed: number
  lockouts: number
  lockedUntil: number
  lastAttempt: number
}

/** One device that asked for notifications (public.push_subscriptions). */
interface PushRow {
  id: ID
  householdId: ID
  memberId: ID
  /** The login (device) that saved it. Logging that device out removes the row. */
  userId: string
  endpoint: string
  p256dh: string
  auth: string
  mutedTypes: PushType[]
  userAgent: string | null
}

/**
 * A notification the pretend cloud would have sent. The real cloud hands it to the
 * browser's push service; here tests read the list instead of a phone's lock screen.
 */
export interface SentPush extends Omit<Delivery, 'device'> {
  endpoint: string
  memberId: ID
}

/**
 * The public key the pretend cloud hands to browsers that want to sign up: the example
 * key from RFC 8292. Nothing is ever sent with it.
 */
export const TEST_PUSH_KEY = 'BA1Hxzyi1RUM1b5wjxsn7nGxAszw2u61m164i3MrAIxHF6YK5h4SDYic-dRuU_RCPCfA5aq9ojSwk5Y2EmClBPs'

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
const PROFILE_FIELDS = ['name', 'avatar', 'color', 'status', 'accessory', 'prefs']

const reject = (code: string, details?: BackendErrorDetails): never => {
  throw new BackendError('rejected', code, undefined, details)
}

const card = (m: MemberRow | undefined): PersonCard | null =>
  m ? { name: m.name, avatar: m.avatar, color: m.color, accessory: m.accessory } : null

export class FakeCloud {
  private tables = new Map<SyncTable, Map<ID, Row>>()
  private invites = new Map<string, InviteRow>()
  /** Which profile each login (one per device) belongs to. One profile can have many. */
  private devices = new Map<string, ID>()
  private pins = new Map<ID, string>()
  /** Wrong PIN tries, counted per typed name, whether or not that name exists. */
  private attempts = new Map<string, Attempts>()
  private blobs = new Map<string, { bytes: Uint8Array; type: string }>()
  /** Devices that asked for notifications, by the address of their push service. */
  private pushRows = new Map<string, PushRow>()
  private sent: SentPush[] = []
  /** private.push_config.vapid_public: null while notifications are not set up. */
  private pushKey: string | null = TEST_PUSH_KEY
  private listeners = new Set<(householdId: ID) => void>()
  private clock = 0

  constructor() {
    this.reset()
  }

  reset(): void {
    this.tables.clear()
    for (const t of SYNC_TABLES) this.tables.set(t, new Map())
    this.invites.clear()
    this.devices.clear()
    this.pins.clear()
    this.attempts.clear()
    this.blobs.clear()
    this.pushRows.clear()
    this.sent = []
    this.pushKey = TEST_PUSH_KEY
  }

  /** A strictly increasing server clock, like clock_timestamp() in Postgres. */
  private now(): ISO {
    this.clock = Math.max(this.clock + 1, Date.now())
    return new Date(this.clock).toISOString()
  }

  private id(): ID {
    return crypto.randomUUID()
  }

  private code(length: number): string {
    const bytes = crypto.getRandomValues(new Uint8Array(length))
    return Array.from(bytes, (b) => ALPHABET[b % 32]).join('')
  }

  private table(name: SyncTable): Map<ID, Row> {
    return this.tables.get(name) as Map<ID, Row>
  }

  private members(): MemberRow[] {
    return [...this.table('members').values()] as MemberRow[]
  }

  /** The profile this login belongs to, paused or not. */
  private seatOf(userId: string): MemberRow | undefined {
    const memberId = this.devices.get(userId)
    return memberId ? this.members().find((m) => m.id === memberId && !m.deletedAt) : undefined
  }

  /** The profile this login may act as: logged in and not paused. */
  private memberOf(userId: string): MemberRow | undefined {
    const seat = this.seatOf(userId)
    return seat && !seat.disabledAt ? seat : undefined
  }

  private admin(userId: string): MemberRow {
    const me = this.memberOf(userId) ?? reject('not_in_room')
    return me.isAdmin ? me : reject('admin_only')
  }

  private seats(householdId: ID): MemberRow[] {
    return this.members().filter((m) => m.householdId === householdId && !m.deletedAt)
  }

  private touch(member: MemberRow): void {
    member.updatedAt = this.now()
    this.emit(member.householdId)
  }

  private checkPin(pin: string): void {
    const problem = pinProblem(pin)
    if (problem) reject(problem)
  }

  private emit(householdId: ID): void {
    for (const fn of this.listeners) fn(householdId)
  }

  // ----------------------------------------------------------------- pairing --

  signIn(): string {
    return this.id()
  }

  membership(userId: string): Membership | null {
    const me = this.seatOf(userId)
    if (!me) return null
    return me.disabledAt ? { householdId: me.householdId, memberId: me.id, paused: true } : { householdId: me.householdId, memberId: me.id }
  }

  roomExists(_userId: string): boolean {
    return [...this.table('households').values()].some((h) => !h.deletedAt)
  }

  createHousehold(userId: string, name: string, me: ProfileInput, pin: string): Membership {
    if (this.seatOf(userId)) reject('already_in_room')
    this.checkPin(pin)
    if (this.roomExists(userId)) reject('room_already_exists')

    const at = this.now()
    const householdId = this.id()
    this.table('households').set(householdId, {
      id: householdId,
      name: name.trim() || 'Our room',
      settings: {},
      createdAt: at,
      updatedAt: at,
      deletedAt: null,
    })
    // Whoever opens the room is its admin.
    const memberId = this.addMember(householdId, { avatar: 'moon', color: 'candle', ...me }, 'One', true)
    this.pins.set(memberId, pin)
    this.devices.set(userId, memberId)
    this.emit(householdId)
    return { householdId, memberId }
  }

  private addMember(householdId: ID, me: ProfileInput, fallbackName: string, isAdmin: boolean): ID {
    const at = this.now()
    const id = this.id()
    const row: MemberRow = {
      id,
      householdId,
      name: me.name?.trim().slice(0, 40) || fallbackName,
      avatar: me.avatar ?? 'key',
      color: me.color ?? 'moss',
      accessory: me.accessory ?? null,
      status: me.status?.trim().slice(0, 60) || null,
      prefs: {},
      isAdmin,
      disabledAt: null,
      createdAt: at,
      updatedAt: at,
      deletedAt: null,
    }
    this.table('members').set(id, row)
    return id
  }

  createInvite(userId: string, kind: 'join' | 'restore', memberId?: ID): Invite {
    const me = this.admin(userId)
    if (kind === 'join') {
      if (this.seats(me.householdId).length >= 2) reject('room_full')
    } else {
      if (memberId === me.id) reject('not_yourself')
      if (!this.seats(me.householdId).some((m) => m.id === memberId)) reject('member_not_found')
    }
    const code = this.code(10)
    const expiresAt = Date.now() + 48 * 3_600_000
    this.invites.set(code, {
      code,
      householdId: me.householdId,
      kind,
      memberId: kind === 'restore' ? (memberId as ID) : null,
      createdBy: me.id,
      expiresAt,
      usedAt: null,
    })
    return { code, kind, expiresAt: new Date(expiresAt).toISOString() }
  }

  private validInvite(code: string): InviteRow {
    const invite = this.invites.get(normalize(code))
    if (!invite || invite.usedAt || invite.expiresAt < Date.now()) return reject('invite_invalid')
    return invite
  }

  peekInvite(_userId: string, code: string): InvitePeek {
    const invite = this.validInvite(code)
    const seats = this.seats(invite.householdId)
    return {
      kind: invite.kind,
      roomName: String(this.table('households').get(invite.householdId)?.name ?? ''),
      host: card(seats.find((m) => m.id === invite.createdBy)),
      profile: invite.kind === 'restore' ? card(seats.find((m) => m.id === invite.memberId)) : null,
    }
  }

  joinHousehold(userId: string, code: string, me: ProfileInput, pin: string): Membership & { kind: 'join' | 'restore' } {
    if (this.seatOf(userId)) reject('already_in_room')
    const invite = this.validInvite(code)
    this.checkPin(pin)

    let memberId: ID
    if (invite.kind === 'join') {
      const seats = this.seats(invite.householdId)
      if (seats.length >= 2) reject('room_full')
      const wanted = nameKey(me.name ?? '') || 'two'
      if (seats.some((m) => nameKey(m.name) === wanted)) reject('name_taken')
      memberId = this.addMember(invite.householdId, me, 'Two', false)
    } else {
      const seat = this.seats(invite.householdId).find((m) => m.id === invite.memberId) ?? reject('member_not_found')
      // Back in with a fresh start: the forgotten PIN and its wrong tries are history,
      // and so is every device that was still logged in (it may be the lost phone).
      this.attempts.delete(nameKey(seat.name))
      this.dropDevices(seat.id)
      memberId = seat.id
    }
    this.pins.set(memberId, pin)
    this.devices.set(userId, memberId)
    invite.usedAt = Date.now()
    this.emit(invite.householdId)
    return { householdId: invite.householdId, memberId, kind: invite.kind }
  }

  signInWithPin(userId: string, name: string, pin: string): Membership {
    if (this.seatOf(userId)) reject('already_in_room')
    const key = nameKey(name).slice(0, 40)
    const now = Date.now()
    const tries = this.attempts.get(key) ?? { failed: 0, lockouts: 0, lockedUntil: 0, lastAttempt: now }
    if (tries.lockedUntil > now) reject('pin_locked', { retryAt: new Date(tries.lockedUntil).toISOString() })

    const found = this.members().find((m) => !m.deletedAt && nameKey(m.name) === key && this.pins.get(m.id) === pin)
    if (!found) {
      // The same answer for a wrong PIN and for a name nobody has: strangers learn nothing.
      tries.failed += 1
      tries.lastAttempt = now
      this.attempts.set(key, tries)
      if (tries.failed >= PIN_TRIES) {
        tries.failed = 0
        tries.lockouts += 1
        tries.lockedUntil = now + lockMinutes(tries.lockouts) * 60_000
        reject('pin_locked', { retryAt: new Date(tries.lockedUntil).toISOString() })
      }
      return reject('pin_wrong', { triesLeft: PIN_TRIES - tries.failed })
    }

    this.attempts.delete(key)
    if (found.disabledAt) reject('account_paused')
    this.devices.set(userId, found.id)
    return { householdId: found.householdId, memberId: found.id }
  }

  setPin(userId: string, pin: string): void {
    const me = this.memberOf(userId) ?? reject('not_in_room')
    this.checkPin(pin)
    this.pins.set(me.id, pin)
    this.attempts.delete(nameKey(me.name))
  }

  signOutDevice(userId: string): void {
    this.devices.delete(userId)
    this.dropPushes(userId)
  }

  private dropDevices(memberId: ID, except?: string): number {
    let count = 0
    for (const [login, member] of this.devices) {
      if (member !== memberId || login === except) continue
      this.devices.delete(login)
      this.dropPushes(login)
      count += 1
    }
    return count
  }

  /** A device that is logged out, by whomever, gets no more notifications. */
  private dropPushes(userId: string): void {
    for (const [endpoint, row] of this.pushRows) if (row.userId === userId) this.pushRows.delete(endpoint)
  }

  signOutOtherDevices(userId: string): number {
    const me = this.memberOf(userId) ?? reject('not_in_room')
    return this.dropDevices(me.id, userId)
  }

  // ------------------------------------------------------------------- admin --

  private partnerOf(admin: MemberRow, memberId: ID): MemberRow {
    if (memberId === admin.id) reject('not_yourself')
    return this.seats(admin.householdId).find((m) => m.id === memberId) ?? reject('member_not_found')
  }

  setMemberPaused(userId: string, memberId: ID, paused: boolean): void {
    const partner = this.partnerOf(this.admin(userId), memberId)
    if (Boolean(partner.disabledAt) === paused) return
    partner.disabledAt = paused ? this.now() : null
    this.touch(partner)
  }

  signOutMember(userId: string, memberId: ID): number {
    return this.dropDevices(this.partnerOf(this.admin(userId), memberId).id)
  }

  /**
   * The owner's master key, for when both people are locked out. In the real cloud this
   * can only be run from the Supabase dashboard (private.rescue_code), never from the app.
   */
  rescueCode(name: string): string {
    const seat = this.members().find((m) => !m.deletedAt && nameKey(m.name) === nameKey(name)) ?? reject('member_not_found')
    const code = this.code(10)
    this.invites.set(code, { code, householdId: seat.householdId, kind: 'restore', memberId: seat.id, createdBy: seat.id, expiresAt: Date.now() + 48 * 3_600_000, usedAt: null })
    return code
  }

  // ----------------------------------------------------------- notifications --

  /** For any device with a login, like public.push_public_key(). */
  pushPublicKey(_userId: string): string | null {
    return this.pushKey
  }

  /**
   * Test hook: what the owner does from the SQL editor. Null is "not set up yet" (or the
   * keys were thrown away); another key is what the function made after that.
   */
  setPushPublicKey(key: string | null): void {
    this.pushKey = key
  }

  savePushSubscription(userId: string, subscription: PushSubscriptionInput): void {
    const me = this.memberOf(userId) ?? reject('not_in_room')
    const { endpoint, p256dh, auth } = subscription ?? {}
    const fine =
      typeof endpoint === 'string' && /^https:\/\//.test(endpoint) && endpoint.length <= 2000 &&
      typeof p256dh === 'string' && p256dh !== '' && p256dh.length <= 200 &&
      typeof auth === 'string' && auth !== '' && auth.length <= 100
    if (!fine) reject('push_invalid')
    // One row per device: the browser may have swapped its subscription for a new one.
    for (const [other, row] of this.pushRows) if (row.userId === userId && other !== endpoint) this.pushRows.delete(other)
    // One row per browser: whoever is logged in on it now owns it.
    this.pushRows.set(endpoint, {
      id: this.pushRows.get(endpoint)?.id ?? this.id(),
      householdId: me.householdId,
      memberId: me.id,
      userId,
      endpoint,
      p256dh,
      auth,
      mutedTypes: knownTypes(subscription.mutedTypes),
      userAgent: typeof subscription.userAgent === 'string' ? subscription.userAgent.slice(0, 300) : null,
    })
  }

  setPushMuted(userId: string, endpoint: string, mutedTypes: PushType[]): void {
    const me = this.memberOf(userId) ?? reject('not_in_room')
    const row = this.pushRows.get(endpoint)
    if (!row || row.memberId !== me.id) return reject('push_missing')
    row.mutedTypes = knownTypes(mutedTypes)
  }

  removePushSubscription(userId: string, endpoint: string): void {
    const row = this.pushRows.get(endpoint)
    if (!row) return
    if (row.userId === userId || row.memberId === this.memberOf(userId)?.id) this.pushRows.delete(endpoint)
  }

  /** Test hook: every device signed up for notifications right now. */
  pushSubscriptions(): { endpoint: string; memberId: ID; mutedTypes: PushType[] }[] {
    return [...this.pushRows.values()].map(({ endpoint, memberId, mutedTypes }) => ({ endpoint, memberId, mutedTypes: [...mutedTypes] }))
  }

  /** Test hook: every notification "sent" since the last reset, oldest first. */
  sentPushes(): SentPush[] {
    return structuredClone(this.sent)
  }

  /**
   * What the database trigger and the push function do together in the real cloud
   * (supabase/migrations, supabase/functions/push): look up who should hear about the
   * event and "send" each of their devices one notification. Same rules, same words.
   */
  private announce(event: PushEvent): void {
    const envelope = this.table('envelopes').get(event.envelopeId)
    const now = Date.now()
    const seen = (envelope?.seen ?? {}) as Record<string, unknown>
    const open = [...this.table('keys').values()].filter((k) => k.envelopeId === event.envelopeId && !k.deletedAt && k.key !== '' && Date.parse(k.opensAt as ISO) <= now && seen[k.layer as string] == null)
    const reply = envelope?.reply as { at?: ISO } | null | undefined
    const deliveries = plan(
      event,
      {
        people: this.seats(event.householdId).map((m) => ({ id: m.id, name: m.name, lang: langOf(m.prefs), paused: Boolean(m.disabledAt) })),
        devices: [...this.pushRows.values()].filter((row) => row.householdId === event.householdId),
        envelope: envelope
          ? {
              deleted: Boolean(envelope.deletedAt),
              authorId: envelope.authorId as ID,
              openMode: String(envelope.openMode),
              opensAt: (envelope.opensAt as ISO | null) ?? null,
              createdAt: (envelope.createdAt as ISO | null) ?? null,
              waiting: open.length,
              openedAt: open.map((k) => k.opensAt as ISO).sort().at(-1) ?? null,
              repliedAt: reply ? (reply.at ?? (envelope.createdAt as ISO)) : null,
            }
          : null,
      },
      new Date(),
    )
    for (const { device, ...rest } of deliveries) this.sent.push({ ...rest, endpoint: device.endpoint, memberId: device.memberId })
  }

  /**
   * The minute job of the real cloud (private.announce_due): an envelope whose time has
   * come is announced once, although nobody did anything at that moment. Tests call this.
   */
  tick(): void {
    const now = Date.now()
    const told = new Set<ID>()
    for (const key of this.table('keys').values()) {
      if (key.announcedAt || key.deletedAt || key.key === '' || Date.parse(key.opensAt as ISO) > now) continue
      key.announcedAt = this.now()
      key.updatedAt = key.announcedAt
      const envelopeId = key.envelopeId as ID
      if (told.has(envelopeId)) continue
      told.add(envelopeId)
      this.announce({ type: 'opened', householdId: key.householdId as ID, actorId: key.authorId as ID, envelopeId })
      this.emit(key.householdId as ID)
    }
  }

  // -------------------------------------------------------------------- sync --

  push(userId: string, op: PushOp): void {
    const me = this.memberOf(userId) ?? reject('forbidden')
    const table = this.table(op.table)
    const existing = table.get(op.id)
    const at = this.now()

    if (op.table === 'households') {
      if (op.kind !== 'patch' || op.id !== me.householdId || !existing) reject('forbidden')
      const { name, settings } = op.data
      table.set(op.id, { ...(existing as Row), ...defined({ name, settings }), updatedAt: at })
    } else if (op.table === 'members') {
      // Each person may edit only their own profile fields.
      if (op.kind !== 'patch' || !existing || existing.id !== me.id) return
      const allowed = Object.fromEntries(Object.entries(op.data).filter(([k]) => PROFILE_FIELDS.includes(k)))
      if (typeof allowed.status === 'string' && allowed.status.length > 60) reject('status_too_long')
      if (typeof allowed.name === 'string') {
        const wanted = nameKey(allowed.name)
        if (!wanted || allowed.name.length > 40) reject('name_invalid')
        // Names are how people log in, so two people cannot share one.
        if (this.seats(me.householdId).some((m) => m.id !== me.id && nameKey(m.name) === wanted)) reject('name_taken')
      }
      table.set(op.id, { ...existing, ...allowed, updatedAt: at })
    } else {
      if (existing && existing.householdId !== me.householdId) reject('forbidden')
      if (op.kind === 'patch' && !existing) return // an update that matches no row is not an error, as in SQL
      if (op.kind === 'put' && op.data.householdId !== me.householdId) reject('forbidden')
      const { id: _id, householdId: _h, createdAt: _c, updatedAt: _u, ...changes } = op.data
      // A "put" of a row that is already there is an update, as with an upsert in SQL.
      const wanted: Row = existing
        ? { ...existing, ...changes, updatedAt: at }
        : { ...(op.data as Row), id: op.id, householdId: me.householdId, createdAt: (op.data.createdAt as ISO | undefined) ?? at, updatedAt: at }
      if (op.table === 'envelopes') this.writeEnvelope(me, existing, wanted)
      else if (op.table === 'keys') this.writeKey(me, existing, wanted)
      else if (op.table === 'media') this.writeMedia(me, existing, wanted)
      else reject('forbidden')
    }
    this.emit(me.householdId)
  }

  /** private.guard_envelope(): the author owns the envelope, the other one owns "seen" and the answer. */
  private writeEnvelope(me: MemberRow, before: Row | undefined, row: Row): void {
    if (!before) {
      row.authorId = me.id
      row.seen = {}
      row.reply = null
    } else {
      row.authorId = before.authorId
      row.kind = before.kind
      if (before.authorId === me.id) {
        // The author cannot speak for the other one.
        row.seen = before.seen
        row.reply = before.reply
      } else {
        // The other one may only say what they opened, and answer. Nothing else of theirs is taken.
        const seen = { ...((row.seen ?? {}) as Record<string, ISO>), ...(before.seen as Record<string, ISO>) }
        const reply = row.reply
        Object.assign(row, before, { seen: onlyLayers(seen), reply, updatedAt: row.updatedAt })
      }
    }
    if (!oneOf(row.openMode, ['now', 'at', 'hand']) || !oneOf(row.wants, ['listen', 'react', 'talk']) || !oneOf(row.keep, ['keep', 'once'])) reject('envelope_invalid')
    if (typeof row.teaser === 'string' && row.teaser.length > 120) reject('envelope_invalid')
    row.layers = onlyLayers((row.layers ?? {}) as Record<string, unknown>)

    // Taken back: the cloud forgets what was inside, what stood on the outside and what was answered.
    if (row.deletedAt) {
      Object.assign(row, { layers: {}, teaser: null, heatOutside: null, reply: null })
      this.burn(row.id, LAYERS, row.updatedAt as ISO)
    } else if (row.keep === 'once') {
      // One opening: what the other one has opened is gone from the cloud.
      const opened = LAYERS.filter((layer) => (row.seen as Record<string, unknown>)[layer] != null)
      const layers = { ...(row.layers as Record<string, unknown>) }
      for (const layer of opened) delete layers[layer]
      row.layers = layers
      this.burn(row.id, opened, row.updatedAt as ISO)
    }
    this.table('envelopes').set(row.id, row)

    const type = envelopeEvent(before ? changeOf(before) : null, changeOf(row))
    if (type) this.announce({ type, householdId: me.householdId, actorId: me.id, envelopeId: row.id })
  }

  /** private.burn_layers(): the keys become useless and the sealed sound is marked gone. */
  private burn(envelopeId: ID, layers: readonly Layer[], at: ISO): void {
    for (const key of this.table('keys').values()) {
      if (key.envelopeId !== envelopeId || !layers.includes(key.layer as Layer) || key.key === '') continue
      Object.assign(key, { key: '', deletedAt: at, updatedAt: at })
    }
    if (!layers.includes('voice')) return
    for (const media of this.table('media').values()) {
      if (media.envelopeId !== envelopeId || media.deletedAt) continue
      Object.assign(media, { deletedAt: at, updatedAt: at })
      this.blobs.delete(`${media.householdId as ID}/${media.id}.bin`)
    }
  }

  /** private.guard_key(): only the author hands out keys, one per layer, and a key that is out stays out. */
  private writeKey(me: MemberRow, before: Row | undefined, row: Row): void {
    const now = Date.now()
    if (!before) {
      const envelope = this.table('envelopes').get(row.envelopeId as ID)
      if (!envelope || envelope.authorId !== me.id || envelope.deletedAt) reject('forbidden')
      if (!LAYERS.includes(row.layer as Layer) || typeof row.key !== 'string' || row.key === '' || Number.isNaN(Date.parse(String(row.opensAt)))) reject('key_invalid')
      if ([...this.table('keys').values()].some((k) => k.envelopeId === row.envelopeId && k.layer === row.layer)) reject('key_exists')
      row.authorId = me.id
      row.deletedAt = null
      row.announcedAt = null
    } else {
      if (before.authorId !== me.id) reject('forbidden')
      // Only the opening time may change, and only while it has not come.
      const opensAt = Date.parse(before.opensAt as ISO) > now && !before.deletedAt && !Number.isNaN(Date.parse(String(row.opensAt))) ? row.opensAt : before.opensAt
      Object.assign(row, before, { opensAt, updatedAt: row.updatedAt })
    }
    const wasOut = before ? Date.parse(before.opensAt as ISO) <= now : false
    if (!row.announcedAt && !wasOut && !row.deletedAt) {
      // (This cloud's clock never stands still, so within one millisecond it runs a little
      // ahead of the wall clock. What was announced was announced: never later than now.)
      const siblings = [...this.table('keys').values()].filter((k) => k.envelopeId === row.envelopeId && k.id !== row.id && k.announcedAt).map((k) => Math.min(now, Date.parse(k.announcedAt as ISO)))
      const opensAt = Date.parse(row.opensAt as ISO)
      if (opensAt <= now) {
        row.announcedAt = row.updatedAt
        this.table('keys').set(row.id, row)
        if (keyEvent(opensAt, now, siblings)) this.announce({ type: 'opened', householdId: me.householdId, actorId: me.id, envelopeId: row.envelopeId as ID })
        return
      }
    }
    this.table('keys').set(row.id, row)
  }

  /** private.guard_media(): a sealed file belongs to its author's envelope. */
  private writeMedia(me: MemberRow, before: Row | undefined, row: Row): void {
    if (!before) {
      const envelope = this.table('envelopes').get(row.envelopeId as ID)
      if (!envelope || envelope.authorId !== me.id) reject('forbidden')
      row.authorId = me.id
    } else {
      if (before.authorId !== me.id) reject('forbidden')
      Object.assign(row, before, { uploaded: Boolean(row.uploaded), deletedAt: row.deletedAt ?? before.deletedAt, updatedAt: row.updatedAt })
    }
    this.table('media').set(row.id, row)
  }

  pull(userId: string, since: ISO | null): PullResult {
    const me = this.memberOf(userId)
    const tables: PullResult['tables'] = {}
    const serverTime = this.now()
    for (const name of SYNC_TABLES) {
      const rows: Row[] = []
      if (me) {
        for (const row of this.table(name).values()) {
          const mine = name === 'households' ? row.id === me.householdId : row.householdId === me.householdId
          if (!mine) continue
          let changed = !since || (row.updatedAt as ISO) > since
          if (name === 'keys') {
            // The author always sees their keys. The other one sees a key from its opening
            // time on, and then it counts as news although the row itself did not change.
            const opensAt = Date.parse(row.opensAt as ISO)
            if (row.authorId !== me.id) {
              if (row.deletedAt || opensAt > Date.parse(serverTime)) continue
              changed ||= since !== null && opensAt > Date.parse(since)
            }
          }
          if (!changed) continue
          const { announcedAt: _a, ...copy } = structuredClone(row)
          rows.push(copy as Row)
        }
      }
      tables[name] = rows
    }
    const seat = this.seatOf(userId)
    return { serverTime, tables, seat: !seat ? 'gone' : seat.disabledAt ? 'paused' : 'ok' }
  }

  subscribe(listener: (householdId: ID) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  // ------------------------------------------------------------- sealed files --

  uploadBlob(userId: string, path: string, bytes: Uint8Array, type: string): void {
    const me = this.memberOf(userId)
    if (!me || path.split('/')[0] !== me.householdId) reject('forbidden')
    this.blobs.set(path, { bytes, type })
  }

  downloadBlob(userId: string, path: string): { bytes: Uint8Array; type: string } | null {
    const me = this.memberOf(userId)
    if (!me || path.split('/')[0] !== me.householdId) return null
    return this.blobs.get(path) ?? null
  }

  removeBlob(userId: string, path: string): void {
    const me = this.memberOf(userId)
    if (!me || path.split('/')[0] !== me.householdId) reject('forbidden')
    this.blobs.delete(path)
  }

  /** Test hook: is there a file at this path? */
  hasBlob(path: string): boolean {
    return this.blobs.has(path)
  }

  /** Test hook: a row as the cloud has it, whoever may read it. */
  peek(table: SyncTable, id: ID): Record<string, unknown> | undefined {
    const row = this.table(table).get(id)
    return row ? structuredClone(row) : undefined
  }
}

const normalize = (code: string) => code.replace(/[^A-Za-z0-9]/g, '').toUpperCase()

/** Only kinds of notification that exist, each once. */
const knownTypes = (types: unknown): PushType[] => PUSH_TYPES.filter((type) => Array.isArray(types) && types.includes(type))

const oneOf = (value: unknown, allowed: readonly string[]): boolean => typeof value === 'string' && allowed.includes(value)

/** Only the three layers an envelope can have. Anything else somebody slipped in is dropped. */
function onlyLayers<T>(given: Record<string, T>): Record<string, T> {
  return Object.fromEntries(LAYERS.filter((layer) => given[layer] != null).map((layer) => [layer, given[layer]]))
}

const changeOf = (row: Row): EnvelopeChange => ({ openMode: String(row.openMode), deleted: Boolean(row.deletedAt), hasReply: row.reply != null })

function defined(obj: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined))
}
