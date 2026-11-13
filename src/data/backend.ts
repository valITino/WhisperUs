// The one seam between the app and "the cloud". The sync engine only ever talks to
// this interface, so it can run against Supabase on real phones and against the
// pretend cloud in tests and local development.

import type { ID, ISO, SyncTable } from './types.ts'

export type BackendErrorKind =
  /** No connection, timeout, 5xx. Try again later; nothing is wrong with the data. */
  | 'network'
  /** The cloud understood and said no (rule violation, bad data). Retrying will not help. */
  | 'rejected'
  /** The login is gone or invalid. Sign in again. */
  | 'auth'
  /** The cloud project is not configured yet (for example anonymous sign-ins are off). */
  | 'setup'

/** Extra facts that come with some refusals. */
export interface BackendErrorDetails {
  /** pin_wrong: how many tries are left before the name is paused. */
  triesLeft?: number
  /** pin_locked: when the next try is allowed. */
  retryAt?: ISO
}

export class BackendError extends Error {
  readonly kind: BackendErrorKind
  /** Stable machine code, such as "room_full" or "invite_invalid". */
  readonly code: string
  readonly details: BackendErrorDetails

  constructor(kind: BackendErrorKind, code: string, message?: string, details: BackendErrorDetails = {}) {
    super(message ?? code)
    this.name = 'BackendError'
    this.kind = kind
    this.code = code
    this.details = details
  }
}

export const isBackendError = (e: unknown): e is BackendError => e instanceof BackendError

export interface Session {
  userId: string
}

export interface Membership {
  householdId: ID
  memberId: ID
  /** The admin has paused this profile. Nothing syncs until it is switched on again. */
  paused?: boolean
}

export interface ProfileInput {
  name: string
  avatar?: string
  color?: string
  accessory?: string | null
  status?: string | null
}

export interface Invite {
  code: string
  kind: 'join' | 'restore'
  expiresAt: ISO
}

/** What a person looks like to someone who is not in the room yet. */
export interface PersonCard {
  name: string
  avatar: string
  color: string
  accessory: string | null
}

/** What a code leads to, before it is used. */
export interface InvitePeek {
  kind: 'join' | 'restore'
  roomName: string
  /** Who made the code. */
  host: PersonCard | null
  /** Restore codes only: the profile that is waiting to be picked up. */
  profile: PersonCard | null
}

/**
 * The things a notification can be about. Each device can mute any of them.
 * The cloud's side of the list is in supabase/functions/push/logic.ts; a unit test keeps
 * the two the same.
 */
export const PUSH_TYPES = ['sealed', 'opened', 'answered'] as const
/**
 * sealed: something was sealed for you and waits.   opened: something opened for you.
 * answered: the other one answered what you opened for them.
 */
export type PushType = (typeof PUSH_TYPES)[number]

/** Where the browser's push service reaches this device, and what the device does not want to hear. */
export interface PushSubscriptionInput {
  /** The address the push service handed out. It is the device's identity here. */
  endpoint: string
  /** The device's public key, base64url. Messages are encrypted for it. */
  p256dh: string
  /** The device's shared secret, base64url. */
  auth: string
  mutedTypes: PushType[]
  /** Which browser this is, to tell devices apart when something needs looking at. */
  userAgent?: string
}

/** One change on its way to the cloud. "put" sends a whole row, "patch" only the changed fields. */
export interface PushOp {
  table: SyncTable
  kind: 'put' | 'patch'
  id: ID
  /** camelCase fields. For "put" the complete row; for "patch" just what changed. */
  data: Record<string, unknown>
}

export interface PullResult {
  serverTime: ISO
  /** camelCase rows that changed since the cursor, per table. */
  tables: Partial<Record<SyncTable, Record<string, unknown>[]>>
  /** Whether this device still has its seat: logged in, paused by the admin, or logged out. */
  seat: 'ok' | 'paused' | 'gone'
}

export interface Backend {
  readonly name: 'supabase' | 'fake' | 'memory'

  /** Returns this device's login, creating an anonymous one on first launch. Needs a connection once. */
  ensureSession(): Promise<Session>
  /** Which profile this device is logged in as, or null when it is not logged in. */
  membership(): Promise<Membership | null>
  /** True once somebody has opened the room. There is only ever one. */
  roomExists(): Promise<boolean>

  /** Open the room. The PIN is what lets this person log in on other devices later. */
  createHousehold(name: string, me: ProfileInput, pin: string): Promise<Membership>
  /**
   * Admin only. "join" invites the second person. "restore" lets the partner back in
   * without their PIN (they choose a new one).
   */
  createInvite(kind: 'join' | 'restore', memberId?: ID): Promise<Invite>
  /** Look at a code without using it. Rejects with invite_invalid. */
  peekInvite(code: string): Promise<InvitePeek>
  /**
   * Use a code. "join" takes the second seat with the given profile and PIN. "restore"
   * logs this device in as the existing profile and replaces its PIN.
   */
  joinHousehold(code: string, me: ProfileInput, pin: string): Promise<Membership & { kind: 'join' | 'restore' }>
  /**
   * Log this device in as an existing person. Rejects with pin_wrong (details.triesLeft)
   * or pin_locked (details.retryAt). An unknown name looks exactly like a wrong PIN.
   */
  signInWithPin(name: string, pin: string): Promise<Membership>
  /** Replace my PIN. */
  setPin(pin: string): Promise<void>
  /** Log this device out of the profile. Needs a connection. */
  signOutDevice(): Promise<void>
  /** Log every other device out of my profile. Resolves with how many there were. */
  signOutOtherDevices(): Promise<number>
  /** Admin only: pause the partner's profile, or switch it on again. */
  setMemberPaused(memberId: ID, paused: boolean): Promise<void>
  /** Admin only: log the partner out on all their devices. Resolves with how many there were. */
  signOutMember(memberId: ID): Promise<number>

  push(op: PushOp): Promise<void>
  pull(since: ISO | null): Promise<PullResult>
  /** Calls onChange whenever something in the room changes. Returns an unsubscribe function. */
  subscribe(householdId: ID, onChange: () => void): () => void

  /**
   * The public half of the key pair that signs the room's notifications. A browser
   * needs it to sign up. Null while notifications are not set up for this room.
   */
  pushPublicKey(): Promise<string | null>
  /**
   * Sign this device up for notifications, or replace what the cloud knows about it.
   * One row per device; the row belongs to whoever is logged in on it now.
   * Rejects with not_in_room or push_invalid.
   */
  savePushSubscription(subscription: PushSubscriptionInput): Promise<void>
  /**
   * Change which kinds of notification this device mutes. Rejects with push_missing when
   * the cloud has no row for the device (save the subscription again).
   */
  setPushMuted(endpoint: string, mutedTypes: PushType[]): Promise<void>
  /** No more notifications for this device. Not an error when there was nothing to remove. */
  removePushSubscription(endpoint: string): Promise<void>

  uploadBlob(path: string, blob: Blob): Promise<void>
  /** Resolves null when the file is not in the cloud (yet). */
  downloadBlob(path: string): Promise<Blob | null>
  /** Remove a file from the cloud. Not an error when it was not there. */
  removeBlob(path: string): Promise<void>

  /** Forget this device's login. The next call starts a fresh anonymous one. */
  signOut(): Promise<void>
}

/** Where a sealed file lives in cloud storage. */
export const mediaPath = (householdId: ID, mediaId: ID) => `${householdId}/${mediaId}.bin`
