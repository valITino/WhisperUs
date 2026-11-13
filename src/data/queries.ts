// What screens read. Every hook returns `undefined` while loading and updates live,
// also at the moment a timed envelope opens.

import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useState } from 'react'
import { db } from './app'
import { META } from './db'
import { byAttention, nextChange, viewOf, type EnvelopeView } from './envelopes'
import { alive } from './hooks'
import { describeRefused, type RefusedChange } from './refused'
import { MAX_UPLOAD_ATTEMPTS } from './sync'
import type { Household, ID, Member } from './types'

export function useHousehold(): Household | undefined {
  return useLiveQuery(async () => (await db.households.toArray()).find((h) => !h.deletedAt), [])
}

export function useMembers(): Member[] | undefined {
  return useLiveQuery(async () => alive(await db.members.toArray()).sort((a, b) => a.createdAt.localeCompare(b.createdAt)), [])
}

/** The other person in the room, or null while you are still alone. */
export function usePartner(): Member | null | undefined {
  return useLiveQuery(async () => {
    const mine = await db.getMeta<ID>(META.memberId)
    return alive(await db.members.toArray()).find((m) => m.id !== mine) ?? null
  }, [])
}

/** Changes the cloud refused and that wait for a decision on the Sync page, oldest first. */
export function useRefusedChanges(): RefusedChange[] | undefined {
  return useLiveQuery(async () => (await db.deadLetters.orderBy('seq').toArray()).map(describeRefused), [])
}

/** Sealed files the cloud refused so often that they wait for "Try again". */
export function useStuckUploads(): number | undefined {
  return useLiveQuery(async () => (await db.blobs.where('pending').equals(1).toArray()).filter((entry) => entry.attempts >= MAX_UPLOAD_ATTEMPTS).length, [])
}

export interface RoomPeople {
  household: Household | undefined
  me: Member
  /** Null while the second seat is still empty. */
  partner: Member | null
}

/** The room and the two people in it. Null when this device is not logged in. */
export function useRoom(): RoomPeople | null | undefined {
  return useLiveQuery(async () => {
    const [householdId, memberId] = await Promise.all([db.getMeta<ID>(META.householdId), db.getMeta<ID>(META.memberId)])
    if (!householdId || !memberId) return null
    const members = (await db.members.where('householdId').equals(householdId).toArray()).filter((m) => !m.deletedAt)
    const me = members.find((m) => m.id === memberId)
    if (!me) return null
    return { household: await db.households.get(householdId), me, partner: members.find((m) => m.id !== memberId) ?? null }
  }, [])
}

/** Paints the screen again at the moment `at` comes (the next opening). */
function useWake(at: number | null): void {
  const [, setTick] = useState(0)
  useEffect(() => {
    if (at === null) return
    const wait = at - Date.now() + 300
    // (Timers of more than about 24 days overflow. The page will have been reopened by then.)
    const timer = setTimeout(() => setTick((n) => n + 1), Math.min(Math.max(wait, 0), 2 ** 31 - 1))
    return () => clearTimeout(timer)
  }, [at])
}

interface Rows {
  meId: ID
  envelopes: import('./types').Envelope[]
  keys: import('./types').LayerKey[]
  vault: import('./db').VaultEntry[]
}

function useRows(): Rows | null | undefined {
  return useLiveQuery(async () => {
    const meId = await db.getMeta<ID>(META.memberId)
    if (!meId) return null
    const [envelopes, keys, vault] = await Promise.all([db.envelopes.toArray(), db.keys.toArray(), db.vault.toArray()])
    return { meId, envelopes: envelopes.filter((e) => !e.deletedAt), keys, vault }
  }, [])
}

function useViews(): EnvelopeView[] | undefined {
  const rows = useRows()
  const [next, setNext] = useState<number | null>(null)
  useWake(next)
  // Read the clock on every paint: rows that just arrived are judged by the time it is now.
  const now = Date.now()
  const views = rows ? rows.envelopes.map((envelope) => viewOf(envelope, rows.meId, rows, now)) : rows === null ? [] : undefined
  const upcoming = views ? nextChange(views, now) : null
  useEffect(() => setNext(upcoming), [upcoming])
  return views
}

/** Every envelope in the room, what asks for attention first. */
export function useEnvelopes(): { forMe: EnvelopeView[]; fromMe: EnvelopeView[] } | undefined {
  const views = useViews()
  if (!views) return undefined
  const sorted = [...views].sort(byAttention)
  return { forMe: sorted.filter((v) => !v.mine), fromMe: sorted.filter((v) => v.mine) }
}

/** One envelope. Null when it does not exist (any more). */
export function useEnvelope(id: ID): EnvelopeView | null | undefined {
  const views = useViews()
  if (!views) return undefined
  return views.find((v) => v.envelope.id === id) ?? null
}

// ---------------------------------------------------------- answers I have seen --
//
// Which answers to my envelopes I have looked at, so that a new one can be pointed out.
// Kept on this phone only: it is about this screen, not about the two of us.

const ANSWERS_SEEN = 'answers.seen'
type SeenAnswers = Record<ID, string>

/** The envelopes of mine whose answer I have not looked at yet. */
export function useNewAnswers(): Set<ID> | undefined {
  const views = useViews()
  const seen = useLiveQuery(async () => (await db.getMeta<SeenAnswers>(ANSWERS_SEEN)) ?? {}, [])
  if (!views || !seen) return undefined
  return new Set(views.filter((v) => v.mine && v.envelope.reply && seen[v.envelope.id] !== v.envelope.reply.at).map((v) => v.envelope.id))
}

/** I have looked at this answer. */
export async function markAnswerSeen(envelopeId: ID, repliedAt: string): Promise<void> {
  const seen = (await db.getMeta<SeenAnswers>(ANSWERS_SEEN)) ?? {}
  if (seen[envelopeId] === repliedAt) return
  await db.setMeta(ANSWERS_SEEN, { ...seen, [envelopeId]: repliedAt })
}

/** How many envelopes ask for my attention: something new to open, or a new answer. */
export function useReadyCount(): number {
  const views = useViews()
  const answers = useNewAnswers()
  return (views?.filter((v) => v.standing === 'ready').length ?? 0) + (answers?.size ?? 0)
}
