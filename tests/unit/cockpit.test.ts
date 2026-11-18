import { describe, expect, it } from 'vitest'
import { ENOUGH, fantasyDays, fold, goesWith, halfTendency, happenedDays, highDays, howMany, lastDays, latest, reasonDays, series, thoughtDays, thoughtsSeries, weekdayTendency, type Entry } from '../../src/data/cockpit'
import type { CheckinBody, Half } from '../../src/data/types'

// The cockpit's arithmetic. What it must never do matters as much as what it does:
// a day without a check-in is not a hole, a handful of entries is not a pattern,
// and nothing here is a score.

const entry = (day: string, half: Half, body: CheckinBody): Entry => ({ id: `${day}.${half}`, ref: `${day}.${half}`, at: `${day}T${half === 'am' ? '07' : '20'}:00:00Z`, body, shared: [], whole: true })
const reasons = (...chips: string[]) => ({ chips, own: [], note: null })
const WEEK = lastDays('2026-11-15', 7) // Monday 9 to Sunday 15 November

describe('the days of a period', () => {
  it('ends on the given day, oldest first, across a month', () => {
    expect(lastDays('2026-11-02', 4)).toEqual(['2026-10-30', '2026-10-31', '2026-11-01', '2026-11-02'])
    expect(WEEK[0]).toBe('2026-11-09')
    expect(lastDays('2026-11-15', 30)).toHaveLength(30)
  })
})

describe('a scale over the days', () => {
  const entries = [entry('2026-11-10', 'am', { mood: 2, desire: 4 }), entry('2026-11-10', 'pm', { mood: 4 }), entry('2026-11-12', 'pm', { mood: 5 }), entry('2026-10-01', 'am', { mood: 1 })]

  it('is the mean of a day\'s check-ins, and nothing at all where nothing was said', () => {
    expect(series(entries, 'mood', WEEK)).toEqual([null, 3, null, 5, null, null, null])
    expect(series(entries, 'desire', WEEK)).toEqual([null, 4, null, null, null, null, null])
    expect(series(entries, 'kinky', WEEK)).toEqual([null, null, null, null, null, null, null])
  })

  it('counts check-ins and the days they fall on, inside the period only', () => {
    expect(howMany(entries, WEEK)).toEqual({ entries: 3, days: 2 })
    expect(howMany([], WEEK)).toEqual({ entries: 0, days: 0 })
  })

  it('folds days into weeks by what was said, not by the days that passed', () => {
    expect(fold([1, null, 5, null, null, null, null, 4, 4, null, null, null, null, null, null], 7)).toEqual([3, 4, null])
  })

  it('counts the days a scale stood high, out of the days it was answered on', () => {
    expect(highDays(entries, 'mood', WEEK)).toEqual({ high: 1, of: 2 })
    expect(highDays(entries, 'kinky', WEEK)).toEqual({ high: 0, of: 0 })
  })
})

describe('what was on my mind', () => {
  const entries = [entry('2026-11-10', 'am', { thoughts: 0 }), entry('2026-11-10', 'pm', { thoughts: 3, fantasies: ['soft.massage', 'play.roles'] }), entry('2026-11-11', 'am', { thoughts: 0 }), entry('2026-11-13', 'pm', { fantasies: ['soft.massage'] }), entry('2026-11-13', 'am', { fantasies: ['soft.massage'] })]

  it('"not at all" is an answer; no answer is none', () => {
    expect(thoughtsSeries(entries, WEEK)).toEqual([null, 3, 0, null, null, null, null])
    expect(thoughtDays(entries, WEEK)).toEqual({ some: 1, of: 2 })
  })

  it('a fantasy counts once per day, however often it was tapped', () => {
    expect(fantasyDays(entries, WEEK)).toEqual([{ id: 'soft.massage', days: 2 }, { id: 'play.roles', days: 1 }])
  })
})

