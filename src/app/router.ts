// A tiny hash router. Hash routes work on GitHub Pages without redirect tricks and
// keep the installed app on a single URL.

import { useSyncExternalStore } from 'react'

export interface Route {
  /** Always starts with "/", never ends with one (except the root). */
  path: string
  segments: string[]
  query: URLSearchParams
}

let cachedHash: string | null = null
let cachedRoute: Route = { path: '/', segments: [], query: new URLSearchParams() }
const listeners = new Set<() => void>()

function current(): Route {
  const hash = window.location.hash
  if (hash === cachedHash) return cachedRoute
  const raw = hash.replace(/^#/, '') || '/'
  const [rawPath, rawQuery = ''] = raw.split('?')
  const path = `/${rawPath.replace(/^\/+|\/+$/g, '')}`
  cachedHash = hash
  cachedRoute = { path, segments: path.split('/').filter(Boolean), query: new URLSearchParams(rawQuery) }
  return cachedRoute
}

const notify = () => listeners.forEach((fn) => fn())

/** The page currently on screen, remembered so it can be put back if leaving is refused. */
let shownHash = typeof window !== 'undefined' ? window.location.hash : ''
let shownDepth = typeof window !== 'undefined' ? ((window.history.state as { depth?: number } | null)?.depth ?? 0) : 0
let blocker: (() => boolean) | null = null

/**
 * While set, the phone's own back button asks before leaving the page: the function is
 * called, and if it returns true the page stays (nothing typed is lost). One per page:
 * forms with unsaved changes (useLeaveGuard) and the step-by-step start use it.
 * navigate() and back() are never blocked. Sheets close on back by themselves (see layers).
 */
export function setBlocker(fn: (() => boolean) | null): void {
  blocker = fn
}

// ---- layers: sheets that lie on top of a page ----
//
// Opening a sheet adds one step to the phone's history (same address). Android's back
// button or swipe then takes that step back and the sheet closes, instead of the page
// or the whole app going away. Every other way of closing has to take the step back
// itself, and navigate() and back() have to step over it. All of that lives here.

interface Layer {
  id: number
  onBack: () => void
  /** Closed already. Its step may still be in the history until the layers above it are gone. */
  done: boolean
}

/** The steps above the current page, oldest first. */
const layers: Layer[] = []
let layerCount = 0
/** True while we are taking steps back ourselves: the next history event is ours. */
let collapsing = false
const afterCollapse: (() => void)[] = []

/** Take the closed layers at the top of the pile out of the history. */
function dropClosedLayers(): void {
  let count = 0
  while (layers.length > 0 && layers[layers.length - 1].done) {
    layers.pop()
    count += 1
  }
  if (count === 0) return
  collapsing = true
  window.history.go(-count)
}

/**
 * Call when a sheet opens. onBack is called when the phone's back button closes it.
 * Returns a function to call when the sheet closes for any other reason.
 */
export function pushLayer(onBack: () => void): () => void {
  const layer: Layer = { id: ++layerCount, onBack, done: false }
  layers.push(layer)
  window.history.pushState({ ...(window.history.state as object | null), layer: layer.id }, '')
  return () => {
    if (layer.done) return
    // Closing a sheet and moving on often happen in the same breath. Wait a moment:
    // navigate() and back() deal with the step themselves and mark the layer done.
    setTimeout(() => {
      if (layer.done) return
      layer.done = true
      if (!collapsing) dropClosedLayers()
    }, 0)
  }
}

/** Forget every layer: the page is moving on. Returns how many steps they took up. */
function abandonLayers(): number {
  const count = layers.length
  for (const layer of layers) layer.done = true
  layers.length = 0
  return count
}

function remember(): void {
  shownHash = window.location.hash
  shownDepth = depth()
}

/** The layer whose step is on top of the history right now, if any. */
const layerOnTop = (): number | undefined => (window.history.state as { layer?: number } | null)?.layer

function onHistoryEvent(): void {
  // Going back fires two events (popstate, then hashchange a moment later), and the second
  // can arrive after a sheet has opened. So never guess from the event alone: compare the
  // history's top step with the pile of layers.
  const top = layers.length > 0 ? layers[layers.length - 1].id : undefined

  if (collapsing) {
    // Steps we are taking back ourselves. Not landed yet: this event is an echo of something older.
    if (layerOnTop() !== top) return
    collapsing = false
    remember()
    notify()
    const todo = afterCollapse.splice(0)
    for (const run of todo) run()
    if (!collapsing) dropClosedLayers()
    return
  }
  if (layers.length > 0 && window.location.hash === shownHash) {
    if (layerOnTop() === top) return // nothing moved
    // The phone's back button took a sheet's step back: that sheet closes.
    while (layers.length > 0 && layers[layers.length - 1].id !== layerOnTop()) {
      const layer = layers.pop() as Layer
      if (!layer.done) {
        layer.done = true
        layer.onBack()
      }
    }
    dropClosedLayers()
    remember()
    return
  }
  if (window.location.hash !== shownHash && blocker?.()) {
    window.history.pushState({ depth: shownDepth }, '', shownHash || '#/')
    return
  }
  remember()
  notify()
}

if (typeof window !== 'undefined') {
  window.addEventListener('hashchange', onHistoryEvent)
  window.addEventListener('popstate', onHistoryEvent)
}

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange)
  return () => listeners.delete(onChange)
}

