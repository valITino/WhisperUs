// Wishes, and the items the two of them write onto the list.
//
// A wish is said, not sealed: the other one reads it as soon as it is sent and answers
// with a decision, how it lands, and a why. Its author writes the wish, the other one
// writes the answer, and the cloud keeps each to their side (0004_closer.sql).

import { ActionError, stamp, who, type Kit } from './actions'
import { newId, nowIso, type Decision, type Heat, type ID, type Score5, type Why, type Wish, type WishMode } from './types'
import { cleanWhy } from './why'

export const WISH_MAX = 400
export const IDEA_MAX = 60

export interface WishDraft {
  text: string
  /** The item of the list it belongs to, if it grew out of one. */
  item: string | null
  mode: WishMode
  want: Score5 | null
  why: Why
}

const tidy = (draft: WishDraft) => ({ text: draft.text.trim().slice(0, WISH_MAX), item: draft.item, mode: draft.mode, want: draft.want, why: cleanWhy(draft.why) })

/** Say a wish. The other one can read it from now on. Resolves with its id. */
export async function makeWish(kit: Kit, draft: WishDraft): Promise<ID> {
  const { householdId, memberId } = await who(kit)
  const clean = tidy(draft)
  if (!clean.text) throw new ActionError('no_words')
  const id = newId()
  await kit.store.put('wishes', { id, ...stamp(householdId, nowIso()), authorId: memberId, ...clean, answer: null })
  return id
}

async function wishOf(kit: Kit, id: ID): Promise<{ wish: Wish; memberId: ID }> {
  const { memberId } = await who(kit)
  const wish = await kit.db.wishes.get(id)
  if (!wish || wish.deletedAt) throw new ActionError('not_here')
  return { wish, memberId }
}

/** Change my wish while it has not been answered. What was answered stays as it was answered. */
export async function changeWish(kit: Kit, id: ID, draft: WishDraft): Promise<void> {
  const { wish, memberId } = await wishOf(kit, id)
  if (wish.authorId !== memberId) throw new ActionError('not_yours')
  if (wish.answer) throw new ActionError('answered')
  const clean = tidy(draft)
  if (!clean.text) throw new ActionError('no_words')
  await kit.store.patch('wishes', id, clean)
}

/** Take my wish back, answered or not. The cloud forgets its words and the answer. */
export async function takeBackWish(kit: Kit, id: ID): Promise<void> {
  const { wish, memberId } = await wishOf(kit, id)
  if (wish.authorId !== memberId) throw new ActionError('not_yours')
  await kit.store.remove('wishes', id)
}

export interface WishAnswerDraft {
  decision: Decision | null
  taps: string[]
  heat: Heat | null
  why: Why
}

/** Answer the other one's wish. Answering again replaces the answer: a "not now" may become a "yes". */
export async function answerWish(kit: Kit, id: ID, answer: WishAnswerDraft): Promise<void> {
  const { wish, memberId } = await wishOf(kit, id)
  if (wish.authorId === memberId) throw new ActionError('not_yours')
  // A wish that asks for a decision gets one. A fantasy that may stay one needs none.
  if (wish.mode === 'do' && !answer.decision) throw new ActionError('no_decision')
  await kit.store.patch('wishes', id, { answer: { decision: answer.decision, taps: [...new Set(answer.taps)], heat: answer.heat, why: cleanWhy(answer.why), at: nowIso() } })
}

/** Write something of our own onto the list. Both see it there; nobody sees what the other one answers. */
export async function addIdea(kit: Kit, label: string, section: string): Promise<ID> {
  const { householdId, memberId } = await who(kit)
  const clean = label.trim().replace(/\s+/g, ' ').slice(0, IDEA_MAX)
  if (!clean) throw new ActionError('no_words')
  const id = newId()
  await kit.store.put('ideas', { id, ...stamp(householdId, nowIso()), authorId: memberId, label: clean, section })
  return id
}

/** Take something I wrote off the list again. */
export async function removeIdea(kit: Kit, id: ID): Promise<void> {
  const { memberId } = await who(kit)
  const idea = await kit.db.ideas.get(id)
  if (!idea || idea.deletedAt) return
  if (idea.authorId !== memberId) throw new ActionError('not_yours')
  await kit.store.remove('ideas', id)
}
