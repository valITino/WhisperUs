// What an envelope looks like to whoever holds the phone: which layers are open, which
// wait, which are still with their author, and what the envelope as a whole asks for now.
// Pure: rows in, a view out. The screens and the tests share it.

import type { VaultEntry } from './db'
import { LAYERS, type Envelope, type ID, type ISO, type Layer, type LayerKey } from './types'

/**
 * held: still on its author's phone, nothing of it has left (the author sees this, nobody else).
 * sealed: in the cloud, sealed, waiting for its time.
 * open: the other one can read it.
 * gone: it was open once and has been burned.
 */
export type LayerState = 'held' | 'sealed' | 'open' | 'gone'

export interface LayerView {
  layer: Layer
  state: LayerState
  /** The moment it opens, while it is sealed with a time. */
  opensAt: ISO | null
  /** When the other one first opened it. */
  seenAt: ISO | null
  /** Whether this phone has both the sealed layer and its key. */
  readable: boolean
}

/**
 * For the one it is for:  waiting (nothing to open yet), ready (something new is open),
 * opened (everything that is open has been opened).
 * For its author:  sealed (nothing is open for the other one yet), out (something is).
 */
export type Standing = 'waiting' | 'ready' | 'opened' | 'sealed' | 'out'

export interface EnvelopeView {
  envelope: Envelope
  mine: boolean
  layers: LayerView[]
  standing: Standing
  /** The next moment something in it opens by itself. */
  nextOpening: ISO | null
  answered: boolean
}

/** What this phone knows beyond the envelope row itself. */
export interface Known {
  keys: readonly LayerKey[]
  vault: readonly VaultEntry[]
}

const usable = (key: LayerKey | undefined): key is LayerKey => Boolean(key && key.key !== '' && !key.deletedAt)

export function viewOf(envelope: Envelope, meId: ID, known: Known, now: number): EnvelopeView {
  const mine = envelope.authorId === meId
  const keyOf = (layer: Layer) => known.keys.find((k) => k.envelopeId === envelope.id && k.layer === layer)
  const vaultOf = (layer: Layer) => known.vault.find((v) => v.envelopeId === envelope.id && v.layer === layer)

  const layers: LayerView[] = []
  for (const layer of LAYERS) {
    const key = keyOf(layer)
    const kept = vaultOf(layer)
    const inCloud = envelope.layers[layer] != null
    const seenAt = envelope.seen[layer] ?? null

    if (mine) {
      if (!key && !kept && !inCloud && !seenAt) continue
      let state: LayerState
      if (key) state = !usable(key) ? 'gone' : Date.parse(key.opensAt) > now ? 'sealed' : 'open'
      else if (kept) state = 'held'
      else state = inCloud ? 'sealed' : 'gone'
      const readable = Boolean((usable(key) ? key.key : kept?.key) && (envelope.layers[layer] ?? kept?.sealed))
      layers.push({ layer, state, opensAt: state === 'sealed' && key ? key.opensAt : null, seenAt, readable })
    } else {
      if (!inCloud && !seenAt) continue
      // Holding the key is the proof that it is open: the cloud hands it out from the
      // opening time on, by its own clock. This phone's clock is not asked (it may be a
      // little behind the phone that sealed it).
      const open = inCloud && usable(key)
      const state: LayerState = open ? 'open' : inCloud ? 'sealed' : 'gone'
      const promised = envelope.openMode === 'at' && envelope.opensAt && Date.parse(envelope.opensAt) > now ? envelope.opensAt : null
      layers.push({ layer, state, opensAt: state === 'sealed' ? promised : null, seenAt, readable: open })
    }
  }

  const open = layers.filter((l) => l.state === 'open')
  let standing: Standing
  if (mine) standing = open.length > 0 || layers.some((l) => l.state === 'gone') ? 'out' : 'sealed'
  else if (open.some((l) => !l.seenAt)) standing = 'ready'
  else standing = layers.some((l) => l.seenAt) ? 'opened' : 'waiting'

  const upcoming = layers.flatMap((l) => (l.opensAt ? [l.opensAt] : [])).sort()
  const promised = !mine && envelope.openMode === 'at' && envelope.opensAt && Date.parse(envelope.opensAt) > now ? envelope.opensAt : null
  return { envelope, mine, layers, standing, nextOpening: upcoming[0] ?? promised, answered: envelope.reply != null }
}

/** Newest first, but what asks for attention comes before everything else. */
export function byAttention(a: EnvelopeView, b: EnvelopeView): number {
  const weight = (v: EnvelopeView) => (v.standing === 'ready' ? 0 : v.standing === 'waiting' ? 1 : 2)
  return weight(a) - weight(b) || (a.envelope.createdAt < b.envelope.createdAt ? 1 : a.envelope.createdAt > b.envelope.createdAt ? -1 : 0)
}

/** The layers of an envelope its author can still open by hand, or open ahead of their time. */
export function openable(view: EnvelopeView): { held: Layer[]; early: Layer[] } {
  if (!view.mine) return { held: [], early: [] }
  return {
    held: view.layers.filter((l) => l.state === 'held').map((l) => l.layer),
    early: view.layers.filter((l) => l.state === 'sealed').map((l) => l.layer),
  }
}

/** The soonest moment at which any of these views changes by itself (a timed opening). */
export function nextChange(views: readonly EnvelopeView[], now: number): number | null {
  const times = views.flatMap((v) => (v.nextOpening ? [Date.parse(v.nextOpening)] : [])).filter((t) => t > now)
  return times.length > 0 ? Math.min(...times) : null
}
