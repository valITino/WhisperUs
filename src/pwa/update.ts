// "A new version is ready": what the page knows about it. The service worker side lives
// in src/sw/sw.ts, the wiring between the two in register.ts.

import { useSyncExternalStore } from 'react'

let ready = false
let dismissed = false
let reload: () => void = () => window.location.reload()
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((fn) => fn())

/** The build this page belongs to. The build writes it into index.html; "dev" while developing. */
export function pageVersion(): string {
  return document.querySelector('meta[name="app-version"]')?.getAttribute('content') ?? 'dev'
}

/** A newer version is waiting. `how` is what "Reload" does. */
export function announceUpdate(how?: () => void): void {
  if (how) reload = how
  ready = true
  dismissed = false
  emit()
}

/** "Later": the note goes away. The new version arrives the next time the app is opened. */
export function dismissUpdate(): void {
  dismissed = true
  emit()
}

/** Switch to the new version now. Only ever called from a tap. */
export function reloadIntoUpdate(): void {
  reload()
}

export function useUpdateReady(): boolean {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn)
      return () => listeners.delete(fn)
    },
    () => ready && !dismissed,
  )
}
