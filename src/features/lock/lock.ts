// The app lock: a six-digit code this device asks for before it shows anything.
//
// It belongs to the device, not to the person: each phone has its own, and it is not the
// PIN (the PIN logs a device in; this keeps a logged-in device shut). It works offline.
// The code itself is never stored, only a slow hash of it.
//
// What it is for: a phone left on the sofa, a tablet somebody else picks up. What it is
// not: encryption. Somebody who can read this device's storage with other tools is not
// stopped by it.

import { useSyncExternalStore } from 'react'
import { getPref } from '../../data/prefs'
import { fromBase64, toBase64 } from '../../data/seal'

const KEY = 'whisperus.lock'
const ROUNDS = 150_000
export const LOCK_TRIES = 5
const FIRST_WAIT_MS = 30_000
const LONGEST_WAIT_MS = 15 * 60_000

interface Stored {
  salt: string
  hash: string
  rounds: number
  /** Wrong tries since the last right one. */
  fails: number
  /** How many times the tries ran out: each time the wait doubles. */
  waits: number
  /** No try is accepted before this moment (ms). */
  until: number
}

function read(): Stored | null {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return null
    const stored = JSON.parse(raw) as Partial<Stored>
    if (typeof stored.salt !== 'string' || typeof stored.hash !== 'string' || typeof stored.rounds !== 'number') return null
    return { salt: stored.salt, hash: stored.hash, rounds: stored.rounds, fails: stored.fails ?? 0, waits: stored.waits ?? 0, until: stored.until ?? 0 }
  } catch {
    return null
  }
}

function write(stored: Stored | null): void {
  try {
    if (stored) localStorage.setItem(KEY, JSON.stringify(stored))
    else localStorage.removeItem(KEY)
  } catch {
    /* private mode: a lock that cannot be saved is simply not on */
  }
}

async function hashOf(code: string, salt: Uint8Array<ArrayBuffer>, rounds: number): Promise<string> {
  const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(code), 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: rounds }, material, 256)
  return toBase64(new Uint8Array(bits))
}

// ------------------------------------------------------------------- state --

const listeners = new Set<() => void>()
let on = read() !== null
/** A device with a lock starts locked. */
let locked = on
let hiddenAt: number | null = null

const emit = () => {
  for (const fn of listeners) fn()
}
const subscribe = (fn: () => void) => {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

export const isLockOn = (): boolean => on
export const isLocked = (): boolean => locked

/** True while the lock screen should cover the app. */
export function useLocked(): boolean {
  return useSyncExternalStore(subscribe, isLocked)
}

/** Whether this device has a lock at all. */
export function useLockOn(): boolean {
  return useSyncExternalStore(subscribe, isLockOn)
}

/** Lock now. Does nothing on a device without a lock. */
export function lockNow(): void {
  if (!on || locked) return
  locked = true
  emit()
}

/**
 * Lock when the app goes out of sight, as soon as the chosen time is up. With "at once"
 * the lock goes on the moment the app is hidden, so even the picture the phone keeps for
 * its app switcher shows the lock.
 */
export function watchVisibility(): void {
  document.addEventListener('visibilitychange', () => {
    if (!on) return
    if (document.visibilityState === 'hidden') {
      hiddenAt = Date.now()
      if (getPref('lockAfter') <= 0) lockNow()
      return
    }
    if (hiddenAt !== null && Date.now() - hiddenAt >= getPref('lockAfter') * 1000) lockNow()
    hiddenAt = null
  })
}

// ----------------------------------------------------------------- the code --

/** Turn the lock on, or replace its code. The device stays open: whoever set it knows it. */
export async function setLockCode(code: string): Promise<void> {
  const salt = crypto.getRandomValues(new Uint8Array(16))
  write({ salt: toBase64(salt), hash: await hashOf(code, salt, ROUNDS), rounds: ROUNDS, fails: 0, waits: 0, until: 0 })
  on = true
  emit()
}

/** Take the lock off this device. */
export function removeLock(): void {
  write(null)
  on = false
  locked = false
  emit()
}

export type LockAnswer = { ok: true } | { ok: false; triesLeft: number; retryAt: number | null }

/** How long a try must wait, if at all: the moment (ms) from which one is accepted again. */
export function lockedUntil(now = Date.now()): number | null {
  const stored = read()
  return stored && stored.until > now ? stored.until : null
}

/**
 * Check a code without unlocking: for changing the code or turning the lock off.
 * Wrong tries count, here as on the lock screen: five, then a wait that doubles.
 */
export async function checkLockCode(code: string, now = Date.now()): Promise<LockAnswer> {
  const stored = read()
  if (!stored) return { ok: true }
  if (stored.until > now) return { ok: false, triesLeft: 0, retryAt: stored.until }
  if ((await hashOf(code, fromBase64(stored.salt), stored.rounds)) === stored.hash) {
    write({ ...stored, fails: 0, waits: 0, until: 0 })
    return { ok: true }
  }
  const fails = stored.fails + 1
  if (fails >= LOCK_TRIES) {
    const until = now + Math.min(FIRST_WAIT_MS * 2 ** stored.waits, LONGEST_WAIT_MS)
    write({ ...stored, fails: 0, waits: stored.waits + 1, until })
    return { ok: false, triesLeft: 0, retryAt: until }
  }
  write({ ...stored, fails })
  return { ok: false, triesLeft: LOCK_TRIES - fails, retryAt: null }
}

/** Try to open the lock screen with a code. */
export async function unlock(code: string): Promise<LockAnswer> {
  const answer = await checkLockCode(code)
  if (answer.ok) {
    locked = false
    hiddenAt = null
    emit()
  }
  return answer
}

/** For tests: read everything again from storage, as after a fresh start. */
export function reloadLock(): void {
  on = read() !== null
  locked = on
  hiddenAt = null
  emit()
}
