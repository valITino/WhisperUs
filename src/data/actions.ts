// Everything a screen can do to an envelope. Screens call these and never write to the
// database themselves. Each function takes its tools (`Kit`) first, so the unit tests can
// run it against a database of their own; `src/data/do.ts` binds them to the app's.

import { mediaPath, type Backend } from './backend'
import { vaultId, type AppDB, type VaultEntry } from './db'
import { newKey, open, openBytes, seal, sealBytes } from './seal'
import type { Store } from './store'
import { LAYERS, newId, nowIso, type Member, type Envelope, type FeelBody, type Heat, type ID, type ISO, type Keep, type Layer, type LayerBodies, type OpenMode, type Reply, type Sealed, type VoiceBody, type Wants } from './types'

export interface Kit {
  db: AppDB
  store: Store
  backend: Backend
}

/** A voice note as the recorder hands it over. */
export interface Recording {
  blob: Blob
  mime: string
  seconds: number
}

/** Everything the booth collected before the seal goes on. */
export interface Draft {
  feel: FeelBody | null
  words: string | null
  voice: Recording | null
  teaser: string | null
  /** Show the heat on the outside of the envelope. */
  heatOutside: Heat | null
  wants: Wants
  keep: Keep
  openMode: OpenMode
  /** openMode "at": when. */
  opensAt: ISO | null
  /** The layers that open with the envelope. The others stay on this phone until opened by hand. */
  release: Layer[]
}

export const TEASER_MAX = 120
export const WORDS_MAX = 6000

export class ActionError extends Error {
  /** nothing_inside, nothing_opens, time_past, not_yours, not_here, not_open */
  constructor(readonly code: string) {
    super(code)
    this.name = 'ActionError'
  }
}

async function who(kit: Kit): Promise<{ householdId: ID; memberId: ID }> {
  const [householdId, memberId] = await Promise.all([kit.store.householdId(), kit.store.memberId()])
  if (!householdId || !memberId) throw new ActionError('not_here')
  return { householdId, memberId }
}

const stamp = (householdId: ID, at: ISO) => ({ householdId, createdAt: at, updatedAt: at, deletedAt: null })

/**
 * Seal an envelope. Every layer is encrypted here, on this phone, with a key of its own.
 * Layers that open with the envelope leave the phone sealed, and their keys go to the
 * cloud's safe with the opening time. Layers held back do not leave the phone at all.
 * Resolves with the new envelope's id.
 */
export async function sealEnvelope(kit: Kit, draft: Draft): Promise<ID> {
  const { householdId, memberId } = await who(kit)
  const words = draft.words?.trim().slice(0, WORDS_MAX) || null
  const present: Layer[] = LAYERS.filter((layer) => (layer === 'feel' ? draft.feel !== null : layer === 'words' ? words !== null : draft.voice !== null))
  if (present.length === 0) throw new ActionError('nothing_inside')
  const at = nowIso()
  let opensAt: ISO | null = null
  if (draft.openMode === 'at') {
    if (!draft.opensAt || Number.isNaN(Date.parse(draft.opensAt)) || Date.parse(draft.opensAt) <= Date.now()) throw new ActionError('time_past')
    opensAt = new Date(draft.opensAt).toISOString()
  }
  // Opening by hand means nothing opens with the envelope: everything waits here.
  const released = draft.openMode === 'hand' ? [] : present.filter((layer) => draft.release.includes(layer))
  if (draft.openMode !== 'hand' && released.length === 0) throw new ActionError('nothing_opens')

  const envelopeId = newId()
  const entries: VaultEntry[] = []
  let sound: { id: ID; data: Blob; bytes: number } | null = null
  for (const layer of present) {
    const key = newKey()
    let body: LayerBodies[Layer]
    if (layer === 'feel') body = draft.feel as FeelBody
    else if (layer === 'words') body = { text: words as string }
    else {
      const recording = draft.voice as Recording
      const { iv, sealed } = await sealBytes(key, new Uint8Array(await recording.blob.arrayBuffer()))
      sound = { id: newId(), data: new Blob([sealed], { type: 'application/octet-stream' }), bytes: sealed.byteLength }
      body = { mediaId: sound.id, mime: recording.mime, seconds: Math.max(1, Math.round(recording.seconds)), iv } satisfies VoiceBody
    }
    entries.push({ id: vaultId(envelopeId, layer), envelopeId, layer, key, sealed: await seal(key, body), held: !released.includes(layer) })
  }

  const layers: Partial<Record<Layer, Sealed>> = {}
  for (const entry of entries) if (!entry.held) layers[entry.layer] = entry.sealed
  const envelope: Envelope = {
    id: envelopeId,
    ...stamp(householdId, at),
    authorId: memberId,
    kind: 'confession',
    teaser: draft.teaser?.trim().slice(0, TEASER_MAX) || null,
    heatOutside: draft.heatOutside,
    wants: draft.wants,
    keep: draft.keep,
    openMode: draft.openMode,
    opensAt,
    layers,
    seen: {},
    reply: null,
  }

  const voiceOut = sound !== null && released.includes('voice')
  await kit.db.transaction('rw', kit.db.vault, kit.db.blobs, async () => {
    await kit.db.vault.bulkPut(entries)
    if (sound) await kit.db.blobs.put({ id: sound.id, data: sound.data, pending: voiceOut ? 1 : 0, attempts: 0 })
  })
  await kit.store.put('envelopes', envelope)
  for (const entry of entries) {
    if (entry.held) continue
    await kit.store.put('keys', { id: newId(), ...stamp(householdId, at), envelopeId, authorId: memberId, layer: entry.layer, key: entry.key, opensAt: opensAt ?? at })
  }
  if (sound && voiceOut) {
    await kit.store.put('media', { id: sound.id, ...stamp(householdId, at), envelopeId, authorId: memberId, kind: 'voice', bytes: sound.bytes, uploaded: false })
  }
  return envelopeId
}

