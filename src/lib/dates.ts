// Calendar days and clock times. The room lives in Europe/Zurich: "today" and "tonight
// at 22:00" use that zone, whatever the phone is set to.

import type { Lang } from '../i18n'
import type { ISO } from '../data/types'

/** Calendar day in Europe/Zurich, "2026-11-13". */
export type Day = string

export const ZONE = 'Europe/Zurich'

const dayFormat = new Intl.DateTimeFormat('en-CA', { timeZone: ZONE, year: 'numeric', month: '2-digit', day: '2-digit' })

/** The Zurich calendar day of a moment, as "2026-11-10". */
export function toDay(moment: Date | ISO): Day {
  return dayFormat.format(typeof moment === 'string' ? new Date(moment) : moment)
}

export function today(): Day {
  return toDay(new Date())
}

/** A Day as a Date at noon UTC: safe for arithmetic, never crosses a date line. */
function asDate(day: Day): Date {
  return new Date(`${day}T12:00:00Z`)
}

function fromDate(date: Date): Day {
  return date.toISOString().slice(0, 10)
}

export function addDays(day: Day, amount: number): Day {
  const date = asDate(day)
  date.setUTCDate(date.getUTCDate() + amount)
  return fromDate(date)
}

export function diffDays(from: Day, to: Day): number {
  return Math.round((asDate(to).getTime() - asDate(from).getTime()) / 86_400_000)
}

/** 0 = Monday … 6 = Sunday. */
export function weekdayIndex(day: Day): number {
  return (asDate(day).getUTCDay() + 6) % 7
}

/** The seven days, Monday to Sunday, of the week containing the given day. */
export function weekOf(day: Day): Day[] {
  const monday = addDays(day, -weekdayIndex(day))
  return Array.from({ length: 7 }, (_, i) => addDays(monday, i))
}

/** Six weeks of days covering the month of the given day, starting on a Monday. */
export function monthGrid(day: Day): Day[] {
  const first = `${day.slice(0, 8)}01`
  const start = addDays(first, -weekdayIndex(first))
  return Array.from({ length: 42 }, (_, i) => addDays(start, i))
}

const locale = (lang: Lang) => (lang === 'de' ? 'de-CH' : 'en-GB')

type DayStyle = 'weekday' | 'weekday-short' | 'date' | 'date-short' | 'date-year' | 'full' | 'month'

export function formatDay(day: Day, lang: Lang, style: DayStyle = 'full'): string {
  const options: Record<DayStyle, Intl.DateTimeFormatOptions> = {
    weekday: { weekday: 'long' },
    'weekday-short': { weekday: 'short' },
    date: { day: 'numeric', month: 'long' },
    'date-short': { day: 'numeric', month: 'short' },
    'date-year': { day: 'numeric', month: 'long', year: 'numeric' },
    full: { weekday: 'long', day: 'numeric', month: 'long' },
    month: { month: 'long', year: 'numeric' },
  }
  return new Intl.DateTimeFormat(locale(lang), { timeZone: 'UTC', ...options[style] }).format(asDate(day))
}

/** "Today", "Tomorrow", "Yesterday", otherwise the weekday and date. */
export function relativeDay(day: Day, lang: Lang, labels: { today: string; tomorrow: string; yesterday: string }): string {
  const delta = diffDays(today(), day)
  if (delta === 0) return labels.today
  if (delta === 1) return labels.tomorrow
  if (delta === -1) return labels.yesterday
  return formatDay(day, lang, Math.abs(delta) < 7 ? 'weekday' : 'full')
}

export function formatTime(moment: ISO, lang: Lang): string {
  return new Intl.DateTimeFormat(locale(lang), { timeZone: ZONE, hour: '2-digit', minute: '2-digit' }).format(new Date(moment))
}

/** The hour of the day in Zurich, 0–23. Used for greetings. */
export function zurichHour(moment: Date | ISO = new Date()): number {
  const date = typeof moment === 'string' ? new Date(moment) : moment
  return Number(new Intl.DateTimeFormat('en-GB', { timeZone: ZONE, hour: '2-digit', hourCycle: 'h23' }).format(date))
}

// ---- from a Zurich wall-clock time back to a moment ----

const wallFormat = new Intl.DateTimeFormat('en-GB', {
  timeZone: ZONE,
  hourCycle: 'h23',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
})

/** How far Zurich's clock is ahead of UTC at that moment, in milliseconds. */
function offsetAt(utcMs: number): number {
  const part: Record<string, number> = {}
  for (const { type, value } of wallFormat.formatToParts(new Date(utcMs))) part[type] = Number(value)
  const wall = Date.UTC(part.year, part.month - 1, part.day, part.hour, part.minute, part.second)
  return wall - Math.floor(utcMs / 1000) * 1000
}

/** The moment when clocks in Zurich show the given day and time. Seconds may be fractional minutes. */
export function zurichMoment(day: Day, minutesAfterMidnight: number): Date {
  const wall = Date.parse(`${day}T00:00:00Z`) + Math.round(minutesAfterMidnight * 60) * 1000
  // Two rounds, so the answer is right on both sides of a daylight-saving change.
  let utc = wall - offsetAt(wall)
  utc = wall - offsetAt(utc)
  return new Date(utc)
}

export function zurichIso(day: Day, minutesAfterMidnight: number): ISO {
  return zurichMoment(day, minutesAfterMidnight).toISOString()
}

/** Minutes after midnight on the Zurich clock. */
export function zurichMinutes(moment: Date | ISO): number {
  const date = typeof moment === 'string' ? new Date(moment) : moment
  const part: Record<string, number> = {}
  for (const { type, value } of wallFormat.formatToParts(date)) part[type] = Number(value)
  return part.hour * 60 + part.minute + part.second / 60
}
