// What screens read. Every hook returns `undefined` while loading and updates live,
// also at the moment a timed envelope opens.

import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useMemo, useState } from 'react'
import { db } from './app'
import { META } from './db'
import { byAttention, nextChange, viewOf, type EnvelopeView } from './envelopes'
import { alive } from './hooks'
import { keptHere, matchesOf, mine, myLeanings, slotOf, theirs, type Match, type MyLeaning, type Noted, type Slot } from './journal'
import { freshCount, latest, newsOf, shownNotes, theirIdeas, type NewsItem } from './news'
import { shownBy, type Shown } from './profile'
import { describeRefused, type RefusedChange } from './refused'
import { MAX_UPLOAD_ATTEMPTS } from './sync'
import type { AboutBody, CheckinBody, Household, ID, Member } from './types'

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

// ------------------------------------------------ closer: notes, the list, wishes --

interface CloserRows {
  meId: ID
  diary: import('./db').DiaryEntry[]
  notes: import('./types').Note[]
  leanings: import('./types').Leaning[]
  ideas: import('./types').Idea[]
  wishes: import('./types').Wish[]
  answersSeen: Record<ID, string>
  wishesSeen: Record<ID, true>
  matchesSeen: string[]
  aboutSeen: string | null
  ideasSeen: string | null
}

function useCloserRows(): CloserRows | null | undefined {
  return useLiveQuery(async () => {
    const meId = await db.getMeta<ID>(META.memberId)
    if (!meId) return null
    const [diary, notes, leanings, ideas, wishes, answersSeen, wishesSeen, matchesSeen, aboutSeen, ideasSeen] = await Promise.all([
      db.diary.toArray(),
      db.notes.toArray(),
      db.leanings.toArray(),
      db.ideas.toArray(),
      db.wishes.toArray(),
      db.getMeta<Record<ID, string>>(META.answersSeen),
      db.getMeta<Record<ID, true>>(META.wishesSeen),
      db.getMeta<string[]>(META.matchesSeen),
      db.getMeta<string>(META.aboutSeen),
      db.getMeta<string>(META.ideasSeen),
    ])
    return { meId, diary, notes, leanings, ideas, wishes, answersSeen: answersSeen ?? {}, wishesSeen: wishesSeen ?? {}, matchesSeen: matchesSeen ?? [], aboutSeen: aboutSeen ?? null, ideasSeen: ideasSeen ?? null }
  }, [])
}

export interface Checkins {
  /** Everything I noted, newest first: whole on the phone it was noted on. */
  mine: Noted<CheckinBody>[]
  /** Only what I chose to show: what the other one sees of me. */
  mineShown: Noted<CheckinBody>[]
  /** What the other one chose to show me. */
  theirs: Noted<CheckinBody>[]
}

export function useCheckins(): Checkins | undefined {
  const rows = useCloserRows()
  return useMemo(() => {
    if (!rows) return rows === null ? { mine: [], mineShown: [], theirs: [] } : undefined
    return {
      mine: mine<CheckinBody>('checkin', rows.diary, rows.notes, rows.meId),
      mineShown: mine<CheckinBody>('checkin', [], rows.notes, rows.meId),
      theirs: theirs<CheckinBody>('checkin', rows.notes, rows.meId),
    }
  }, [rows])
}

/** The half of the day it is now, on the room's clock. Changes by itself at four and at two. */
export function useSlot(): Slot {
  const [slot, setSlot] = useState(() => slotOf(new Date()))
  useEffect(() => {
    const timer = setInterval(() => {
      const now = slotOf(new Date())
      setSlot((was) => (was.day === now.day && was.half === now.half ? was : now))
    }, 30_000)
    return () => clearInterval(timer)
  }, [])
  return slot
}

/** My answers to the questions about myself and the other one's shown answers, by question. */
export function useAbout(): { mine: Map<string, Noted<AboutBody>>; theirs: Map<string, Noted<AboutBody>> } | undefined {
  const rows = useCloserRows()
  return useMemo(() => {
    if (!rows) return rows === null ? { mine: new Map(), theirs: new Map() } : undefined
    const byRef = (list: Noted<AboutBody>[]) => new Map(list.map((entry) => [entry.ref, entry] as const))
    return { mine: byRef(mine<AboutBody>('about', rows.diary, rows.notes, rows.meId)), theirs: byRef(theirs<AboutBody>('about', rows.notes, rows.meId)) }
  }, [rows])
}

