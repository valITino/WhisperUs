// Notifications, as the app sees them: the device's state for screens to read, and the
// quiet upkeep that keeps the cloud's copy of this device's subscription fresh.
// The logic is in src/data/push.ts.

import { useSyncExternalStore } from 'react'
import { push } from '../data/app'
import type { PushView } from '../data/push'

/**
 * Call once when the app starts. Never asks for permission: that only follows a tap.
 * A device that has notifications off asks the cloud nothing here.
 */
export function startNotifications(): void {
  void push.refresh()
  // A choice made offline (muting a kind) reaches the cloud when the connection is back.
  window.addEventListener('online', () => void push.refresh())
}

/** On or off on this device, and which kinds are muted. */
export function usePush(): PushView {
  return useSyncExternalStore(push.subscribe, () => push.current)
}
