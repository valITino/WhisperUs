// The actions of actions.ts, bound to the app's own database, store and cloud.
// Screens import from here.

import * as actions from './actions'
import * as journal from './journal'
import * as wishes from './wishes'
import { backend, db, store } from './app'
import type { AboutBody, AboutPart, Envelope, ID, Layer, LayerBodies, LeaningBody, Reply, VoiceBody } from './types'

const kit: actions.Kit = { db, store, backend }

export type { Draft, ProfileChanges, Recording } from './actions'
export { ActionError, TEASER_MAX, WORDS_MAX } from './actions'

export const sealEnvelope = (draft: actions.Draft) => actions.sealEnvelope(kit, draft)
export const openLayers = (envelopeId: ID, layers: readonly Layer[]) => actions.openLayers(kit, envelopeId, layers)
export const takeBack = (envelopeId: ID) => actions.takeBack(kit, envelopeId)
export const readLayer = <L extends Layer>(envelope: Envelope, layer: L): Promise<LayerBodies[L] | null> => actions.readLayer(kit, envelope, layer)
export const readVoice = (envelope: Envelope, voice: VoiceBody) => actions.readVoice(kit, envelope, voice)
export const markSeen = (envelopeId: ID, layers: readonly Layer[]) => actions.markSeen(kit, envelopeId, layers)
export const answer = (envelopeId: ID, reply: Omit<Reply, 'at'>) => actions.answer(kit, envelopeId, reply)
export const updateMyProfile = (changes: actions.ProfileChanges) => actions.updateMyProfile(kit, changes)
export const renameRoom = (name: string) => actions.renameRoom(kit, name)
export const updateMyPrefs = (changes: Parameters<typeof actions.updateMyPrefs>[1]) => actions.updateMyPrefs(kit, changes)

// What I note about myself (journal.ts), wishes and the list (wishes.ts).
export type { CheckinInput } from './journal'
export type { WishAnswerDraft, WishDraft } from './wishes'
export { IDEA_MAX, WISH_MAX } from './wishes'

export const saveCheckin = (input: journal.CheckinInput) => journal.saveCheckin(kit, input)
export const removeCheckin = (id: ID) => journal.removeCheckin(kit, id)
export const saveAbout = (question: string, answer: AboutBody, share: readonly AboutPart[]) => journal.saveAbout(kit, question, answer, share)
export const saveLeaning = (item: string, answer: LeaningBody | null, options?: { showWhy?: boolean }) => journal.saveLeaning(kit, item, answer, options)
export const makeWish = (draft: wishes.WishDraft) => wishes.makeWish(kit, draft)
export const changeWish = (id: ID, draft: wishes.WishDraft) => wishes.changeWish(kit, id, draft)
export const takeBackWish = (id: ID) => wishes.takeBackWish(kit, id)
export const answerWish = (id: ID, answer: wishes.WishAnswerDraft) => wishes.answerWish(kit, id, answer)
export const addIdea = (label: string, section: string) => wishes.addIdea(kit, label, section)
export const removeIdea = (id: ID) => wishes.removeIdea(kit, id)