export interface ListState {
  /** What I said to each item. */
  mine: Map<string, MyLeaning>
  /** The items both answered openly, newest first. */
  matches: Match[]
  /** Matches I have not looked at yet. */
  fresh: Set<string>
  /** What the two of us wrote onto the list. */
  ideas: import('./types').Idea[]
  meId: ID
}

export function useList(): ListState | undefined {
  const rows = useCloserRows()
  return useMemo(() => {
    if (!rows) return undefined
    const matches = matchesOf(rows.leanings, rows.meId)
    return {
      mine: myLeanings(rows.diary, rows.leanings, rows.meId),
      matches,
      fresh: new Set(matches.map((m) => m.item).filter((item) => !rows.matchesSeen.includes(item))),
      ideas: alive(rows.ideas).filter((idea) => idea.label !== '').sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
      meId: rows.meId,
    }
  }, [rows])
}

/** I have looked at what we have in common. */
export async function markMatchesSeen(items: readonly string[]): Promise<void> {
  const seen = (await db.getMeta<string[]>(META.matchesSeen)) ?? []
  const next = [...new Set([...seen, ...items])]
  if (next.length !== seen.length) await db.setMeta(META.matchesSeen, next)
}

export interface WishesState {
  /** The other one's wishes: the ones waiting for my answer first, then newest first. */
  forMe: import('./types').Wish[]
  fromMe: import('./types').Wish[]
  /** Wishes for me I have not opened yet. */
  unopened: Set<ID>
  /** Wishes of mine whose answer I have not looked at yet. */
  freshAnswers: Set<ID>
  meId: ID
}

export function useWishes(): WishesState | undefined {
  const rows = useCloserRows()
  return useMemo(() => {
    if (!rows) return undefined
    const live = alive(rows.wishes).filter((wish) => wish.text !== '')
    const newest = (a: import('./types').Wish, b: import('./types').Wish) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0)
    const forMe = live.filter((wish) => wish.authorId !== rows.meId).sort((a, b) => Number(Boolean(a.answer)) - Number(Boolean(b.answer)) || newest(a, b))
    const fromMe = live.filter((wish) => wish.authorId === rows.meId).sort(newest)
    return {
      forMe,
      fromMe,
      unopened: new Set(forMe.filter((wish) => !wish.answer && !rows.wishesSeen[wish.id]).map((wish) => wish.id)),
      freshAnswers: new Set(fromMe.filter((wish) => wish.answer && rows.answersSeen[wish.id] !== wish.answer.at).map((wish) => wish.id)),
      meId: rows.meId,
    }
  }, [rows])
}

/** One wish. Null when it does not exist (any more). */
export function useWish(id: ID): { wish: import('./types').Wish; mine: boolean } | null | undefined {
  const wishes = useWishes()
  if (!wishes) return undefined
  const wish = [...wishes.forMe, ...wishes.fromMe].find((w) => w.id === id)
  return wish ? { wish, mine: wish.authorId === wishes.meId } : null
}

/** I have opened this wish of the other one's. */
export async function markWishSeen(id: ID): Promise<void> {
  const seen = (await db.getMeta<Record<ID, true>>(META.wishesSeen)) ?? {}
  if (!seen[id]) await db.setMeta(META.wishesSeen, { ...seen, [id]: true })
}

/** I have looked at the answer to this wish of mine. */
export async function markWishAnswerSeen(id: ID, answeredAt: string): Promise<void> {
  const seen = (await db.getMeta<Record<ID, string>>(META.answersSeen)) ?? {}
  if (seen[id] !== answeredAt) await db.setMeta(META.answersSeen, { ...seen, [id]: answeredAt })
}

// ----------------------------------------------------------------- the news --

export interface News {
  /** Everything worth a line, newest first. */
  items: NewsItem[]
  /** How many things have not been looked at yet: the number on the bell. */
  fresh: number
  /** The same number, by the tab that leads to them. Together they are the bell's. */
  byTab: { home: number; wishes: number }
}

