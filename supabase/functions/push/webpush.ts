// Web Push by hand: the message is encrypted for one browser (RFC 8291, "aes128gcm")
// and the request is signed with our VAPID key (RFC 8292), so the browser's push service
// knows it comes from us. Web Crypto only, no library: the same code runs in Supabase's
// Edge runtime and in the unit tests (tests/unit/push.webpush.test.ts), which check it
// against the example in the RFC.

export interface PushTarget {
  /** The address the browser's push service gave this device. */
  endpoint: string
  /** The device's public key, base64url. */
  p256dh: string
  /** The device's shared secret, base64url. */
  auth: string
}

export interface Vapid {
  /** 65 bytes, base64url: the key the app's browsers subscribed with. */
  publicKey: string
  /** 32 bytes, base64url. Lives in the database's private schema and nowhere else. */
  privateKey: string
  /** An https address: where a push service finds whoever sends these messages. */
  subject: string
}

export interface PushOptions {
  /** Seconds the push service keeps trying while the device is unreachable. */
  ttl: number
  urgency?: 'very-low' | 'low' | 'normal' | 'high'
  /** A waiting message with the same topic is replaced. At most 32 URL-safe characters. */
  topic?: string
}

type Bytes = Uint8Array<ArrayBuffer>

export function fromBase64Url(encoded: string): Bytes {
  const padded = encoded.replaceAll('-', '+').replaceAll('_', '/').padEnd(Math.ceil(encoded.length / 4) * 4, '=')
  const binary = atob(padded)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

export function toBase64Url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '')
}

function concat(...parts: Uint8Array[]): Bytes {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0))
  let at = 0
  for (const part of parts) {
    out.set(part, at)
    at += part.length
  }
  return out
}

const utf8 = (plain: string): Bytes => new TextEncoder().encode(plain)
/** The zero byte that ends each label in the key derivation. */
const ZERO = new Uint8Array(1)

async function hkdf(salt: Bytes, secret: Bytes, info: Bytes, length: number): Promise<Bytes> {
  const key = await crypto.subtle.importKey('raw', secret, 'HKDF', false, ['deriveBits'])
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, length * 8))
}

/** One record holds the whole message. Ours are a few hundred bytes. */
const RECORD_SIZE = 4096
export const MAX_PAYLOAD = RECORD_SIZE - 16 - 1

/**
 * Encrypt a message so that only the subscribed browser can read it.
 * `fixed` pins the random parts and exists for the tests alone.
 */
export async function encryptPayload(plaintext: Uint8Array, target: Pick<PushTarget, 'p256dh' | 'auth'>, fixed?: { salt: Bytes; localKeys: CryptoKeyPair }): Promise<Bytes> {
  if (plaintext.length > MAX_PAYLOAD) throw new Error('push payload too long')
  const theirPublic = fromBase64Url(target.p256dh)
  const authSecret = fromBase64Url(target.auth)
  if (theirPublic.length !== 65 || theirPublic[0] !== 4 || authSecret.length < 16) throw new Error('push subscription keys are malformed')

  const local = fixed?.localKeys ?? (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']))
  const localPublic = new Uint8Array(await crypto.subtle.exportKey('raw', local.publicKey))
  const theirKey = await crypto.subtle.importKey('raw', theirPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, [])
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: theirKey }, local.privateKey, 256))

  // RFC 8291, section 3.4: mix in the device's secret and both public keys.
  const keyInfo = concat(utf8('WebPush: info'), ZERO, theirPublic, localPublic)
  const ikm = await hkdf(authSecret, shared, keyInfo, 32)

  // RFC 8188: one key and one nonce per message, from a fresh salt.
  const salt = fixed?.salt ?? crypto.getRandomValues(new Uint8Array(16))
  const contentKey = await hkdf(salt, ikm, concat(utf8('Content-Encoding: aes128gcm'), ZERO), 16)
  const nonce = await hkdf(salt, ikm, concat(utf8('Content-Encoding: nonce'), ZERO), 12)

  const key = await crypto.subtle.importKey('raw', contentKey, 'AES-GCM', false, ['encrypt'])
  // 0x02 marks the last (here: only) record.
  const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, key, concat(plaintext, new Uint8Array([2]))))

  const recordSize = new Uint8Array(4)
  new DataView(recordSize.buffer).setUint32(0, RECORD_SIZE)
  return concat(salt, recordSize, new Uint8Array([localPublic.length]), localPublic, sealed)
}

/** The Authorization header that proves the request is ours, for one push service. */
export async function vapidAuthorization(endpoint: string, vapid: Vapid, now: Date): Promise<string> {
  const publicKey = fromBase64Url(vapid.publicKey)
  if (publicKey.length !== 65 || publicKey[0] !== 4) throw new Error('the VAPID public key is malformed')
  const jwk: JsonWebKey = {
    kty: 'EC',
    crv: 'P-256',
    x: toBase64Url(publicKey.slice(1, 33)),
    y: toBase64Url(publicKey.slice(33, 65)),
    d: toBase64Url(fromBase64Url(vapid.privateKey)),
  }
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign'])
  const header = toBase64Url(utf8(JSON.stringify({ typ: 'JWT', alg: 'ES256' })))
  // Valid for twelve hours; push services refuse anything beyond a day.
  const claims = toBase64Url(utf8(JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(now.getTime() / 1000) + 12 * 3600, sub: vapid.subject })))
  const signature = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, utf8(`${header}.${claims}`)))
  return `vapid t=${header}.${claims}.${toBase64Url(signature)}, k=${toBase64Url(publicKey)}`
}

/**
 * Send one message to one device. Resolves with the push service's answer:
 * 201 accepted, 404 or 410 the subscription is gone for good, 429 and 5xx try later.
 */
export async function sendWebPush(target: PushTarget, payload: string, vapid: Vapid, options: PushOptions, send: typeof fetch, now: Date): Promise<Response> {
  const body = await encryptPayload(utf8(payload), target)
  const headers: Record<string, string> = {
    Authorization: await vapidAuthorization(target.endpoint, vapid, now),
    'Content-Encoding': 'aes128gcm',
    'Content-Type': 'application/octet-stream',
    TTL: String(Math.max(0, Math.round(options.ttl))),
    Urgency: options.urgency ?? 'normal',
  }
  if (options.topic && /^[A-Za-z0-9_-]{1,32}$/.test(options.topic)) headers.Topic = options.topic
  return send(target.endpoint, { method: 'POST', headers, body })
}
