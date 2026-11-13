// A tiny typed i18n: messages are plain objects, so a missing or misspelled key is a
// compile error and German can never drift out of shape.

import { useSyncExternalStore } from 'react'
import { de } from './de'
import { en, type Messages } from './en'

export type Lang = 'en' | 'de'
const KEY = 'whisperus.lang'
const dictionaries: Record<Lang, Messages> = { en, de }
const listeners = new Set<() => void>()

function initialLang(): Lang {
  try {
    const saved = localStorage.getItem(KEY)
    if (saved === 'en' || saved === 'de') return saved
  } catch {
    /* private mode: fall through */
  }
  return typeof navigator !== 'undefined' && navigator.language?.toLowerCase().startsWith('de') ? 'de' : 'en'
}

let lang: Lang = initialLang()

export function getLang(): Lang {
  return lang
}

export function setLang(next: Lang): void {
  lang = next
  try {
    localStorage.setItem(KEY, next)
  } catch {
    /* ignore */
  }
  if (typeof document !== 'undefined') document.documentElement.lang = next
  for (const fn of listeners) fn()
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

/** Hear about every change. Returns a function that stops listening. */
export const onLangChange = subscribe

export function useLang(): Lang {
  return useSyncExternalStore(subscribe, getLang)
}

/** The messages for the current language. */
export function useT(): Messages {
  return dictionaries[useLang()]
}

/**
 * Copy that belongs to one feature. Keep it next to the feature:
 *   const copy = { en: { title: 'Wishlist' }, de: { title: 'Wünsche' } }
 *   const c = useCopy(copy)
 * Both languages must have the same shape, or it will not compile.
 */
export function useCopy<T>(copy: { en: T; de: NoInfer<T> }): T {
  return copy[useLang()]
}

export type { Messages }
