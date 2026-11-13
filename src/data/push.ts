// Notifications on this device: on or off, and which kinds are muted.
//
// Three parties are involved. The browser holds the subscription (an address at its push
// service plus keys) and the permission. The cloud holds a copy of the address, so it
// knows where to send, and the list of muted kinds. And the cloud has the room's
// public key, which a browser needs to sign up; without one, notifications are not set
// up yet. PushControl keeps all of this in step and remembers on the device what was
// chosen and which key it last saw, so a choice made offline is not lost.
//
// The browser's side sits behind PushDevice, so the logic here can be unit-tested and
// the end-to-end tests can stand in for a push service.

import { isBackendError, PUSH_TYPES, type Backend, type PushType } from './backend'

/** What the browser's push service knows this device as. */
export interface DeviceSubscription {
  endpoint: string
  p256dh: string
  auth: string
}

export type Permission = 'default' | 'granted' | 'denied'

/** The browser's part: permission, and the subscription at its push service. */
export interface PushDevice {
  /** False when this browser cannot show notifications at all. */
  supported(): boolean
  permission(): Permission
  /** Shows the browser's question. Only ever called after a tap. */
  askPermission(): Promise<Permission>
  /**
   * The subscription this browser holds right now, if any. One made with a different key
   * (the room's keys were replaced) does not count: nothing sent to it would arrive.
   */
  current(vapidPublicKey: string): Promise<DeviceSubscription | null>
  /** Sign up at the browser's push service. Never asks for permission by itself. */
  subscribe(vapidPublicKey: string): Promise<DeviceSubscription>
  unsubscribe(): Promise<void>
}

export type PushStatus =
  /** This device has not been able to ask the cloud yet whether notifications are set up. */
  | 'unknown'
  /** The cloud has no key to sign up with: notifications are not set up for this room yet. */
  | 'unconfigured'
  /** This browser cannot do it, or the app runs without a service worker. */
  | 'unsupported'
  /** The person, or the browser, said no. Only the browser's own settings can undo that. */
  | 'blocked'
  | 'off'
  | 'on'

export interface PushView {
  status: PushStatus
  /** The kinds of notification this device does not want. */
  muted: readonly PushType[]
}

/** Why turning notifications on did not work. */
export type PushProblem =
  /** The browser's question was closed without an answer. */
  | 'dismissed'
  | 'blocked'
  /** The browser could not sign up at its push service. */
  | 'subscribe_failed'
  /** The cloud could not be reached. */
  | 'offline'
  /** The cloud said no (logged out, paused). */
  | 'refused'

/** Somewhere to keep a few small facts between visits. localStorage in the app. */
export interface PushMemory {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

const KEY = 'whisperus.push'

interface Remembered {
  /** The address the cloud knows this device by, or null while notifications are off. */
  endpoint: string | null
  muted: PushType[]
  /**
   * The room's public key as last heard from the cloud. Null: the cloud said there is
   * none yet. Undefined: never asked.
   */
  key?: string | null
}

const knownTypes = (types: unknown): PushType[] => PUSH_TYPES.filter((type) => Array.isArray(types) && types.includes(type))

export class PushControl {
  private view: PushView
  private remembered: Remembered
  private listeners = new Set<() => void>()
  private refreshing: Promise<void> | null = null
  /** True while the refresh that is running includes asking the cloud for the key. */
  private asking = false

  constructor(
    private readonly device: PushDevice,
    private readonly backend: Pick<Backend, 'pushPublicKey' | 'savePushSubscription' | 'setPushMuted' | 'removePushSubscription'>,
    private readonly memory: PushMemory,
    private readonly userAgent = '',
  ) {
    this.remembered = this.recall()
    this.view = { status: this.quickStatus(), muted: this.remembered.muted }
  }

  // ------------------------------------------------------------- reading --

