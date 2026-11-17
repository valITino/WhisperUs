// What the cockpit shows, worked out from check-ins. Pure: entries in, numbers and
// tendencies out. The screens and the tests share it.
//
// The rules it keeps, because counting can hurt what it counts:
//   - a day without a check-in is simply not there: nothing is ever "missed"
//   - no targets, no averages against anybody, nothing that reads as a score for a person
//   - tendencies ("more often in the evening") only once there is enough to go on
//   - nobody's "no" is ever counted

import { addDays, weekdayIndex, type Day } from '../lib/dates'
import { parseSlot, type Noted } from './journal'
import type { CheckinBody, CheckinScale, Half } from './types'

export type Entry = Noted<CheckinBody>

/** Below this many entries the cockpit shows what there is and draws no conclusions. */
export const ENOUGH = 5

/** The last `count` days up to and including `until`, oldest first. */
export function lastDays(until: Day, count: number): Day[] {
  return Array.from({ length: count }, (_, i) => addDays(until, i - (count - 1)))
}

interface Slotted {
  day: Day
  half: Half
  body: CheckinBody
}

/** The entries of a period, each with its day and half. */
function within(entries: readonly Entry[], days: readonly Day[]): Slotted[] {
  const wanted = new Set(days)
  const out: Slotted[] = []
  for (const entry of entries) {
    const slot = parseSlot(entry.ref)
    if (slot && wanted.has(slot.day)) out.push({ ...slot, body: entry.body })
  }
  return out
}

const mean = (values: readonly number[]): number | null => (values.length === 0 ? null : values.reduce((sum, v) => sum + v, 0) / values.length)

/** How many check-ins a period holds, and on how many of its days. Context, never a goal. */
export function howMany(entries: readonly Entry[], days: readonly Day[]): { entries: number; days: number } {
  const found = within(entries, days)
  return { entries: found.length, days: new Set(found.map((e) => e.day)).size }
}

/** One value per day: the mean of that day's check-ins on this scale, null where nothing was said. */
export function series(entries: readonly Entry[], scale: CheckinScale, days: readonly Day[]): (number | null)[] {
  const found = within(entries, days)
  return days.map((day) => mean(found.filter((e) => e.day === day && e.body[scale] !== undefined).map((e) => e.body[scale] as number)))
}

/** How often sex was on my mind, per day: the highest of the day (0 is an answer, null is none). */
export function thoughtsSeries(entries: readonly Entry[], days: readonly Day[]): (number | null)[] {
  const found = within(entries, days)
  return days.map((day) => {
    const values = found.filter((e) => e.day === day && e.body.thoughts !== undefined).map((e) => e.body.thoughts as number)
    return values.length === 0 ? null : Math.max(...values)
  })
}

/** Fold a daily series into buckets of `size` days (weeks, for the long view): the mean of what was said. */
export function fold(values: readonly (number | null)[], size: number): (number | null)[] {
  const out: (number | null)[] = []
  for (let i = 0; i < values.length; i += size) out.push(mean(values.slice(i, i + size).filter((v): v is number => v !== null)))
  return out
}

export interface Counted {
  id: string
  /** On how many days it was noted. A day counts once, however often it was tapped. */
  days: number
}

function daysPer(found: readonly Slotted[], pick: (body: CheckinBody) => readonly string[] | undefined): Counted[] {
  const seen = new Map<string, Set<Day>>()
  for (const entry of found) for (const id of pick(entry.body) ?? []) seen.set(id, (seen.get(id) ?? new Set<Day>()).add(entry.day))
  return [...seen.entries()].map(([id, set]) => ({ id, days: set.size })).sort((a, b) => b.days - a.days || a.id.localeCompare(b.id))
}

/** What there was, by the number of days it was noted on. */
export const happenedDays = (entries: readonly Entry[], days: readonly Day[]): Counted[] => daysPer(within(entries, days), (body) => body.happened)

/** Which items of the list were on my mind, by the number of days. */
export const fantasyDays = (entries: readonly Entry[], days: readonly Day[]): Counted[] => daysPer(within(entries, days), (body) => body.fantasies)

/** The reasons I tapped, by the number of days. */
export const reasonDays = (entries: readonly Entry[], days: readonly Day[]): Counted[] => daysPer(within(entries, days), (body) => body.why?.chips)