describe('what there was, and what was behind it', () => {
  const entries = [entry('2026-11-09', 'pm', { happened: ['tender', 'sex'], why: reasons('checkin.rested') }), entry('2026-11-10', 'am', { happened: ['tender'], why: reasons('checkin.rested', 'checkin.time') }), entry('2026-11-10', 'pm', { happened: ['tender', 'kinky'] })]

  it('counts days, most first', () => {
    expect(happenedDays(entries, WEEK)).toEqual([{ id: 'tender', days: 2 }, { id: 'kinky', days: 1 }, { id: 'sex', days: 1 }])
    expect(reasonDays(entries, WEEK)).toEqual([{ id: 'checkin.rested', days: 2 }, { id: 'checkin.time', days: 1 }])
  })
})

describe('tendencies', () => {
  const days = lastDays('2026-11-29', 21)

  it('says nothing about mornings and evenings from a handful of entries', () => {
    const few = [entry('2026-11-27', 'am', { desire: 1 }), entry('2026-11-27', 'pm', { desire: 5 }), entry('2026-11-28', 'pm', { desire: 5 })]
    expect(halfTendency(few, 'desire', days)).toBeNull()
  })

  it('says "more in the evening" once there is enough, and nothing when the two are alike', () => {
    const evenings = days.slice(0, 4).flatMap((day) => [entry(day, 'am', { desire: 2, mood: 3 }), entry(day, 'pm', { desire: 4, mood: 3 })])
    expect(halfTendency(evenings, 'desire', days)).toBe('pm')
    expect(halfTendency(evenings, 'mood', days)).toBeNull()
    const mornings = days.slice(0, 4).flatMap((day) => [entry(day, 'am', { desire: 5 }), entry(day, 'pm', { desire: 3 })])
    expect(halfTendency(mornings, 'desire', days)).toBe('am')
  })

  it('names a weekday only when it really stands out', () => {
    // Three weeks: Saturdays at 5, everything else at 2.
    const steady = days.map((day, i) => entry(day, 'pm', { desire: i % 7 === 5 ? 5 : 2 }))
    expect(weekdayTendency(steady, 'desire', days)).toBe(5)
    const flat = days.map((day) => entry(day, 'pm', { desire: 3 }))
    expect(weekdayTendency(flat, 'desire', days)).toBeNull()
    expect(weekdayTendency(steady.slice(0, 3), 'desire', days)).toBeNull()
  })

  it('"what goes with what" needs enough entries, and a reason that really goes with it', () => {
    const high = (day: string) => entry(day, 'pm', { desire: 5, why: reasons('checkin.rested', 'checkin.head') })
    const low = (day: string) => entry(day, 'pm', { desire: 1, why: reasons('checkin.stress', 'checkin.head') })
    const middle = (day: string) => entry(day, 'pm', { desire: 3, why: reasons('checkin.head') })
    const entries = [high(days[0]), high(days[1]), high(days[2]), low(days[3]), low(days[4]), middle(days[5]), middle(days[6])]
    // "My head is full" was tapped on every kind of day: it goes with nothing in particular.
    expect(goesWith(entries, 'desire', days)).toEqual({ high: ['checkin.rested'], low: ['checkin.stress'] })
    expect(goesWith(entries.slice(0, ENOUGH - 1), 'desire', days)).toEqual({ high: [], low: [] })
    // A reason tapped once is a moment, not a companion.
    expect(goesWith([high(days[0]), entry(days[1], 'pm', { desire: 5 }), low(days[2]), middle(days[3]), middle(days[4])], 'desire', days).high).toEqual([])
  })
})

describe('the weather', () => {
  it('is today\'s newest word on a scale: the evening before the morning, nothing from yesterday', () => {
    const entries = [entry('2026-11-15', 'am', { open: 2 }), entry('2026-11-15', 'pm', { open: 4, mood: 1 }), entry('2026-11-14', 'pm', { close: 5 })]
    expect(latest(entries, 'open', '2026-11-15')).toEqual({ value: 4, half: 'pm' })
    expect(latest(entries.slice(0, 1), 'open', '2026-11-15')).toEqual({ value: 2, half: 'am' })
    expect(latest(entries, 'close', '2026-11-15')).toBeNull()
  })
})
