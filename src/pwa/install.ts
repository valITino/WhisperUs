// Installing the app to the home screen. Chrome offers it through an event that fires
// once, early, so it is caught here as soon as the app starts and kept until Settings
// wants it. Nothing is ever shown by itself: no banner, no pop-up.

import { useSyncExternalStore } from 'react'

export type InstallState =
  /** Already running as an installed app, or installed a moment ago: nothing to offer. */
  | 'installed'
  /** The browser offers its install prompt: one tap. */
  | 'ready'
  /** No prompt on offer: explain the way through the browser's menu. */
  | 'manual'

let offer: BeforeInstallPromptEvent | null = null
let justInstalled = false
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((fn) => fn())

function standalone(): boolean {
  const iosStandalone = (navigator as Navigator & { standalone?: boolean }).standalone === true
  return iosStandalone || ['standalone', 'fullscreen', 'minimal-ui'].some((mode) => window.matchMedia(`(display-mode: ${mode})`).matches)
}

function state(): InstallState {
  if (justInstalled || standalone()) return 'installed'
  return offer ? 'ready' : 'manual'
}

/** Call once when the app starts. */
export function watchInstall(): void {
  window.addEventListener('beforeinstallprompt', (event) => {
    // Keep Chrome's own banner away. The offer waits in Settings instead.
    event.preventDefault()
    offer = event
    emit()
  })
  window.addEventListener('appinstalled', () => {
    offer = null
    justInstalled = true
    emit()
  })
}

/** Show the browser's install prompt. Resolves true when the person said yes. */
export async function install(): Promise<boolean> {
  const event = offer
  if (!event) return false
  // An offer can be used once, whatever the answer.
  offer = null
  await event.prompt()
  const { outcome } = await event.userChoice
  if (outcome === 'accepted') justInstalled = true
  emit()
  return outcome === 'accepted'
}

export function useInstallState(): InstallState {
  return useSyncExternalStore((fn) => {
    listeners.add(fn)
    return () => listeners.delete(fn)
  }, state)
}
