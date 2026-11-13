// The seal itself: every layer of an envelope is encrypted on the phone that writes it,
// with a key of its own (AES-256-GCM, from the browser's Web Crypto). What travels and
// rests in the cloud is unreadable; whoever holds the key can open it, nobody else.
//
// Nothing here knows about envelopes, the database or the network: bytes in, bytes out.

import type { Sealed } from './types'

const ALGORITHM = 'AES-GCM'
const NONCE_BYTES = 12

export function toBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(binary)
}

export function fromBase64(text: string): Uint8Array<ArrayBuffer> {
  const binary = atob(text)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

/** A fresh key for one layer, as base64: that is how it is kept and how it travels. */
export function newKey(): string {
  return toBase64(crypto.getRandomValues(new Uint8Array(32)))
}

const nonce = (): Uint8Array<ArrayBuffer> => crypto.getRandomValues(new Uint8Array(NONCE_BYTES))

function importKey(key: string): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', fromBase64(key), ALGORITHM, false, ['encrypt', 'decrypt'])
}

/** Thrown when a key does not fit, or what it should open was tampered with. */
export class SealError extends Error {
  constructor() {
    super('seal_broken')
    this.name = 'SealError'
  }
}

/** Seal raw bytes (the sound of a voice note). The nonce comes back beside the sealed bytes. */
export async function sealBytes(key: string, bytes: Uint8Array<ArrayBuffer>): Promise<{ iv: string; sealed: Uint8Array<ArrayBuffer> }> {
  const iv = nonce()
  const sealed = await crypto.subtle.encrypt({ name: ALGORITHM, iv }, await importKey(key), bytes)
  return { iv: toBase64(iv), sealed: new Uint8Array(sealed) }
}

export async function openBytes(key: string, iv: string, sealed: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  try {
    return new Uint8Array(await crypto.subtle.decrypt({ name: ALGORITHM, iv: fromBase64(iv) }, await importKey(key), sealed))
  } catch {
    throw new SealError()
  }
}

/** Seal anything that can be written as JSON: the words, how it felt, the details of a voice note. */
export async function seal(key: string, body: unknown): Promise<Sealed> {
  const { iv, sealed } = await sealBytes(key, new TextEncoder().encode(JSON.stringify(body)))
  return { iv, box: toBase64(sealed) }
}

/** Open what `seal` made. Rejects with SealError when the key does not fit. */
export async function open<T>(key: string, sealed: Sealed): Promise<T> {
  let bytes: Uint8Array<ArrayBuffer>
  try {
    bytes = await openBytes(key, sealed.iv, fromBase64(sealed.box))
  } catch {
    throw new SealError()
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes)) as T
  } catch {
    throw new SealError()
  }
}