  get current(): PushView {
    return this.view
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private show(status: PushStatus): void {
    const muted = this.remembered.muted
    if (status === this.view.status && muted.join() === this.view.muted.join()) return
    this.view = { status, muted }
    for (const listener of this.listeners) listener()
  }

  private recall(): Remembered {
    try {
      const raw = JSON.parse(this.memory.getItem(KEY) ?? '{}') as Partial<Remembered>
      const key = typeof raw.key === 'string' && raw.key ? raw.key : raw.key === null ? null : undefined
      return { endpoint: typeof raw.endpoint === 'string' ? raw.endpoint : null, muted: knownTypes(raw.muted), key }
    } catch {
      return { endpoint: null, muted: [] }
    }
  }

  private remember(changes: Partial<Remembered>): void {
    this.remembered = { ...this.remembered, ...changes }
    try {
      this.memory.setItem(KEY, JSON.stringify(this.remembered))
    } catch {
      /* private mode: it lasts until the page closes */
    }
  }

  /** What can be said without asking anybody anything slow. */
  private quickStatus(): PushStatus {
    if (!this.device.supported()) return 'unsupported'
    if (this.remembered.key === undefined) return 'unknown'
    if (this.remembered.key === null) return 'unconfigured'
    if (this.device.permission() === 'denied') return 'blocked'
    return this.remembered.endpoint ? 'on' : 'off'
  }

  // ------------------------------------------------------------- keeping in step --

  /**
   * Compare what this device remembers with what the browser really holds, and tell the
   * cloud again. Called when the app starts, when it comes back online and, with `ask`,
   * when the Notifications page opens. Never asks for permission, and never fails loudly.
   *
   * The room's key is fetched when the page asks, and at a start only if notifications
   * are on here: a device that never turned them on asks the cloud nothing.
   */
  refresh(ask = false): Promise<void> {
    if (ask && this.refreshing && !this.asking) return this.refreshing.then(() => this.refresh(true))
    this.asking = this.asking || ask
    return (this.refreshing ??= this.refreshOnce(ask).finally(() => {
      this.refreshing = null
      this.asking = false
    }))
  }

  private async refreshOnce(ask: boolean): Promise<void> {
    if (!this.device.supported()) return this.show('unsupported')
    if (ask || this.remembered.endpoint) {
      try {
        const key = await this.backend.pushPublicKey()
        if (key !== this.remembered.key) this.remember({ key })
      } catch {
        /* offline: go by the key last heard of */
      }
    }
    const quick = this.quickStatus()
    if (quick !== 'on') {
      // Blocked in the browser's settings since last time: the subscription is dead.
      if (quick === 'blocked' && this.remembered.endpoint) this.remember({ endpoint: null })
      return this.show(quick)
    }
    const key = this.remembered.key as string
    const was = this.remembered.endpoint as string
    let now: DeviceSubscription | null = null
    try {
      now = await this.device.current(key)
      // The browser dropped the subscription (it does that now and then), or the room
      // got new keys. Permission is still there, so signing up again asks nobody anything.
      if (!now && this.device.permission() === 'granted') now = await this.device.subscribe(key)
    } catch {
      now = null
    }
    if (!now) {
      this.remember({ endpoint: null })
      return this.show('off')
    }
    try {
      // Sent again on every start: it repairs a row the cloud lost, and delivers a
      // change of muted kinds that was made offline.
      await this.backend.savePushSubscription({ ...now, mutedTypes: this.remembered.muted, userAgent: this.userAgent })
      if (now.endpoint !== was) {
        this.remember({ endpoint: now.endpoint })
        await this.backend.removePushSubscription(was).catch(() => undefined)
      }
    } catch {
      /* offline or logged out: the next start tries again */
    }
    this.show('on')
  }

  // ------------------------------------------------------------- changing --

  /** After a tap on "Turn on notifications". Resolves with what went wrong, or null. */
  async turnOn(): Promise<PushProblem | null> {
    // Signing up needs the room's key. If this device never heard of it, ask now.
    if (this.quickStatus() === 'unknown') await this.refresh(true)
    const quick = this.quickStatus()
    if (quick === 'unknown') return 'offline'
    if (quick === 'unconfigured' || quick === 'unsupported') return 'subscribe_failed'
    if (quick === 'blocked') return 'blocked'
    const key = this.remembered.key as string

    let permission = this.device.permission()
    if (permission !== 'granted') {
      try {
        permission = await this.device.askPermission()
      } catch {
        permission = this.device.permission()
      }
    }
    if (permission === 'denied') {
      this.show('blocked')
      return 'blocked'
    }
    if (permission !== 'granted') return 'dismissed'

    let subscription: DeviceSubscription
    try {
      subscription = await this.device.subscribe(key)
    } catch {
      this.show(this.quickStatus())
      return 'subscribe_failed'
    }
    try {
      await this.backend.savePushSubscription({ ...subscription, mutedTypes: this.remembered.muted, userAgent: this.userAgent })
    } catch (e) {
      // Half on is worse than off: without the cloud knowing, nothing would ever arrive.
      await this.device.unsubscribe().catch(() => undefined)
      this.show(this.quickStatus())
      return isBackendError(e) && e.kind === 'network' ? 'offline' : 'refused'
    }
    this.remember({ endpoint: subscription.endpoint })
    this.show('on')
    return null
  }

  /** After a tap on "Turn off notifications". Always ends up off on this device. */
  async turnOff(): Promise<void> {
    const endpoint = this.remembered.endpoint
    this.remember({ endpoint: null })
    // If the cloud cannot be reached now, it still finds out: the push service reports
    // the address as gone at the next try, and the cloud forgets it then.
    if (endpoint) await this.backend.removePushSubscription(endpoint).catch(() => undefined)
    await this.device.unsubscribe().catch(() => undefined)
    this.show(this.quickStatus())
  }

  /**
   * Mute or unmute one kind of notification on this device. The choice is kept on the
   * device at once. Resolves false when the cloud could not be told yet; it is told
   * again at the next start.
   */
  async setMuted(type: PushType, muted: boolean): Promise<boolean> {
    const next = PUSH_TYPES.filter((t) => (t === type ? muted : this.remembered.muted.includes(t)))
    this.remember({ muted: next })
    this.show(this.view.status)
    const endpoint = this.remembered.endpoint
    if (!endpoint) return true
    try {
      await this.backend.setPushMuted(endpoint, next)
      return true
    } catch (e) {
      // The cloud lost the row: a full refresh writes it again, muted kinds included.
      if (isBackendError(e) && e.code === 'push_missing') {
        await this.refresh()
        return true
      }
      return false
    }
  }

  // ------------------------------------------------------------- logging out --

  /** Before logging out: the cloud forgets this device's address while it still knows who is asking. */
  async removeFromCloud(): Promise<void> {
    const endpoint = this.remembered.endpoint
    if (endpoint) await this.backend.removePushSubscription(endpoint)
  }

  /** The device is logged out: drop the subscription and what was remembered. Talks to no cloud. */
  async forget(): Promise<void> {
    try {
      this.memory.removeItem(KEY)
    } catch {
      /* ignore */
    }
    this.remembered = { endpoint: null, muted: [], key: undefined }
    if (this.device.supported()) await this.device.unsubscribe().catch(() => undefined)
    this.show(this.quickStatus())
  }
}

// --------------------------------------------------------------- the browser --

/** The device's own notebook. Reached for only when needed: some browsers refuse it. */
export const deviceMemory: PushMemory = {
  getItem: (key) => localStorage.getItem(key),
  setItem: (key, value) => localStorage.setItem(key, value),
  removeItem: (key) => localStorage.removeItem(key),
}

/** Development only: end-to-end tests stand in for the browser's push service. */
export interface PushRig {
  device?: PushDevice
}

/** The browser's side, as this build has it. */
export function pushDevice(): PushDevice {
  const rig = import.meta.env.DEV ? (globalThis as { __whisperusPush?: PushRig }).__whisperusPush : undefined
  return rig?.device ?? browserPushDevice()
}

function keyBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const padded = base64url.replaceAll('-', '+').replaceAll('_', '/').padEnd(Math.ceil(base64url.length / 4) * 4, '=')
  const binary = atob(padded)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

function read(subscription: PushSubscription): DeviceSubscription {
  const json = subscription.toJSON()
  return { endpoint: subscription.endpoint, p256dh: json.keys?.p256dh ?? '', auth: json.keys?.auth ?? '' }
}

/** Whether a subscription was made with this VAPID key. */
function madeWith(subscription: PushSubscription, key: Uint8Array): boolean {
  const theirs = subscription.options.applicationServerKey ? new Uint8Array(subscription.options.applicationServerKey) : null
  return theirs !== null && theirs.length === key.length && theirs.every((byte, i) => byte === key[i])
}

/** The real thing: the browser's service worker, PushManager and Notification. */
export function browserPushDevice(): PushDevice {
  const registration = async (): Promise<ServiceWorkerRegistration | null> => (await navigator.serviceWorker.getRegistration()) ?? null
  return {
    supported: () => typeof navigator !== 'undefined' && 'serviceWorker' in navigator && typeof window !== 'undefined' && 'PushManager' in window && 'Notification' in window,
    permission: () => Notification.permission,
    askPermission: () => Notification.requestPermission(),
    async current(vapidPublicKey) {
      const subscription = await (await registration())?.pushManager.getSubscription()
      return subscription && madeWith(subscription, keyBytes(vapidPublicKey)) ? read(subscription) : null
    },
    async subscribe(vapidPublicKey) {
      // Signing up needs a worker that is up and running. Right after the very first
      // start it may still be saving the app, so give it a moment. (No worker at all,
      // as on the dev server, gives up after that moment.)
      const worker = await Promise.race([navigator.serviceWorker.ready, new Promise<null>((resolve) => setTimeout(() => resolve(null), 8000))])
      if (!worker) throw new Error('no service worker')
      const key = keyBytes(vapidPublicKey)
      const existing = await worker.pushManager.getSubscription()
      if (existing) {
        if (madeWith(existing, key)) return read(existing)
        // Made with another key: the browser refuses a second one until it is gone.
        await existing.unsubscribe()
      }
      return read(await worker.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key }))
    },
    async unsubscribe() {
      await (await (await registration())?.pushManager.getSubscription())?.unsubscribe()
    },
  }
}
