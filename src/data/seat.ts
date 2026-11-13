// Remembering, on this device, who is logged in.

import type { Membership } from './backend'
import { META, type AppDB } from './db'
import type { ID } from './types'

/**
 * Note who this device is logged in as, and start the next pull from the beginning.
 * When somebody else was logged in here before, their copy of the room and their
 * unsent changes are cleared first: one person's leftovers must not travel under
 * another person's name.
 */
export async function takeSeat(db: AppDB, membership: Membership): Promise<void> {
  await db.transaction('rw', db.tables, async () => {
    const before = await db.getMeta<ID>(META.memberId)
    if (before && before !== membership.memberId) await Promise.all(db.tables.map((t) => t.clear()))
    await db.setMeta(META.householdId, membership.householdId)
    await db.setMeta(META.memberId, membership.memberId)
    await db.meta.delete(META.cursor)
  })
}
