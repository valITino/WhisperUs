// Opening what this phone can open: from sealed layers to things a screen can show.

import { readLayer, readVoice } from '../../data/do'
import type { Envelope, FeelBody, Layer, VoiceBody, WordsBody } from '../../data/types'

export interface Inside {
  feel?: FeelBody
  words?: WordsBody
  /** `sound` is null while the sealed file has not arrived on this phone. */
  voice?: { body: VoiceBody; sound: Blob | null }
}

/** Open the given layers. A layer this phone cannot open (no key, or a key that does not fit) is left out. */
export async function loadInside(envelope: Envelope, layers: readonly Layer[]): Promise<Inside> {
  const inside: Inside = {}
  if (layers.includes('feel')) {
    const feel = await readLayer(envelope, 'feel').catch(() => null)
    if (feel) inside.feel = feel
  }
  if (layers.includes('words')) {
    const words = await readLayer(envelope, 'words').catch(() => null)
    if (words) inside.words = words
  }
  if (layers.includes('voice')) {
    const body = await readLayer(envelope, 'voice').catch(() => null)
    if (body) inside.voice = { body, sound: await readVoice(envelope, body).catch(() => null) }
  }
  return inside
}

/** Which of the asked-for layers are completely here: a voice counts only with its sound. */
export function complete(inside: Inside, layers: readonly Layer[]): Layer[] {
  return layers.filter((layer) => (layer === 'voice' ? Boolean(inside.voice?.sound) : inside[layer] !== undefined))
}
