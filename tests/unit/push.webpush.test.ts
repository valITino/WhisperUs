import { describe, expect, it } from 'vitest'
import { encryptPayload, fromBase64Url, MAX_PAYLOAD, sendWebPush, toBase64Url, vapidAuthorization } from '../../supabase/functions/push/webpush'

// The push function encrypts and signs by hand (Web Crypto, no library). These tests
// check it against the worked example in RFC 8291 and by playing the browser's part:
// decrypting what was sent, and verifying the signature the way a push service does.

type Bytes = Uint8Array<ArrayBuffer>
const utf8 = (text: string): Bytes => new TextEncoder().encode(text)
const join = (...parts: Uint8Array[]): Bytes => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let at = 0
  for (const p of parts) {
    out.set(p, at)
    at += p.length
  }
  return out
}

async function hkdf(salt: Bytes, secret: Bytes, info: Bytes, length: number): Promise<Bytes> {
  const key = await crypto.subtle.importKey('raw', secret, 'HKDF', false, ['deriveBits'])
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, length * 8))
}

/** A P-256 key pair from its raw parts, as the RFC prints them. */
async function ecdhPair(publicKey: string, privateKey: string): Promise<CryptoKeyPair> {
  const point = fromBase64Url(publicKey)
  const jwk = { kty: 'EC', crv: 'P-256', x: toBase64Url(point.slice(1, 33)), y: toBase64Url(point.slice(33, 65)) }
  return {
    publicKey: await crypto.subtle.importKey('jwk', jwk, { name: 'ECDH', namedCurve: 'P-256' }, true, []),
    privateKey: await crypto.subtle.importKey('jwk', { ...jwk, d: privateKey }, { name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']),
  }
}

/** A browser that subscribed: its keys, and what it would hand to the app. */
async function makeBrowser() {
  const keys = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])
  const publicKey = new Uint8Array(await crypto.subtle.exportKey('raw', keys.publicKey))
  const auth = crypto.getRandomValues(new Uint8Array(16))
  return { keys, publicKey, auth, target: { endpoint: 'https://push.example.test/send/abc', p256dh: toBase64Url(publicKey), auth: toBase64Url(auth) } }
}

/** The browser's side of RFC 8291: open a message with the subscription's private key. */
async function decrypt(body: Uint8Array, browser: Awaited<ReturnType<typeof makeBrowser>>): Promise<string> {
  const salt = body.slice(0, 16)
  const recordSize = new DataView(body.buffer, body.byteOffset + 16, 4).getUint32(0)
  const keyLength = body[20]
  const senderPublic = body.slice(21, 21 + keyLength)
  const sealed = body.slice(21 + keyLength)
  expect(recordSize).toBe(4096)
  expect(keyLength).toBe(65)

  const senderKey = await crypto.subtle.importKey('raw', senderPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, [])
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: senderKey }, browser.keys.privateKey, 256))
  const ikm = await hkdf(browser.auth, shared, join(utf8('WebPush: info\0'), browser.publicKey, senderPublic), 32)
  const contentKey = await hkdf(salt, ikm, utf8('Content-Encoding: aes128gcm\0'), 16)
  const nonce = await hkdf(salt, ikm, utf8('Content-Encoding: nonce\0'), 12)
  const key = await crypto.subtle.importKey('raw', contentKey, 'AES-GCM', false, ['decrypt'])
  const padded = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce }, key, sealed))
  // Strip the padding: everything after the last 0x02.
  const end = padded.lastIndexOf(2)
  expect(end).toBeGreaterThanOrEqual(0)
  return new TextDecoder().decode(padded.slice(0, end))
}

async function makeVapid() {
  const keys = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])
  const publicKey = toBase64Url(new Uint8Array(await crypto.subtle.exportKey('raw', keys.publicKey)))
  const privateKey = (await crypto.subtle.exportKey('jwk', keys.privateKey)).d as string
  return { keys, vapid: { publicKey, privateKey, subject: 'https://room.example.org/' } }
}

describe('base64url', () => {
  it('goes there and back, without padding and with the URL-safe letters', () => {
    const bytes = new Uint8Array([251, 255, 254, 0, 1, 2, 3])
    const text = toBase64Url(bytes)
    expect(text).toBe('-__-AAECAw')
    expect([...fromBase64Url(text)]).toEqual([...bytes])
    expect([...fromBase64Url('')]).toEqual([])
  })
})

