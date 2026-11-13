// Changes the cloud refused, said in a way a person can act on: what kind of thing it
// was, and whether it was new, an edit or a removal. The Sync page turns this into words;
// the sync engine holds the two ways out ("Try again", "Discard").
//
// Nothing from inside an envelope is ever shown here: only what kind of thing it was.

import type { DeadLetter } from './db'
import type { ISO, SyncTable } from './types'

export type RefusedThing = 'envelope' | 'key' | 'voice' | 'profile' | 'room'

export interface RefusedChange {
  /** Its number in the list of refused changes: what "Try again" and "Discard" ask for. */
  seq: number
  thing: RefusedThing
  /** new: it never reached the cloud. change: an edit. removal: a delete. */
  what: 'new' | 'change' | 'removal'
  failedAt: ISO
}

const THINGS: Record<SyncTable, RefusedThing> = {
  households: 'room',
  members: 'profile',
  envelopes: 'envelope',
  keys: 'key',
  media: 'voice',
}

export function describeRefused(letter: DeadLetter): RefusedChange {
  const what = letter.kind === 'put' ? 'new' : typeof letter.data.deletedAt === 'string' ? 'removal' : 'change'
  return { seq: letter.seq as number, thing: THINGS[letter.table], what, failedAt: letter.failedAt }
}
