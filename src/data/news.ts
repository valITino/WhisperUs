// What is new in the room, as one list. The news page, the bell on the room and the lines
// under it all read this. Pure: rows in, lines out.
//
// Three rules.
//   - A line says who and what kind of thing, never what is in it: not a wish's words,
//     not a decision, not a line from an envelope. It names where to look.
//   - There are no read receipts. Nothing here tells me that the other one has looked at
//     something of mine. Their answer is news; their reading is not.
//   - "New" stays until I have looked at the thing itself, wherever I get to it from. The
//     marks for that live on this phone only (they are about this screen, not about us).

import type { EnvelopeView } from './envelopes'
import type { Match } from './journal'
import type { ID, Idea, ISO, LayerKey, Note, Wish } from './types'

/**
 * ready: an envelope of the other one's is open for me.   sealed: one waits for its time.
 * answered: the other one answered an envelope of mine.
 * wished: the other one has a wish for me.   decided: they answered a wish of mine.
 * matched: the list holds things both of us answered openly.
 * about: the other one showed answers to the questions about themselves.
 * shown: the other one showed a check-in.   idea: they wrote something onto the list.
 */
export type NewsKind = 'ready' | 'sealed' | 'answered' | 'wished' | 'decided' | 'matched' | 'about' | 'shown' | 'idea'

export interface NewsItem {
  /** The same for the same thing, whatever its state. */
  id: string
  kind: NewsKind
  /** When it happened. */
  at: ISO
  /** The page that shows the thing itself. */
  to: string
  /** Not looked at yet. */
  fresh: boolean
  /** How many things the line stands for (things in common, answers, items). 1 for everything else. */
  count: number
}

/** What I have looked at. All of it is kept on this phone only. */
export interface Seen {
  /** Answers to my envelopes: { envelopeId: repliedAt }. */
  replies: Readonly<Record<ID, string>>
  /** Answers to my wishes: { wishId: answeredAt }. */
  wishAnswers: Readonly<Record<ID, string>>
  /** Wishes for me that I have opened. */
  wishes: Readonly<Record<ID, true>>
  /** Items of the list I have seen as "in common". */
  matches: readonly string[]
  /** I have looked at what the other one showed about themselves, up to this change of theirs. */
  aboutUntil: ISO | null
  /** I have looked at what the other one wrote onto the list, up to this one. */
  ideasUntil: ISO | null
}

export const NOTHING_SEEN: Seen = { replies: {}, wishAnswers: {}, wishes: {}, matches: [], aboutUntil: null, ideasUntil: null }

export interface NewsRows {
  meId: ID
  /** Every envelope in the room, as this phone sees it. */
  views: readonly EnvelopeView[]
  keys: readonly LayerKey[]
  wishes: readonly Wish[]
  /** The items both answered openly (journal.matchesOf). */
  matches: readonly Match[]
  notes: readonly Note[]
  ideas: readonly Idea[]
  seen: Seen
}

/** What is older than this and looked at is no longer listed. */
export const NEWS_DAYS = 30
/** And never more than this many lines of what has been looked at. */
export const NEWS_EARLIER = 20

const time = (at: ISO): number => Date.parse(at)
/** The latest of some moments. Null for none. */
export function latest(moments: readonly ISO[]): ISO | null {
  let best: ISO | null = null
  for (const moment of moments) if (best === null || time(moment) > time(best)) best = moment
  return best
}
const after = (moment: ISO, until: ISO | null): boolean => until === null || time(moment) > time(until)

/** The moment an envelope opened for the one it is for: the latest key they were handed. */
function openedAt(view: EnvelopeView, keys: readonly LayerKey[]): ISO {
  const handed = keys.filter((key) => key.envelopeId === view.envelope.id && key.key !== '' && !key.deletedAt).map((key) => key.opensAt)
  return latest(handed) ?? latest(Object.values(view.envelope.seen).filter((at): at is ISO => Boolean(at))) ?? view.envelope.createdAt
}