/** The address right now, outside of React. */
export function currentPath(): string {
  return current().path
}

export function useRoute(): Route {
  return useSyncExternalStore(subscribe, current)
}

/**
 * How many in-app steps lie behind the current page. It is stored on the history
 * entry itself, so it stays right when the Android back button is used.
 */
function depth(): number {
  const state = window.history.state as { depth?: number } | null
  return state?.depth ?? 0
}

export function navigate(to: string, options: { replace?: boolean } = {}): void {
  if (collapsing) {
    // We are in the middle of stepping back over a closed sheet. Go once that has landed.
    afterCollapse.push(() => navigate(to, options))
    return
  }
  const here = depth()
  const lowest = layers[0]?.id ?? 0
  const open = abandonLayers()
  if (open > 1) {
    // Sheets on sheets (or a closed sheet whose step still lies under an open one): step
    // back to the lowest one first, then move on from there. The stand-in carries that
    // layer's id, because landing is recognised by the id on top of the history.
    layers.push({ id: lowest, onBack: () => {}, done: false })
    collapsing = true
    afterCollapse.push(() => navigate(to, options))
    window.history.go(-(open - 1))
    return
  }
  // A sheet that is still open gives its step in the history to the new page.
  if (open === 1) window.history.replaceState({ depth: here + 1 }, '', `#${to}`)
  else if (options.replace) window.history.replaceState({ depth: here }, '', `#${to}`)
  else window.history.pushState({ depth: here + 1 }, '', `#${to}`)
  remember()
  notify()
}

/** Go back one step, or to the fallback when the app was opened directly on this page. */
export function back(fallback = '/'): void {
  if (collapsing) {
    afterCollapse.push(() => back(fallback))
    return
  }
  const here = depth()
  const open = abandonLayers()
  if (here > 0) {
    if (open > 0) collapsing = true
    window.history.go(-(open + 1))
  } else if (open > 0) {
    collapsing = true
    afterCollapse.push(() => navigate(fallback, { replace: true }))
    window.history.go(-open)
  } else navigate(fallback, { replace: true })
}

/** matchPath('/envelope/:id', '/envelope/abc') → { id: 'abc' } */
export function matchPath(pattern: string, path: string): Record<string, string> | null {
  const want = pattern.split('/').filter(Boolean)
  const have = path.split('/').filter(Boolean)
  if (want.length !== have.length) return null
  const params: Record<string, string> = {}
  for (let i = 0; i < want.length; i++) {
    if (want[i].startsWith(':')) params[want[i].slice(1)] = decodeURIComponent(have[i])
    else if (want[i] !== have[i]) return null
  }
  return params
}

/** The public link to a route, for sharing (invite links). */
export function publicUrl(route: string): string {
  return `${window.location.origin}${window.location.pathname}#${route}`
}