describe('encrypting for one browser (RFC 8291)', () => {
  it('reproduces the example in appendix A of the RFC, byte for byte', async () => {
    const body = await encryptPayload(
      utf8('When I grow up, I want to be a watermelon'),
      { p256dh: 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4', auth: 'BTBZMqHH6r4Tts7J_aSIgg' },
      {
        salt: fromBase64Url('DGv6ra1nlYgDCS1FRnbzlw'),
        localKeys: await ecdhPair('BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8', 'yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw'),
      },
    )
    expect(toBase64Url(body)).toBe(
      'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN',
    )
  })

  it('makes a message only the subscribed browser can open', async () => {
    const browser = await makeBrowser()
    const message = JSON.stringify({ title: 'Served!', body: 'Mia served Älplermagronen. Proof needed!' })
    const body = await encryptPayload(utf8(message), browser.target)
    expect(await decrypt(body, browser)).toBe(message)

    // Another browser, with other keys, cannot.
    const other = await makeBrowser()
    await expect(decrypt(body, other)).rejects.toThrow()
  })

  it('uses fresh keys every time: the same words never look the same twice', async () => {
    const browser = await makeBrowser()
    const a = toBase64Url(await encryptPayload(utf8('hello'), browser.target))
    const b = toBase64Url(await encryptPayload(utf8('hello'), browser.target))
    expect(a).not.toBe(b)
  })

  it('refuses keys that are not keys, and messages too long for one record', async () => {
    const browser = await makeBrowser()
    await expect(encryptPayload(utf8('x'), { p256dh: 'AAAA', auth: browser.target.auth })).rejects.toThrow(/malformed/)
    await expect(encryptPayload(utf8('x'), { p256dh: browser.target.p256dh, auth: 'AAAA' })).rejects.toThrow(/malformed/)
    await expect(encryptPayload(new Uint8Array(MAX_PAYLOAD + 1), browser.target)).rejects.toThrow(/too long/)
    await expect(encryptPayload(new Uint8Array(MAX_PAYLOAD), browser.target)).resolves.toBeInstanceOf(Uint8Array)
  })
})

describe('signing as us (VAPID, RFC 8292)', () => {
  it('writes a token the push service can verify with our public key', async () => {
    const { keys, vapid } = await makeVapid()
    const now = new Date('2026-11-10T18:00:00Z')
    const header = await vapidAuthorization('https://fcm.googleapis.com/fcm/send/abc123', vapid, now)

    const match = /^vapid t=([\w-]+)\.([\w-]+)\.([\w-]+), k=([\w-]+)$/.exec(header)
    expect(match).not.toBeNull()
    const [, head, claims, signature, key] = match as RegExpExecArray
    expect(key).toBe(vapid.publicKey)
    expect(JSON.parse(new TextDecoder().decode(fromBase64Url(head)))).toEqual({ typ: 'JWT', alg: 'ES256' })
    expect(JSON.parse(new TextDecoder().decode(fromBase64Url(claims)))).toEqual({
      // The push service's origin, not the whole address.
      aud: 'https://fcm.googleapis.com',
      exp: Math.floor(now.getTime() / 1000) + 12 * 3600,
      sub: 'https://room.example.org/',
    })
    const sig = fromBase64Url(signature)
    expect(sig.length).toBe(64)
    expect(await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, keys.publicKey, sig, utf8(`${head}.${claims}`))).toBe(true)
  })

  it('says so when the public key is not a key', async () => {
    const { vapid } = await makeVapid()
    await expect(vapidAuthorization('https://push.example.test/x', { ...vapid, publicKey: 'nope' }, new Date())).rejects.toThrow(/VAPID public key/)
  })
})

describe('sending', () => {
  it('posts the sealed message with the headers a push service expects', async () => {
    const browser = await makeBrowser()
    const { vapid } = await makeVapid()
    const calls: { url: string; init: RequestInit }[] = []
    const send = (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init as RequestInit })
      return new Response(null, { status: 201 })
    }) as typeof fetch

    const answer = await sendWebPush(browser.target, '{"title":"Served!"}', vapid, { ttl: 21600, urgency: 'high', topic: '0f8fad5bd9cb469fa16570867728950e' }, send, new Date('2026-11-10T18:00:00Z'))
    expect(answer.status).toBe(201)
    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe(browser.target.endpoint)
    expect(calls[0].init.method).toBe('POST')
    const headers = calls[0].init.headers as Record<string, string>
    expect(headers).toMatchObject({ 'Content-Encoding': 'aes128gcm', 'Content-Type': 'application/octet-stream', TTL: '21600', Urgency: 'high', Topic: '0f8fad5bd9cb469fa16570867728950e' })
    expect(headers.Authorization).toMatch(/^vapid t=.+, k=.+$/)
    expect(await decrypt(calls[0].init.body as Uint8Array, browser)).toBe('{"title":"Served!"}')
  })

  it('leaves out a topic the push service would refuse', async () => {
    const browser = await makeBrowser()
    const { vapid } = await makeVapid()
    let headers: Record<string, string> = {}
    const send = (async (_url: string | URL | Request, init?: RequestInit) => {
      headers = init?.headers as Record<string, string>
      return new Response(null, { status: 201 })
    }) as typeof fetch
    await sendWebPush(browser.target, 'x', vapid, { ttl: 60, topic: 'far too long for a topic, and with spaces in it' }, send, new Date())
    expect(headers.Topic).toBeUndefined()
    expect(headers.Urgency).toBe('normal')
  })
})