/** The other one's rows that show something: not taken back, not emptied. */
export const shownNotes = (notes: readonly Note[], meId: ID, kind: Note['kind']): Note[] => notes.filter((note) => note.memberId !== meId && note.kind === kind && !note.deletedAt && Object.keys(note.body).length > 0)
export const theirIdeas = (ideas: readonly Idea[], meId: ID): Idea[] => ideas.filter((idea) => idea.authorId !== meId && !idea.deletedAt && idea.label !== '')

/**
 * Everything worth a line, newest first: all that is new, and what has been looked at
 * from the last NEWS_DAYS days (NEWS_EARLIER lines at most).
 */
export function newsOf(rows: NewsRows, now: number): NewsItem[] {
  const { meId, seen } = rows
  const out: NewsItem[] = []

  for (const view of rows.views) {
    const { envelope } = view
    if (view.mine) {
      // My envelope: news once it is answered. That it was opened is not for this list.
      if (envelope.reply) out.push({ id: `answered:${envelope.id}`, kind: 'answered', at: envelope.reply.at, to: `/envelope/${envelope.id}`, fresh: seen.replies[envelope.id] !== envelope.reply.at, count: 1 })
      continue
    }
    if (view.standing === 'waiting') out.push({ id: `envelope:${envelope.id}`, kind: 'sealed', at: envelope.createdAt, to: `/envelope/${envelope.id}`, fresh: false, count: 1 })
    else out.push({ id: `envelope:${envelope.id}`, kind: 'ready', at: openedAt(view, rows.keys), to: `/envelope/${envelope.id}`, fresh: view.standing === 'ready', count: 1 })
  }

  for (const wish of rows.wishes) {
    if (wish.deletedAt || wish.text === '') continue
    if (wish.authorId !== meId) out.push({ id: `wished:${wish.id}`, kind: 'wished', at: wish.createdAt, to: `/wishes/${wish.id}`, fresh: !wish.answer && !seen.wishes[wish.id], count: 1 })
    else if (wish.answer) out.push({ id: `decided:${wish.id}`, kind: 'decided', at: wish.answer.at, to: `/wishes/${wish.id}`, fresh: seen.wishAnswers[wish.id] !== wish.answer.at, count: 1 })
  }

  // One line for the list: what is new in common, or, once looked at, how much there is.
  const unseen = rows.matches.filter((match) => !seen.matches.includes(match.item))
  const common = unseen.length > 0 ? unseen : rows.matches
  const since = latest(common.map((match) => match.since))
  if (since) out.push({ id: 'matched', kind: 'matched', at: since, to: '/list', fresh: unseen.length > 0, count: common.length })

  // One line for what the other one showed about themselves. A changed answer is new again.
  const about = shownNotes(rows.notes, meId, 'about')
  const newAbout = about.filter((note) => after(note.updatedAt, seen.aboutUntil))
  const told = newAbout.length > 0 ? newAbout : about
  const toldAt = latest(told.map((note) => note.updatedAt))
  if (toldAt) out.push({ id: 'about', kind: 'about', at: toldAt, to: '/profile/partner', fresh: newAbout.length > 0, count: told.length })

  // Their newest check-in with something shown. It is on the room already, so it is never "new".
  const checkins = shownNotes(rows.notes, meId, 'checkin')
  const newest = latest(checkins.map((note) => note.at))
  if (newest) out.push({ id: 'shown', kind: 'shown', at: newest, to: '/profile/partner', fresh: false, count: 1 })

  const ideas = theirIdeas(rows.ideas, meId)
  const newIdeas = ideas.filter((idea) => after(idea.updatedAt, seen.ideasUntil))
  const written = newIdeas.length > 0 ? newIdeas : ideas
  const writtenAt = latest(written.map((idea) => idea.updatedAt))
  if (writtenAt) out.push({ id: 'idea', kind: 'idea', at: writtenAt, to: '/list', fresh: newIdeas.length > 0, count: written.length })

  out.sort((a, b) => time(b.at) - time(a.at))
  const oldest = now - NEWS_DAYS * 86_400_000
  let earlier = 0
  return out.filter((item) => item.fresh || (time(item.at) >= oldest && ++earlier <= NEWS_EARLIER))
}

/** How many things have not been looked at yet: the number on the bell. */
export const freshCount = (items: readonly NewsItem[]): number => items.reduce((sum, item) => sum + (item.fresh ? item.count : 0), 0)