async function mine(kit: Kit, envelopeId: ID): Promise<{ envelope: Envelope; householdId: ID; memberId: ID }> {
  const { householdId, memberId } = await who(kit)
  const envelope = await kit.db.envelopes.get(envelopeId)
  if (!envelope || envelope.deletedAt) throw new ActionError('not_here')
  if (envelope.authorId !== memberId) throw new ActionError('not_yours')
  return { envelope, householdId, memberId }
}

/**
 * Open layers for the other one, now. A layer that was held back leaves this phone at
 * this moment, sealed, and its key follows. A layer that was waiting for its time gets
 * its time moved to now. Layers that are open already are left alone.
 */
export async function openLayers(kit: Kit, envelopeId: ID, wanted: readonly Layer[]): Promise<Layer[]> {
  const { envelope, householdId, memberId } = await mine(kit, envelopeId)
  const at = nowIso()
  const kept = await kit.db.vault.where('envelopeId').equals(envelopeId).toArray()
  const keys = (await kit.db.keys.where('envelopeId').equals(envelopeId).toArray()).filter((k) => !k.deletedAt && k.key !== '')
  const opened: Layer[] = []
  const layers = { ...envelope.layers }
  const fresh: VaultEntry[] = []

  for (const layer of LAYERS) {
    if (!wanted.includes(layer)) continue
    const key = keys.find((k) => k.layer === layer)
    if (key) {
      if (Date.parse(key.opensAt) <= Date.now()) continue
      await kit.store.patch('keys', key.id, { opensAt: at })
      opened.push(layer)
      continue
    }
    const entry = kept.find((v) => v.layer === layer && v.held)
    if (!entry) continue
    layers[layer] = entry.sealed
    fresh.push(entry)
    opened.push(layer)
  }
  if (opened.length === 0) return []

  // The outside follows: once everything that was promised for later is open, no time is promised any more.
  const stillTimed = keys.some((k) => !wanted.includes(k.layer) && Date.parse(k.opensAt) > Date.now())
  await kit.store.patch('envelopes', envelopeId, { ...(fresh.length > 0 ? { layers } : {}), ...(envelope.opensAt && !stillTimed ? { opensAt: at } : {}) })
  for (const entry of fresh) {
    await kit.store.put('keys', { id: newId(), ...stamp(householdId, at), envelopeId, authorId: memberId, layer: entry.layer, key: entry.key, opensAt: at })
    await kit.db.vault.update(entry.id, { held: false })
    if (entry.layer !== 'voice') continue
    // The sound leaves with its layer.
    const voice = await open<VoiceBody>(entry.key, entry.sealed)
    const blob = await kit.db.blobs.get(voice.mediaId)
    if (!blob?.data) continue
    await kit.db.blobs.update(voice.mediaId, { pending: 1, attempts: 0 })
    await kit.store.put('media', { id: voice.mediaId, ...stamp(householdId, at), envelopeId, authorId: memberId, kind: 'voice', bytes: blob.data.size, uploaded: false })
  }
  return opened
}

/**
 * Take an envelope back, opened or not. The cloud forgets what was inside and both phones
 * clear it away. What has been read cannot be unread.
 */
export async function takeBack(kit: Kit, envelopeId: ID): Promise<void> {
  const { householdId } = await mine(kit, envelopeId)
  const media = (await kit.db.media.where('envelopeId').equals(envelopeId).primaryKeys()) as ID[]
  // A sound that never left this phone has no media row: find it through its layer.
  const voice = await kit.db.vault.get(vaultId(envelopeId, 'voice'))
  const held = voice ? await open<VoiceBody>(voice.key, voice.sealed).catch(() => null) : null
  await kit.store.remove('envelopes', envelopeId)
  await kit.db.transaction('rw', kit.db.vault, kit.db.blobs, async () => {
    await kit.db.vault.where('envelopeId').equals(envelopeId).delete()
    await kit.db.blobs.bulkDelete(held ? [...media, held.mediaId] : media)
  })
  // The sealed sound in cloud storage is useless without its key; removing it is tidiness.
  for (const id of media) void kit.backend.removeBlob(mediaPath(householdId, id)).catch(() => undefined)
}

