// Which cloud this build belongs to. Decided when the app is built (the .env files), so
// the address is public by design: what protects the room is the database's rules and
// the seal, never a hidden address.

export interface CloudSettings {
  backend?: string
  url?: string
  key?: string
}

/**
 * Whether a build knows its cloud. One made before the room's cloud exists does not:
 * it shows a single page that says so, instead of a start screen whose buttons fail.
 */
export function cloudKnown(settings: CloudSettings): boolean {
  if (settings.backend === 'fake') return true
  const url = (settings.url ?? '').trim()
  const key = (settings.key ?? '').trim()
  return /^https:\/\/[a-z0-9.-]+\.[a-z]{2,}\/?$/i.test(url) && key.length >= 20
}
