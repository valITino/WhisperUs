// Logging out wipes this device's copy of the room. The wipe happens on the next
// start, before anything opens the database: deleting it while screens are still
// reading from it would make every one of them fail on the way out.

import Dexie from 'dexie'

const KEY = 'whisperus.wipeOnStart'

/**
 * What belongs to the person who was logged in, kept outside the database: the app lock
 * of this device (a forgotten code must not lock the next login out) and words still
 * waiting in the booth. Language and light stay: they say nothing about anybody.
 */
export const PERSONAL_SLOTS = ['whisperus.lock', 'whisperus.boothDraft', 'whisperus.prefs'] as const

/** Ask for the named database to be deleted when the app starts next, and clear the rest now. */
export function wipeOnNextStart(name: string): void {
  try {
    localStorage.setItem(KEY, name)
    for (const slot of PERSONAL_SLOTS) localStorage.removeItem(slot)
  } catch {
    /* private mode: the copy stays until the browser clears it */
  }
}

/** Call once, before the first screen is shown. */
export async function wipeIfAsked(): Promise<void> {
  let name: string | null = null
  try {
    name = localStorage.getItem(KEY)
  } catch {
    return
  }
  if (!name) return
  try {
    await Dexie.delete(name)
    localStorage.removeItem(KEY)
  } catch {
    /* another tab still has it open: try again on the next start */
  }
}
