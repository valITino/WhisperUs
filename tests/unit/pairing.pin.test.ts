import { describe, expect, it } from 'vitest'
import { pairingCopy } from '../../src/features/onboarding/copy'
import { newPinTrouble } from '../../src/features/onboarding/NewPinFields'
import { freshSetup, parseSetup, type Setup } from '../../src/features/onboarding/setupDraft'
import { sayWhen } from '../../src/features/onboarding/useExplain'
import { addDays, toDay } from '../../src/lib/dates'

describe('choosing a PIN', () => {
  const c = pairingCopy.en.pin

  it('accepts six digits typed twice', () => {
    expect(newPinTrouble('271828', '271828', c)).toBeNull()
  })

  it('points at the first field when the PIN itself is the problem', () => {
    expect(newPinTrouble('2718', '2718', c)).toEqual({ field: 'pin', message: c.invalid })
    expect(newPinTrouble('', '', c)).toEqual({ field: 'pin', message: c.invalid })
    expect(newPinTrouble('123456', '123456', c)).toEqual({ field: 'pin', message: c.tooSimple })
    expect(newPinTrouble('121212', '121212', c)).toEqual({ field: 'pin', message: c.tooSimple })
  })

  it('points at the second field when the two differ', () => {
    expect(newPinTrouble('271828', '271829', c)).toEqual({ field: 'again', message: c.mismatch })
    expect(newPinTrouble('271828', '', c)).toEqual({ field: 'again', message: c.mismatch })
  })

  it('says each problem in German too, in its own words', () => {
    const de = pairingCopy.de.pin
    const messages = [de.invalid, de.tooSimple, de.mismatch, c.invalid, c.tooSimple, c.mismatch]
    expect(new Set(messages).size).toBe(6)
  })
})

describe('the setup draft', () => {
  const draft: Setup = { ...freshSetup('join', 'ABCDEFGHJK'), step: 2, profile: { name: 'Mia', avatar: 'cat', color: 'wax', accessory: 'bow', status: 'Tonight I am brave' }, roomName: 'Casa' }
  const saved = (setup: unknown, at = 1_000) => JSON.stringify({ at, setup })

  it('comes back as it was saved', () => {
    expect(parseSetup(saved(draft), 2_000)).toEqual(draft)
  })

  it('never holds a PIN', () => {
    expect(Object.keys(draft).join(' ') + Object.keys(draft.profile).join(' ')).not.toMatch(/pin/i)
    // Even if one were smuggled in, it is dropped on the way back.
    const back = parseSetup(saved({ ...draft, pin: '271828', profile: { ...draft.profile, pin: '271828' } }), 2_000)
    expect(JSON.stringify(back)).not.toContain('271828')
  })

  it('is forgotten after a day', () => {
    expect(parseSetup(saved(draft, 0), 23 * 3_600_000)).not.toBeNull()
    expect(parseSetup(saved(draft, 0), 25 * 3_600_000)).toBeNull()
  })

  it('shrugs off anything that does not look like a draft', () => {
    expect(parseSetup(null)).toBeNull()
    expect(parseSetup('not json')).toBeNull()
    expect(parseSetup('{}')).toBeNull()
    expect(parseSetup(saved({ ...draft, flow: 'recover' }), 2_000)).toBeNull()
    expect(parseSetup(saved({ ...draft, flow: 'guest' }), 2_000)).toBeNull()
    expect(parseSetup(saved({ ...draft, profile: { ...draft.profile, name: 7 } }), 2_000)).toBeNull()
    // A broken step number starts over at the first step instead.
    expect(parseSetup(saved({ ...draft, step: -3 }), 2_000)?.step).toBe(0)
    expect(parseSetup(saved({ ...draft, step: 'two' }), 2_000)?.step).toBe(0)
  })

  it('starts empty, as a Chef nobody has confirmed yet', () => {
    expect(freshSetup('start')).toMatchObject({ flow: 'start', code: '', step: 0, roomName: '' })
  })
})

describe('saying when a paused name works again', () => {
  // Noon in Zurich, so "today" and "tomorrow" cannot tip over while the test runs.
  const today = toDay(new Date())
  const at = (day: string) => `${day}T11:15:00.000Z`

  it('gives just the clock time for today', () => {
    expect(sayWhen(at(today), 'en')).toMatch(/^\d{2}:15$/)
    expect(sayWhen(at(today), 'de')).toMatch(/^\d{2}:15$/)
  })

  it('adds "tomorrow" or the weekday for later days', () => {
    expect(sayWhen(at(addDays(today, 1)), 'en')).toMatch(/^tomorrow, \d{2}:15$/)
    expect(sayWhen(at(addDays(today, 1)), 'de')).toMatch(/^morgen, \d{2}:15$/)
    expect(sayWhen(at(addDays(today, 3)), 'en')).toMatch(/^\w+day, \d{2}:15$/)
  })
})
