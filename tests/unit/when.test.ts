import { describe, expect, it } from 'vitest'
import { clock, dayAndTime, inWords, timeLeft, toLocalInput } from '../../src/lib/when'

// Moments in words, the way the envelope page and the room say them.

const NOW = Date.parse('2026-11-13T19:00:00Z')
const MIN = 60_000
const HOUR = 60 * MIN
const at = (ms: number) => new Date(NOW + ms).toISOString()

describe('how long until it opens', () => {
  it('counts minutes, rounded up: "1 min" until the last second', () => {
    expect(timeLeft(at(1), NOW, 'en')).toBe('1 min')
    expect(timeLeft(at(59_000), NOW, 'en')).toBe('1 min')
    expect(timeLeft(at(61_000), NOW, 'en')).toBe('2 min')
    expect(timeLeft(at(59 * MIN), NOW, 'en')).toBe('59 min')
  })

  it('then hours and minutes', () => {
    expect(timeLeft(at(HOUR), NOW, 'en')).toBe('1 h')
    expect(timeLeft(at(2 * HOUR + 14 * MIN), NOW, 'en')).toBe('2 h 14 min')
    expect(timeLeft(at(23 * HOUR + 59 * MIN), NOW, 'de')).toBe('23 h 59 min')
  })

  it('then days, in the reader\'s language', () => {
    expect(timeLeft(at(24 * HOUR), NOW, 'en')).toBe('1 day')
    expect(timeLeft(at(3 * 24 * HOUR + 5 * HOUR), NOW, 'en')).toBe('3 days')
    expect(timeLeft(at(24 * HOUR), NOW, 'de')).toBe('1 Tag')
    expect(timeLeft(at(3 * 24 * HOUR), NOW, 'de')).toBe('3 Tagen')
  })

  it('is nothing once the moment has come, or when there is no moment', () => {
    expect(timeLeft(at(0), NOW, 'en')).toBeNull()
    expect(timeLeft(at(-MIN), NOW, 'en')).toBeNull()
    expect(timeLeft('whenever', NOW, 'en')).toBeNull()
  })
})

describe('the length of a recording', () => {
  it('reads like a clock', () => {
    expect(clock(0)).toBe('0:00')
    expect(clock(7)).toBe('0:07')
    expect(clock(67)).toBe('1:07')
    expect(clock(300)).toBe('5:00')
    expect(clock(59.6)).toBe('1:00')
  })

  it('never goes below nothing', () => {
    expect(clock(-3)).toBe('0:00')
  })
})

describe('a day and a time', () => {
  const labels = { today: 'Today', tomorrow: 'Tomorrow', yesterday: 'Yesterday' }
  const tage = { today: 'Heute', tomorrow: 'Morgen', yesterday: 'Gestern' }

  it('names the time in the room, whatever the phone thinks', () => {
    const moment = new Date(Date.now() + 2 * MIN).toISOString()
    const zurich = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Europe/Zurich' }).format(new Date(moment))
    expect(dayAndTime(moment, 'en', labels)).toMatch(new RegExp(`^(Today|Tomorrow), ${zurich}$`))
    expect(dayAndTime(moment, 'de', tage)).toMatch(new RegExp(`^(Heute|Morgen), ${zurich}$`))
  })
})

describe('a moment inside a sentence', () => {
  const now = new Date(NOW) // Friday, 20:00 in Zurich

  it('reads on from "It opens": tonight, tomorrow, on a weekday', () => {
    expect(inWords(at(2 * HOUR), 'en', now)).toBe('tonight at 22:00')
    expect(inWords(at(12 * HOUR), 'en', now)).toBe('tomorrow at 08:00')
    expect(inWords(at(3 * 24 * HOUR), 'en', now)).toBe('on Monday at 20:00')
    expect(inWords(at(2 * HOUR), 'de', now)).toBe('heute Abend um 22:00')
    expect(inWords(at(3 * 24 * HOUR), 'de', now)).toBe('am Montag um 20:00')
  })

  it('never starts with a capital: it is the middle of a sentence', () => {
    for (const hours of [1, 5, 13, 30, 80, 300]) {
      const words = inWords(at(hours * HOUR), 'en', now)
      expect(words[0], words).toBe(words[0].toLowerCase())
    }
  })

  it('a moment that has come and waits only for the phone to hear of it is "any moment now"', () => {
    expect(inWords(at(-1000), 'en', now)).toBe('any moment now')
    expect(inWords(at(0), 'de', now)).toBe('jeden Moment')
  })
})

describe('the value a date field wants', () => {
  it('is the device\'s own time, to the minute, with leading zeros', () => {
    expect(toLocalInput(new Date(2026, 0, 5, 8, 7, 59))).toBe('2026-01-05T08:07')
    expect(toLocalInput(new Date(2026, 10, 13, 22, 0))).toBe('2026-11-13T22:00')
  })
})
