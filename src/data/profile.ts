// What one of the two shows the other: a profile page draws this. The other one's
// profile is what they show me; my own is what they see of me. Pure: rows in, a view out.
//
// It reads only the rows that travel (`notes`, `leanings`, `wishes`), never the diary. So
// what stands on a profile is exactly what has left its author's phone, part by part,
// and "this is what the other one sees of you" is true as written.

import type { AboutBody, CheckinBody, ID, ISO, Leaning, Note, OpenLean, Score5, Why, Wish } from './types'

export interface ShownNote<B> {
  id: ID
  /** checkin: the day and its half. about: the question's id. */
  ref: string
  at: ISO
  /** When the row last changed, by the cloud's clock: a changed answer is new again. */
  changedAt: ISO
  /** Only the parts that were opened. */
  body: B
}

/** An item of the list where both answered openly, from one person's side. */
export interface Common {
  item: string
  lean: OpenLean
  pull: Score5 | null
  /** Only when they chose to show it. */
  why: Why | null
  /** What the other of the two said to it. */
  otherLean: OpenLean
  /** When the second of the two said so. */
  since: ISO
}

export interface Shown {
  /** The newest check-in with something shown, or null. */
  checkin: ShownNote<CheckinBody> | null
  /** Answers to the questions about themselves, by question. */
  about: Map<string, ShownNote<AboutBody>>
  /** Newest first. A "not for me" is never here: it has no row. */
  common: Common[]
  /** What they wished for, newest first. */
  wishes: Wish[]
}

export interface ProfileRows {
  notes: readonly Note[]
  leanings: readonly Leaning[]
  wishes: readonly Wish[]
}

const newestFirst = (a: { at: ISO }, b: { at: ISO }): number => Date.parse(b.at) - Date.parse(a.at)

/** What `memberId` shows the other person in the room. */
export function shownBy(memberId: ID, rows: ProfileRows): Shown {
  const notes = rows.notes.filter((note) => note.memberId === memberId && !note.deletedAt && Object.keys(note.body).length > 0)
  const checkins = notes.filter((note) => note.kind === 'checkin').sort(newestFirst)
  const about = new Map<string, ShownNote<AboutBody>>()
  for (const note of notes) if (note.kind === 'about') about.set(note.ref, { id: note.id, ref: note.ref, at: note.at, changedAt: note.updatedAt, body: note.body as AboutBody })

  const live = rows.leanings.filter((row) => !row.deletedAt)
  const common: Common[] = []
  for (const own of live) {
    if (own.memberId !== memberId) continue
    const other = live.find((row) => row.memberId !== memberId && row.item === own.item)
    if (other) common.push({ item: own.item, lean: own.lean, pull: own.pull, why: own.why, otherLean: other.lean, since: own.createdAt > other.createdAt ? own.createdAt : other.createdAt })
  }
  common.sort((a, b) => Date.parse(b.since) - Date.parse(a.since))

  const first = checkins[0]
  return {
    checkin: first ? { id: first.id, ref: first.ref, at: first.at, changedAt: first.updatedAt, body: first.body as CheckinBody } : null,
    about,
    common,
    wishes: rows.wishes.filter((wish) => wish.authorId === memberId && !wish.deletedAt && wish.text !== '').sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)),
  }
}

/** Whether there is anything on a profile at all. */
export const showsNothing = (shown: Shown): boolean => shown.checkin === null && shown.about.size === 0 && shown.common.length === 0 && shown.wishes.length === 0