/** On how many days a scale stood at 4 or 5, out of the days it was answered on. */
export function highDays(entries: readonly Entry[], scale: CheckinScale, days: readonly Day[]): { high: number; of: number } {
  const values = series(entries, scale, days).filter((v): v is number => v !== null)
  return { high: values.filter((v) => v >= 4).length, of: values.length }
}

/** On how many days sex was on my mind at all, out of the days the question was answered on. */
export function thoughtDays(entries: readonly Entry[], days: readonly Day[]): { some: number; of: number } {
  const values = thoughtsSeries(entries, days).filter((v): v is number => v !== null)
  return { some: values.filter((v) => v >= 1).length, of: values.length }
}

/**
 * Whether a scale tends to stand higher in the first or the second check-in of a day.
 * Null while there is too little to say so, or no real difference.
 */
export function halfTendency(entries: readonly Entry[], scale: CheckinScale, days: readonly Day[]): Half | null {
  const found = within(entries, days).filter((e) => e.body[scale] !== undefined)
  const am = found.filter((e) => e.half === 'am').map((e) => e.body[scale] as number)
  const pm = found.filter((e) => e.half === 'pm').map((e) => e.body[scale] as number)
  if (am.length < 3 || pm.length < 3) return null
  const difference = (mean(pm) as number) - (mean(am) as number)
  if (Math.abs(difference) < 0.5) return null
  return difference > 0 ? 'pm' : 'am'
}

/** The weekday (0 Monday … 6 Sunday) a scale tends to stand highest on. Null while there is too little to say so. */
export function weekdayTendency(entries: readonly Entry[], scale: CheckinScale, days: readonly Day[]): number | null {
  const values = series(entries, scale, days)
  const byWeekday = Array.from({ length: 7 }, () => [] as number[])
  values.forEach((value, i) => {
    if (value !== null) byWeekday[weekdayIndex(days[i])].push(value)
  })
  const known = byWeekday.map((list, weekday) => ({ weekday, n: list.length, mean: mean(list) })).filter((w) => w.n >= 2)
  if (known.length < 4) return null
  const best = [...known].sort((a, b) => (b.mean as number) - (a.mean as number))
  // Only when one day really stands out from the rest.
  return (best[0].mean as number) - (best[1].mean as number) >= 0.5 ? best[0].weekday : null
}

/**
 * What goes with what: the reasons tapped more on days a scale stood high (4 or 5) than
 * on the other days, and the ones tapped more when it stood low (1 or 2). At most three
 * each, and only once there is enough to go on. A companion, not a cause.
 */
export function goesWith(entries: readonly Entry[], scale: CheckinScale, days: readonly Day[]): { high: string[]; low: string[] } {
  const found = within(entries, days).filter((e) => e.body[scale] !== undefined)
  if (found.length < ENOUGH) return { high: [], low: [] }
  const pick = (test: (value: number) => boolean): string[] => {
    const inside = found.filter((e) => test(e.body[scale] as number))
    const outside = found.filter((e) => !test(e.body[scale] as number))
    if (inside.length < 2) return []
    const count = (list: readonly Slotted[], id: string) => list.filter((e) => e.body.why?.chips.includes(id)).length
    const ids = new Set(inside.flatMap((e) => e.body.why?.chips ?? []))
    return [...ids]
      .map((id) => ({ id, here: count(inside, id), share: count(inside, id) / inside.length, elsewhere: outside.length === 0 ? 0 : count(outside, id) / outside.length }))
      .filter((r) => r.here >= 2 && r.share > r.elsewhere)
      .sort((a, b) => b.share - b.elsewhere - (a.share - a.elsewhere) || a.id.localeCompare(b.id))
      .slice(0, 3)
      .map((r) => r.id)
  }
  return { high: pick((v) => v >= 4), low: pick((v) => v <= 2) }
}

/** The newest entry of today's two halves that carries this scale, if any: "the weather". */
export function latest(entries: readonly Entry[], scale: CheckinScale, day: Day): { value: number; half: Half } | null {
  const found = within(entries, [day]).filter((e) => e.body[scale] !== undefined)
  const pick = found.find((e) => e.half === 'pm') ?? found.find((e) => e.half === 'am')
  return pick ? { value: pick.body[scale] as number, half: pick.half } : null
}
