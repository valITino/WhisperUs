import { beforeEach, describe, expect, it, vi } from 'vitest'

// The app lock of one device: a six-digit code, five tries, then a wait that doubles.
// A stand-in for the browser's storage, put in place before the module reads it.

const shelf = new Map<string, string>()
vi.stubGlobal('localStorage', {
  getItem: (key: string) => shelf.get(key) ?? null,
  setItem: (key: string, value: string) => void shelf.set(key, value),
  removeItem: (key: string) => void shelf.delete(key),
})

const { checkLockCode, isLocked, isLockOn, LOCK_TRIES, lockedUntil, lockNow, reloadLock, removeLock, setLockCode, unlock } = await import('../../src/features/lock/lock')

const CODE = '271828'
const KEY = 'whisperus.lock'
const stored = () => JSON.parse(shelf.get(KEY) as string) as { salt: string; hash: string; rounds: number; fails: number; waits: number; until: number }

beforeEach(() => {
  shelf.clear()
  reloadLock()
})

describe('turning the lock on', () => {
  it('a device without a lock is open, and "lock now" does nothing', async () => {
    expect(isLockOn()).toBe(false)
    expect(isLocked()).toBe(false)
    lockNow()
    expect(isLocked()).toBe(false)
    // Asking for a code where there is none: nothing to get wrong.
    expect(await checkLockCode('000000')).toEqual({ ok: true })
  })

  it('stores a slow hash and a salt, never the code', async () => {
    await setLockCode(CODE)
    expect(isLockOn()).toBe(true)
    const raw = shelf.get(KEY) as string
    expect(raw).not.toContain(CODE)
    expect(stored().rounds).toBeGreaterThanOrEqual(100_000)
    expect(stored().hash).toMatch(/^[A-Za-z0-9+/]{43}=$/)
    expect(stored().salt).toMatch(/^[A-Za-z0-9+/]{22}==$/)
  })

  it('the same code gives a different hash every time: the salt is new', async () => {
    await setLockCode(CODE)
    const first = stored()
    await setLockCode(CODE)
    expect(stored().salt).not.toBe(first.salt)
    expect(stored().hash).not.toBe(first.hash)
  })

  it('whoever sets it stays in; the next start is locked', async () => {
    await setLockCode(CODE)
    expect(isLocked()).toBe(false)
    reloadLock()
    expect(isLocked()).toBe(true)
  })
})

describe('opening it', () => {
  beforeEach(async () => {
    await setLockCode(CODE)
    reloadLock()
  })

  it('the right code opens', async () => {
    expect(await unlock(CODE)).toEqual({ ok: true })
    expect(isLocked()).toBe(false)
  })

  it('a wrong one does not, and says how many tries are left', async () => {
    expect(await unlock('000000')).toEqual({ ok: false, triesLeft: LOCK_TRIES - 1, retryAt: null })
    expect(await unlock('111111')).toEqual({ ok: false, triesLeft: LOCK_TRIES - 2, retryAt: null })
    expect(isLocked()).toBe(true)
    // The right one forgives the wrong ones.
    expect(await unlock(CODE)).toEqual({ ok: true })
    expect(stored()).toMatchObject({ fails: 0, waits: 0, until: 0 })
  })

  it('after five wrong tries nothing is accepted for a while, not even the right code', async () => {
    const now = 1_800_000_000_000
    for (let i = 1; i < LOCK_TRIES; i++) expect((await checkLockCode('000000', now)).ok).toBe(false)
    expect(await checkLockCode('000000', now)).toEqual({ ok: false, triesLeft: 0, retryAt: now + 30_000 })
    expect(lockedUntil(now + 1000)).toBe(now + 30_000)
    expect(await checkLockCode(CODE, now + 29_000)).toEqual({ ok: false, triesLeft: 0, retryAt: now + 30_000 })
    // When the wait is over the right code opens again.
    expect(lockedUntil(now + 30_000)).toBeNull()
    expect(await checkLockCode(CODE, now + 30_000)).toEqual({ ok: true })
  })

  it('every time the tries run out, the wait doubles, up to a quarter of an hour', async () => {
    let now = 1_800_000_000_000
    const waits: number[] = []
    for (let round = 0; round < 8; round++) {
      let answer = await checkLockCode('000000', now)
      for (let i = 1; i < LOCK_TRIES; i++) answer = await checkLockCode('000000', now)
      if (answer.ok || answer.retryAt === null) throw new Error('the tries should have run out')
      waits.push((answer.retryAt - now) / 1000)
      now = answer.retryAt
    }
    expect(waits).toEqual([30, 60, 120, 240, 480, 900, 900, 900])
  })

  it('the count survives closing the app: a new start is no new set of tries', async () => {
    const now = 1_800_000_000_000
    for (let i = 0; i < 3; i++) await checkLockCode('000000', now)
    reloadLock()
    expect(await checkLockCode('000000', now)).toEqual({ ok: false, triesLeft: 1, retryAt: null })
  })

  it('"lock now" covers the app again', async () => {
    await unlock(CODE)
    lockNow()
    expect(isLocked()).toBe(true)
  })

  it('taking the lock off leaves nothing behind', async () => {
    await unlock(CODE)
    removeLock()
    expect(isLockOn()).toBe(false)
    expect(isLocked()).toBe(false)
    expect(shelf.has(KEY)).toBe(false)
    reloadLock()
    expect(isLocked()).toBe(false)
  })
})

describe('storage that cannot be trusted', () => {
  it('something unreadable in the slot is no lock, rather than a lock nobody can open', () => {
    for (const junk of ['not json', '{}', '{"salt":"a"}', '{"salt":1,"hash":2,"rounds":"many"}', 'null']) {
      shelf.set(KEY, junk)
      reloadLock()
      expect(isLockOn(), junk).toBe(false)
      expect(isLocked(), junk).toBe(false)
    }
  })
})
