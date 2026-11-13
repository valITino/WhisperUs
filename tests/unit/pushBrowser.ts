// A browser that signed up for notifications, as far as the push tests need one: its
// keys, the address of its push service, and the ability to open what was sent to it
// (the receiving side of RFC 8291).

type Bytes = Uint8Array<ArrayBuffer>

export interface Browser {
  id: string
  endpoint: string
  keys: CryptoKeyPair
  publicKey: Bytes
  auth: Bytes
}

const utf8 = (text: string): Bytes => new TextEncoder().encode(text)

export const base64Url = (bytes: Uint8Array): string => Buffer.from(bytes).toString('base64url')

export async function makeBrowser(name: string): Promise<Browser> {
  const keys = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])
  return { id: crypto.randomUUID(), endpoint: `https://push.service.test/send/${name}`, keys, publicKey: new Uint8Array(await crypto.subtle.exportKey('raw', keys.publicKey)), auth: crypto.getRandomValues(new Uint8Array(16)) }
}

async function hkdf(salt: Bytes, secret: Bytes, info: Bytes, length: number): Promise<Bytes> {
  const key = await crypto.subtle.importKey('raw', secret, 'HKDF', false, ['deriveBits'])
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, length * 8))
}

/** What the browser would read: opens a sealed message with the subscription's own keys. */
export async function open(body: Uint8Array, browser: Browser): Promise<Record<string, string>> {
  const salt = body.slice(0, 16)
  const sender = body.slice(21, 21 + body[20])
  const senderKey = await crypto.subtle.importKey('raw', sender, { name: 'ECDH', namedCurve: 'P-256' }, false, [])
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: senderKey }, browser.keys.privateKey, 256))
  const info = new Uint8Array([...utf8('WebPush: info\0'), ...browser.publicKey, ...sender])
  const ikm = await hkdf(browser.auth, shared, info, 32)
  const key = await crypto.subtle.importKey('raw', await hkdf(salt, ikm, utf8('Content-Encoding: aes128gcm\0'), 16), 'AES-GCM', false, ['decrypt'])
  const plain = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: await hkdf(salt, ikm, utf8('Content-Encoding: nonce\0'), 12) }, key, body.slice(21 + body[20])))
  return JSON.parse(new TextDecoder().decode(plain.slice(0, plain.lastIndexOf(2)))) as Record<string, string>
}
