// Which requests the service worker answers, and how. Kept free of the worker's own
// machinery so the rules can be unit-tested.
//
// The worker saves the app itself (HTML, scripts, styles, fonts, icons, the manifest)
// and nothing else. The room's data never passes through it: calls to the cloud go
// straight to the network, every time.

export type Answer =
  /** Not ours. The browser handles it as if there were no service worker. Never saved. */
  | { kind: 'pass' }
  /** Opening the app: a fresh page from the network when it answers in time, else the saved one. */
  | { kind: 'page' }
  /** One of the app's own files: the saved copy. */
  | { kind: 'file'; file: string }

export interface AskedFor {
  method: string
  url: string
  /** "navigate" when the browser is opening a page. */
  mode: string
}

/** The page the app lives on, relative to the worker's scope. */
export const PAGE = 'index.html'

/**
 * @param scope where the app lives, for example "https://example.org/whisperus/"
 * @param files the app's files, relative to the scope
 */
export function answerFor(request: AskedFor, scope: string, files: ReadonlySet<string>): Answer {
  if (request.method !== 'GET') return { kind: 'pass' }
  const url = new URL(request.url)
  const home = new URL(scope)
  // Supabase, and anything else that is not this site.
  if (url.origin !== home.origin) return { kind: 'pass' }
  // The pretend cloud of the dev and preview servers.
  if (url.pathname.split('/').includes('__cloud')) return { kind: 'pass' }
  if (!url.pathname.startsWith(home.pathname)) return { kind: 'pass' }

  const file = url.pathname.slice(home.pathname.length)
  if (file === '' || file === PAGE) return request.mode === 'navigate' ? { kind: 'page' } : { kind: 'pass' }
  return files.has(file) ? { kind: 'file', file } : { kind: 'pass' }
}

/** Files with a fingerprint of their content in the name: a saved copy never goes stale. */
export const neverChanges = (file: string): boolean => file.startsWith('assets/')
