// What the service worker makes of a push message, kept free of the worker's own
// machinery so it can be unit-tested. The message is written by the cloud
// (supabase/functions/push); this is the reading side.

export interface PushMessage {
  title: string
  body: string
  /** One per envelope, so a newer notification about the same envelope replaces the older one. */
  tag: string
  /** The page to open on tap, as an in-app route: "/envelope/<id>". */
  route: string
}

/**
 * Shown when a message arrives that this version cannot read. A push must always show
 * something, and what it shows is read on a lock screen: it says as little as the others.
 */
export const FALLBACK: PushMessage = { title: 'WhisperUs', body: 'Something is waiting for you.', tag: 'whisperus', route: '/' }

const text = (value: unknown, max: number): string | null => (typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : null)

/** Only routes of the app, never an address somewhere else. */
export function safeRoute(value: unknown): string {
  return typeof value === 'string' && /^\/[A-Za-z0-9/_-]{0,200}$/.test(value) && !value.includes('//') ? value : '/'
}

export function readMessage(data: unknown): PushMessage {
  if (typeof data !== 'object' || data === null) return FALLBACK
  const raw = data as Record<string, unknown>
  const title = text(raw.title, 80)
  const body = text(raw.body, 240)
  if (!title || !body) return FALLBACK
  return { title, body, tag: text(raw.tag, 64) ?? FALLBACK.tag, route: safeRoute(raw.url) }
}

/** The full address of a route, for opening the app when it is not running. */
export const addressOf = (route: string, scope: string): string => new URL(`#${safeRoute(route)}`, scope).href

export interface OpenWindow {
  url: string
  focused: boolean
  visibilityState: string
}

/** The app window to bring to the front: the one in use, else one on screen, else any. -1 when none is open. */
export function pickWindow(windows: readonly OpenWindow[], scope: string): number {
  const ours = windows.map((w, index) => ({ w, index })).filter(({ w }) => w.url.startsWith(scope))
  const best = ours.find(({ w }) => w.focused) ?? ours.find(({ w }) => w.visibilityState === 'visible') ?? ours[0]
  return best ? best.index : -1
}
