// Settings of this device (not of the person: those live on the profile and follow them).

import { useSyncExternalStore } from 'react'

export interface Prefs {
  /** How long the app may be out of sight before it asks for the lock code again, in seconds. 0: at once. */
  lockAfter: number
}

const KEY = 'whisperus.prefs'
const defaults: Prefs = { lockAfter: 0 }
const listeners = new Set<() => void>()
let cache: Prefs | null = null

function read(): Prefs {
  if (cache) return cache
  try {
    cache = { ...defaults, ...(JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Prefs>) }
  } catch {
    cache = { ...defaults }
  }
  return cache
}

export function getPref<K extends keyof Prefs>(key: K): Prefs[K] {
  return read()[key]
}

export function setPref<K extends keyof Prefs>(key: K, value: Prefs[K]): void {
  cache = { ...read(), [key]: value }
  try {
    localStorage.setItem(KEY, JSON.stringify(cache))
  } catch {
    /* private mode: keep it in memory */
  }
  for (const fn of listeners) fn()
}

/** Hear about every change. Returns a function that stops listening. */
export function onPrefChange(fn: () => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

export function usePref<K extends keyof Prefs>(key: K): Prefs[K] {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn)
      return () => listeners.delete(fn)
    },
    () => read()[key],
  )
}
