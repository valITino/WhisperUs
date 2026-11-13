import { describe, expect, it } from 'vitest'
import { fromBase64, newKey, open, openBytes, seal, sealBytes, SealError, toBase64 } from '../../src/data/seal'

describe('the seal', () => {
  it('gives back exactly what was sealed, to whoever has the key', async () => {
    const key = newKey()
    const body = { text: 'Über Samstag. 🔥 «Ich habe es geliebt.»', n: [1, 2, 3] }
    expect(await open(key, await seal(key, body))).toEqual(body)
  })

  it('makes a key of 256 bits, different every time', () => {
    const keys = new Set(Array.from({ length: 50 }, () => newKey()))
    expect(keys.size).toBe(50)
    for (const key of keys) expect(fromBase64(key)).toHaveLength(32)
  })

  it('shows nothing of the words in what it stores', async () => {
    const sealed = await seal(newKey(), { text: 'a very recognisable sentence' })
    expect(JSON.stringify(sealed)).not.toContain('recognisable')
    expect(new TextDecoder().decode(fromBase64(sealed.box))).not.toContain('recognisable')
  })

  it('seals the same words differently every time', async () => {
    const key = newKey()
    const one = await seal(key, { text: 'again' })
    const two = await seal(key, { text: 'again' })
    expect(one.box).not.toBe(two.box)
    expect(one.iv).not.toBe(two.iv)
  })

  it('does not open with another key', async () => {
    const sealed = await seal(newKey(), { text: 'not for you' })
    await expect(open(newKey(), sealed)).rejects.toBeInstanceOf(SealError)
  })

  it('notices when what is stored was tampered with', async () => {
    const key = newKey()
    const sealed = await seal(key, { text: 'untouched' })
    const bytes = fromBase64(sealed.box)
    bytes[3] ^= 1
    await expect(open(key, { iv: sealed.iv, box: toBase64(bytes) })).rejects.toBeInstanceOf(SealError)
  })

  it('seals and opens raw bytes (the sound of a voice note)', async () => {
    const key = newKey()
    const sound = crypto.getRandomValues(new Uint8Array(40_000))
    const { iv, sealed } = await sealBytes(key, sound)
    expect(sealed.byteLength).toBeGreaterThan(sound.byteLength)
    expect(await openBytes(key, iv, sealed)).toEqual(sound)
    await expect(openBytes(newKey(), iv, sealed)).rejects.toBeInstanceOf(SealError)
  })

  it('carries long byte strings through base64 unharmed', () => {
    const bytes = crypto.getRandomValues(new Uint8Array(65_536))
    expect(fromBase64(toBase64(bytes))).toEqual(bytes)
  })
})
