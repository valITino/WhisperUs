// explain() with the current language and the room's clock filled in.

import { useCallback } from 'react'
import { useCopy, useLang, type Lang } from '../../i18n'
import { diffDays, formatDay, formatTime, toDay, today } from '../../lib/dates'
import { errorCopy, explain } from './errors'

const TOMORROW = { en: 'tomorrow', de: 'morgen' }

/** A moment as people say it: "14:32" today, "tomorrow, 09:15", otherwise the weekday and time. */
export function sayWhen(moment: string, lang: Lang): string {
  const time = formatTime(moment, lang)
  const days = diffDays(today(), toDay(moment))
  if (days === 0) return time
  if (days === 1) return `${TOMORROW[lang]}, ${time}`
  return `${formatDay(toDay(moment), lang, 'weekday')}, ${time}`
}

/** Returns a function that turns any error into a sentence in the current language. */
export function useExplain(): (error: unknown) => string {
  const c = useCopy(errorCopy)
  const lang = useLang()
  return useCallback((error: unknown) => explain(error, c, (moment) => sayWhen(moment, lang)), [c, lang])
}
