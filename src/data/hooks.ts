import { useLiveQuery } from 'dexie-react-hooks'
import { db } from './app'
import { META } from './db'
import type { ID, Member } from './types'

/** Rows that are not soft-deleted. */
export const alive = <T extends { deletedAt: string | null }>(rows: T[]): T[] => rows.filter((r) => !r.deletedAt)

export function useMe(): { householdId: ID; memberId: ID; member: Member | undefined } | null | undefined {
  return useLiveQuery(async () => {
    const [householdId, memberId] = await Promise.all([db.getMeta<ID>(META.householdId), db.getMeta<ID>(META.memberId)])
    if (!householdId || !memberId) return null
    return { householdId, memberId, member: await db.members.get(memberId) }
  }, [])
}