/** What one layer holds, opened on this phone. Null when this phone cannot open it (yet). */
export async function readLayer<L extends Layer>(kit: Kit, envelope: Envelope, layer: L): Promise<LayerBodies[L] | null> {
  const kept = await kit.db.vault.get(vaultId(envelope.id, layer))
  const row = (await kit.db.keys.where('envelopeId').equals(envelope.id).toArray()).find((k) => k.layer === layer && k.key !== '' && !k.deletedAt)
  const key = row?.key ?? kept?.key
  const sealed = envelope.layers[layer] ?? kept?.sealed
  if (!key || !sealed) return null
  return open<LayerBodies[L]>(key, sealed)
}

/** The sound of a voice note, opened. Null while the sealed file has not arrived on this phone. */
export async function readVoice(kit: Kit, envelope: Envelope, voice: VoiceBody): Promise<Blob | null> {
  const kept = await kit.db.vault.get(vaultId(envelope.id, 'voice'))
  const row = (await kit.db.keys.where('envelopeId').equals(envelope.id).toArray()).find((k) => k.layer === 'voice' && k.key !== '' && !k.deletedAt)
  const key = row?.key ?? kept?.key
  const entry = await kit.db.blobs.get(voice.mediaId)
  if (!key || !entry?.data) return null
  const bytes = await openBytes(key, voice.iv, new Uint8Array(await entry.data.arrayBuffer()))
  return new Blob([bytes], { type: voice.mime })
}

/**
 * The other one opens layers for the first time (breaks the seal). For an envelope that
 * opens once, this is the one opening: the cloud burns those layers, and this phone
 * forgets their keys and their sound. Whatever is on screen stays until the page is left.
 */
export async function markSeen(kit: Kit, envelopeId: ID, layers: readonly Layer[]): Promise<void> {
  const { memberId, householdId } = await who(kit)
  const envelope = await kit.db.envelopes.get(envelopeId)
  if (!envelope || envelope.deletedAt) throw new ActionError('not_here')
  if (envelope.authorId === memberId) return
  const at = nowIso()
  const seen = { ...envelope.seen }
  const first = layers.filter((layer) => !seen[layer])
  if (first.length === 0) return
  for (const layer of first) seen[layer] = at
  await kit.store.patch('envelopes', envelopeId, { seen })
  if (envelope.keep !== 'once') return

  const keys = (await kit.db.keys.where('envelopeId').equals(envelopeId).toArray()).filter((k) => first.includes(k.layer))
  const media = first.includes('voice') ? ((await kit.db.media.where('envelopeId').equals(envelopeId).primaryKeys()) as ID[]) : []
  await kit.db.transaction('rw', kit.db.envelopes, kit.db.keys, kit.db.blobs, async () => {
    const current = await kit.db.envelopes.get(envelopeId)
    if (current) {
      const rest = { ...current.layers }
      for (const layer of first) delete rest[layer]
      await kit.db.envelopes.update(envelopeId, { layers: rest })
    }
    await kit.db.keys.bulkDelete(keys.map((k) => k.id))
    await kit.db.blobs.bulkDelete(media)
  })
  for (const id of media) void kit.backend.removeBlob(mediaPath(householdId, id)).catch(() => undefined)
}

/** Answer an envelope the other one opened for me. Answering again replaces the answer. */
export async function answer(kit: Kit, envelopeId: ID, reply: Omit<Reply, 'at'>): Promise<void> {
  const { memberId } = await who(kit)
  const envelope = await kit.db.envelopes.get(envelopeId)
  if (!envelope || envelope.deletedAt) throw new ActionError('not_here')
  if (envelope.authorId === memberId) throw new ActionError('not_yours')
  if (Object.keys(envelope.seen).length === 0) throw new ActionError('not_open')
  await kit.store.patch('envelopes', envelopeId, { reply: { ...reply, at: envelope.reply?.at ?? nowIso() } })
}


// ---------------------------------------------------------------- profile --

/** The profile fields a person may change about themselves. */
export type ProfileChanges = Partial<Pick<Member, 'name' | 'avatar' | 'color' | 'accessory' | 'status' | 'prefs'>>

export async function updateMyProfile(kit: Kit, changes: ProfileChanges): Promise<void> {
  const { memberId } = await who(kit)
  const clean: ProfileChanges = { ...changes }
  if (typeof clean.name === 'string') clean.name = clean.name.trim().slice(0, 40)
  if (typeof clean.status === 'string') clean.status = clean.status.trim().slice(0, 60) || null
  await kit.store.patch('members', memberId, clean)
}

export async function renameRoom(kit: Kit, name: string): Promise<void> {
  const { householdId } = await who(kit)
  await kit.store.patch('households', householdId, { name: name.trim().slice(0, 80) })
}
