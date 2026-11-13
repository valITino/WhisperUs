// The actions of actions.ts, bound to the app's own database, store and cloud.
// Screens import from here.

import * as actions from './actions'
import { backend, db, store } from './app'
import type { Envelope, ID, Layer, LayerBodies, Reply, VoiceBody } from './types'

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
