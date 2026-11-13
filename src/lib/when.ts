// Moments in words: "Today, 22:00", "tonight at 22:00", "in 2 h 14 min", "1:07".

import type { ISO } from '../data/types'
import type { Lang } from '../i18n'
// The very same words the notification uses, so the lock screen and the page agree.
import { whenWords } from '../../supabase/functions/push/logic'
import { formatTime, relativeDay, toDay } from './dates'

/** A moment as a label of its own: "Today, 22:00", "Tomorrow, 08:00", "Friday, 20:00". */
export function dayAndTime(moment: ISO, lang: Lang, labels: { today: string; tomorrow: string; yesterday: string }): string {
  return `${relativeDay(toDay(moment), lang, labels)}, ${formatTime(moment, lang)}`
}

/**
 * A moment as it reads inside a sentence: "It opens tonight at 22:00", "Opens on Friday
 * at 20:00". One that has come already, and waits only for the phone to hear of it, is
 * "any moment now".
 */
export function inWords(moment: ISO, lang: Lang, now = new Date()): string {
  return whenWords(moment, now, lang) || (lang === 'de' ? 'jeden Moment' : 'any moment now')
}

/** How long until a moment, roughly: "2 h 14 min", "5 min", "1 min". Null once it has come. */
export function timeLeft(until: ISO, now: number, lang: Lang): string | null {
  const ms = Date.parse(until) - now
  if (Number.isNaN(ms) || ms <= 0) return null
  const minutes = Math.max(1, Math.ceil(ms / 60_000))
  if (minutes < 60) return `${minutes} min`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return minutes % 60 === 0 ? `${hours} h` : `${hours} h ${minutes % 60} min`
  const days = Math.floor(hours / 24)
  const word = lang === 'de' ? (days === 1 ? 'Tag' : 'Tagen') : days === 1 ? 'day' : 'days'
  return `${days} ${word}`
}

/** "1:07" for a number of seconds. */
export function clock(seconds: number): string {
  const whole = Math.max(0, Math.round(seconds))
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`
}

/** The value a <input type="datetime-local"> wants for a moment, in the device's own time. */
export function toLocalInput(moment: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${moment.getFullYear()}-${pad(moment.getMonth() + 1)}-${pad(moment.getDate())}T${pad(moment.getHours())}:${pad(moment.getMinutes())}`
}
