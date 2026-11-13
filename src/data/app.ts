// The app's single data stack: local database, cloud connection, store, sync engine.

import { useSyncExternalStore } from 'react'
import type { Backend, Membership, ProfileInput } from './backend'
import { cloudKnown } from './cloud'
import { AppDB, META } from './db'
import { HttpFakeBackend } from './fake/httpBackend'
import { deviceMemory, PushControl, pushDevice } from './push'
import { takeSeat } from './seat'
import { Store } from './store'
import { SupabaseBackend } from './supabaseBackend'
import { SyncEngine, type SyncStatus } from './sync'
import { wipeOnNextStart } from './wipe'

/** False in a build made before the room's cloud exists. The app then shows one page saying so. */
export const cloudConnected = cloudKnown({ backend: import.meta.env.VITE_BACKEND, url: import.meta.env.VITE_SUPABASE_URL, key: import.meta.env.VITE_SUPABASE_KEY })

function createBackend(): Backend {
  if (import.meta.env.VITE_BACKEND === 'fake') return new HttpFakeBackend()
  // Without a cloud nothing is ever asked of this one: an address that leads nowhere, on purpose.
  if (!cloudConnected) return new SupabaseBackend('https://no-cloud.invalid', 'not-connected')
  return new SupabaseBackend(import.meta.env.VITE_SUPABASE_URL as string, import.meta.env.VITE_SUPABASE_KEY as string)
}

export const db = new AppDB('whisperus')
export const backend = createBackend()
export const store = new Store(db)
export const sync = new SyncEngine(db, backend, store)

/** Notifications on this device (push.ts). */
export const push = new PushControl(pushDevice(), backend, deviceMemory, typeof navigator === 'undefined' ? '' : navigator.userAgent)

export function useSyncStatus(): SyncStatus {
  return useSyncExternalStore(
    (onChange) => sync.onStatus(onChange),
    () => sync.status,
  )
}

/** Remember who this device is logged in as, then fetch everything. */
async function adopt(membership: Membership): Promise<void> {
  await takeSeat(db, membership)
  await sync.start()
  await sync.sync()
}

/** Open the room. Whoever does this is its admin. The PIN is for logging in on other devices. */
export async function startRoom(name: string, me: ProfileInput, pin: string): Promise<void> {
  await adopt(await backend.createHousehold(name, me, pin))
}

/**
 * Use a code from the admin. "join" takes the second seat with this profile and PIN.
 * "restore" logs in as the profile the code was made for (the profile typed here is
 * ignored) and replaces its forgotten PIN. Returns which of the two happened.
 */
export async function joinRoom(code: string, me: ProfileInput, pin: string): Promise<'join' | 'restore'> {
  const result = await backend.joinHousehold(code, me, pin)
  await adopt(result)
  return result.kind
}

/** Log in on this device with name and PIN. Profile, settings and everything else follow. */
export async function logIn(name: string, pin: string): Promise<void> {
  await adopt(await backend.signInWithPin(name, pin))
}

/**
 * This login already has a seat in the cloud but the device does not know it (the reply
 * to "start", "join" or "log in" was lost on the way). Take the seat. Returns false when there is none.
 */
export async function resumeRoom(): Promise<boolean> {
  const membership = await backend.membership()
  if (!membership) return false
  await adopt(membership)
  return true
}

/**
 * Log this device out and wipe its copy of the room. Needs a connection, so the cloud
 * knows the device is gone. Changes that were not sent yet are lost: check
 * `sync.status.pending` first and warn. The page reloads to the start screen.
 */
export async function logOut(): Promise<void> {
  // No more notifications for this device. Asked first, while the cloud still knows who
  // is asking; the cloud also drops them by itself when the device is logged out.
  await push.removeFromCloud().catch(() => undefined)
  await backend.signOutDevice()
  await forgetThisDevice()
}

/** The cloud already logged this device out: wipe the local copy and start over. */
export async function forgetThisDevice(): Promise<void> {
  sync.stop()
  // The browser lets go of its subscription too: nothing arrives for a room this device left.
  await push.forget().catch(() => undefined)
  await backend.signOut().catch(() => undefined)
  // The copy is deleted on the way back in, before anything reads from it (wipe.ts).
  wipeOnNextStart(db.name)
  window.location.hash = '/'
  window.location.reload()
}

let booting: Promise<{ paired: boolean }> | undefined

/**
 * Call when the app opens. Works offline: a paired phone starts from its local copy.
 * Safe to call twice (React does so in development): both callers get the same start.
 */
export function boot(): Promise<{ paired: boolean }> {
  return (booting ??= bootOnce())
}

async function bootOnce(): Promise<{ paired: boolean }> {
  if (navigator.storage?.persist) void navigator.storage.persist()
  const householdId = await db.getMeta<string>(META.householdId)
  if (householdId) {
    await sync.start()
    return { paired: true }
  }
  return { paired: false }
}