/** Wishes and the list are under "Wishes"; envelopes and the other one's profile are reached from the room. */
const UNDER_WISHES: readonly NewsItem['kind'][] = ['wished', 'decided', 'matched', 'idea']

/** What is new in the room, and what was lately. One list for the bell, the room and the news page. */
export function useNews(): News | undefined {
  const views = useViews()
  const rows = useRows()
  const closer = useCloserRows()
  const replies = useLiveQuery(async () => (await db.getMeta<SeenAnswers>(ANSWERS_SEEN)) ?? {}, [])
  return useMemo(() => {
    if (!views || rows === undefined || closer === undefined || !replies) return undefined
    if (!rows || !closer) return { items: [], fresh: 0, byTab: { home: 0, wishes: 0 } }
    const items = newsOf(
      {
        meId: closer.meId,
        views,
        keys: rows.keys,
        wishes: closer.wishes,
        matches: matchesOf(closer.leanings, closer.meId),
        notes: closer.notes,
        ideas: closer.ideas,
        seen: { replies, wishAnswers: closer.answersSeen, wishes: closer.wishesSeen, matches: closer.matchesSeen, aboutUntil: closer.aboutSeen, ideasUntil: closer.ideasSeen },
      },
      Date.now(),
    )
    const wishes = freshCount(items.filter((item) => UNDER_WISHES.includes(item.kind)))
    const fresh = freshCount(items)
    return { items, fresh, byTab: { home: fresh - wishes, wishes } }
  }, [views, rows, closer, replies])
}

/** I have looked at what the other one showed about themselves (their profile was on screen). */
export async function markAboutSeen(): Promise<void> {
  const meId = await db.getMeta<ID>(META.memberId)
  if (!meId) return
  const until = latest(shownNotes(await db.notes.toArray(), meId, 'about').map((note) => note.updatedAt))
  if (until && until !== (await db.getMeta<string>(META.aboutSeen))) await db.setMeta(META.aboutSeen, until)
}

/** I have looked at what the other one wrote onto the list (the list was on screen). */
export async function markIdeasSeen(): Promise<void> {
  const meId = await db.getMeta<ID>(META.memberId)
  if (!meId) return
  const until = latest(theirIdeas(await db.ideas.toArray(), meId).map((idea) => idea.updatedAt))
  if (until && until !== (await db.getMeta<string>(META.ideasSeen))) await db.setMeta(META.ideasSeen, until)
}

// -------------------------------------------------------------- the profiles --

export interface Profile {
  /** Whose profile it is. */
  who: Member
  /** The other of the two. Null while the second seat is empty. */
  other: Member | null
  mine: boolean
  /** What they show the other one: exactly what has left their phone. */
  shown: Shown
  /** What they sealed, what asks for attention first. */
  envelopes: EnvelopeView[]
  /** The answers about themselves I have not looked at yet, by question (the other one's profile only). */
  freshAbout: Set<string>
}

/**
 * A profile to look at: mine (what the other one sees of me) or the other one's (what
 * they show me). Null when there is nobody to show (no partner yet, or not logged in).
 */
export function useProfile(side: 'mine' | 'theirs'): Profile | null | undefined {
  const room = useRoom()
  const closer = useCloserRows()
  const views = useViews()
  return useMemo(() => {
    if (room === undefined || closer === undefined || !views) return undefined
    if (!room || !closer) return null
    const who = side === 'mine' ? room.me : room.partner
    if (!who) return null
    const shown = shownBy(who.id, closer)
    const until = closer.aboutSeen === null ? null : Date.parse(closer.aboutSeen)
    return {
      who,
      other: side === 'mine' ? room.partner : room.me,
      mine: side === 'mine',
      shown,
      envelopes: views.filter((view) => view.envelope.authorId === who.id).sort(byAttention),
      freshAbout: new Set(side === 'mine' ? [] : [...shown.about.values()].filter((answer) => until === null || Date.parse(answer.changedAt) > until).map((answer) => answer.ref)),
    }
  }, [room, closer, views, side])
}

/** How many entries of the diary hold something that exists on this phone only. */
export async function diaryOnlyHere(): Promise<number> {
  return db.diary.filter(keptHere).count()
}
