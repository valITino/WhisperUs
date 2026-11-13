// By day (light), after dark (dark) or follow the phone.

import { useSyncExternalStore } from 'react'

export type ThemeChoice = 'auto' | 'light' | 'dark'
const KEY = 'whisperus.theme'
const listeners = new Set<() => void>()

export function getTheme(): ThemeChoice {
  try {
    const saved = localStorage.getItem(KEY)
    if (saved === 'light' || saved === 'dark') return saved
  } catch {
    /* ignore */
  }
  return 'auto'
}

function apply(choice: ThemeChoice): void {
  const dark = choice === 'dark' || (choice === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches)
  document.documentElement.dataset.theme = dark ? 'dark' : 'light'
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#1b1220' : '#f4eef4')
}

export function setTheme(choice: ThemeChoice): void {
  try {
    localStorage.setItem(KEY, choice)
  } catch {
    /* ignore */
  }
  apply(choice)
  for (const fn of listeners) fn()
}

export function initTheme(): void {
  apply(getTheme())
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => apply(getTheme()))
}

/** Hear about every change. Returns a function that stops listening. */
export function onThemeChange(fn: () => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

export function useTheme(): ThemeChoice {
  return useSyncExternalStore((fn) => {
    listeners.add(fn)
    return () => listeners.delete(fn)
  }, getTheme)
}
