import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { addressOf, FALLBACK, pickWindow, readMessage, safeRoute } from '../../src/sw/notify'
import { answerFor, neverChanges } from '../../src/sw/shell'
import { shellOf } from '../../tools/serviceWorkerPlugin'

// The service worker's rules, without the worker: which requests it answers from its
// saved copy of the app, what it makes of a push message, and which files the build
// tells it to save. The worker itself is tested in a real browser (tests/pwa).

const SCOPE = 'https://example.github.io/WhisperUs/'
const FILES = new Set(['index.html', 'manifest.webmanifest', 'icons/icon-192.png', 'assets/index-abc123.js', 'assets/index-def456.css', 'assets/nunito-latin.woff2'])
const get = (url: string, mode = 'cors') => answerFor({ method: 'GET', url, mode }, SCOPE, FILES)

describe('what the worker answers', () => {
  it('opening the app: a fresh page if the network is quick, else the saved one', () => {
    expect(get(SCOPE, 'navigate')).toEqual({ kind: 'page' })
    expect(get(`${SCOPE}index.html`, 'navigate')).toEqual({ kind: 'page' })
    expect(get(`${SCOPE}?source=homescreen`, 'navigate')).toEqual({ kind: 'page' })
    // The route lives after the #, which never reaches the worker.
    expect(get(`${SCOPE}#/envelope/123`, 'navigate')).toEqual({ kind: 'page' })
  })

  it("the app's own files come from the saved copy", () => {
    expect(get(`${SCOPE}assets/index-abc123.js`, 'no-cors')).toEqual({ kind: 'file', file: 'assets/index-abc123.js' })
    expect(get(`${SCOPE}assets/nunito-latin.woff2`)).toEqual({ kind: 'file', file: 'assets/nunito-latin.woff2' })
    expect(get(`${SCOPE}manifest.webmanifest`)).toEqual({ kind: 'file', file: 'manifest.webmanifest' })
    expect(get(`${SCOPE}icons/icon-192.png?v=2`)).toEqual({ kind: 'file', file: 'icons/icon-192.png' })
  })

  it('the cloud is never answered from a copy, and never saved', () => {
    expect(get('https://abcdefghijklmnopqrst.supabase.co/rest/v1/rpc/sync_pull')).toEqual({ kind: 'pass' })
    expect(get('https://abcdefghijklmnopqrst.supabase.co/storage/v1/object/media/h/m.bin')).toEqual({ kind: 'pass' })
    expect(get('wss://abcdefghijklmnopqrst.supabase.co/realtime/v1/websocket')).toEqual({ kind: 'pass' })
    // The pretend cloud of the dev and preview servers, wherever the app is mounted.
    expect(get('https://example.github.io/__cloud/rpc/pull')).toEqual({ kind: 'pass' })
    expect(get(`${SCOPE}__cloud/events?household=1`)).toEqual({ kind: 'pass' })
    expect(answerFor({ method: 'GET', url: 'http://127.0.0.1:4173/__cloud/blob/h/p.jpg', mode: 'cors' }, 'http://127.0.0.1:4173/', new Set(['index.html']))).toEqual({ kind: 'pass' })
  })

  it('anything that changes data passes straight through', () => {
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE', 'HEAD']) {
      expect(answerFor({ method, url: `${SCOPE}assets/index-abc123.js`, mode: 'cors' }, SCOPE, FILES)).toEqual({ kind: 'pass' })
    }
  })

  it('what it does not know, it leaves alone', () => {
    expect(get(`${SCOPE}assets/index-OLDER.js`)).toEqual({ kind: 'pass' })
    expect(get(`${SCOPE}assets/index-abc123.js.map`)).toEqual({ kind: 'pass' })
    expect(get(`${SCOPE}sw.js`)).toEqual({ kind: 'pass' })
    // Other sites on the same host are none of its business.
    expect(get('https://example.github.io/other-app/', 'navigate')).toEqual({ kind: 'pass' })
    expect(get('https://example.github.io/whisperus-two/index.html', 'navigate')).toEqual({ kind: 'pass' })
    // The page fetched by a script (not opened) is not swapped for a copy.
    expect(get(`${SCOPE}index.html`)).toEqual({ kind: 'pass' })
  })

  it('works when the app sits at the root of its site', () => {
    const root = 'http://127.0.0.1:4173/'
    expect(answerFor({ method: 'GET', url: root, mode: 'navigate' }, root, FILES)).toEqual({ kind: 'page' })
    expect(answerFor({ method: 'GET', url: `${root}assets/index-abc123.js`, mode: 'cors' }, root, FILES)).toEqual({ kind: 'file', file: 'assets/index-abc123.js' })
  })

  it('knows which saved files can never go stale', () => {
    expect(neverChanges('assets/index-abc123.js')).toBe(true)
    expect(neverChanges('index.html')).toBe(false)
    expect(neverChanges('icons/icon-192.png')).toBe(false)
  })
})

describe('what the worker makes of a push message', () => {
  const message = { type: 'opened', title: 'It is open', body: "Mia's envelope is open for you now.", tag: 'envelope-0f8fad5b', url: '/envelope/0f8fad5b-d9cb-469f-a165-70867728950e' }

  it('reads what the cloud wrote', () => {
    expect(readMessage(message)).toEqual({ title: 'It is open', body: "Mia's envelope is open for you now.", tag: 'envelope-0f8fad5b', route: '/envelope/0f8fad5b-d9cb-469f-a165-70867728950e' })
  })

  it('always has something to show, whatever arrives', () => {
    for (const odd of [null, undefined, 'hello', 42, [], {}, { title: 'Only a title' }, { title: '  ', body: 'x' }, { title: 7, body: 8 }]) {
      expect(readMessage(odd)).toEqual(FALLBACK)
    }
    expect(readMessage({ title: 'Hi', body: 'There' })).toEqual({ title: 'Hi', body: 'There', tag: 'whisperus', route: '/' })
    expect(readMessage({ ...message, title: 'x'.repeat(500) }).title).toHaveLength(80)
  })

  it('only ever opens a page of the app', () => {
    expect(safeRoute('/envelope/abc-123')).toBe('/envelope/abc-123')
    expect(safeRoute('/')).toBe('/')
    for (const bad of ['https://evil.example/', '//evil.example/', 'javascript:alert(1)', '/envelope/../../x?y', '/a b', 'envelope/1', '', null, 7, '/x//evil.example']) {
      expect(safeRoute(bad), String(bad)).toBe('/')
    }
    expect(readMessage({ ...message, url: 'https://evil.example/' }).route).toBe('/')
    expect(addressOf('/envelope/abc', SCOPE)).toBe('https://example.github.io/WhisperUs/#/envelope/abc')
    expect(addressOf('https://evil.example/', SCOPE)).toBe('https://example.github.io/WhisperUs/#/')
    expect(addressOf('/envelope/1', 'http://127.0.0.1:4173/')).toBe('http://127.0.0.1:4173/#/envelope/1')
  })

  it('brings the right window to the front', () => {
    const win = (url: string, focused = false, visibilityState = 'hidden') => ({ url, focused, visibilityState })
    expect(pickWindow([], SCOPE)).toBe(-1)
    expect(pickWindow([win('https://example.github.io/other-app/')], SCOPE)).toBe(-1)
    expect(pickWindow([win('https://example.github.io/other-app/', true), win(`${SCOPE}#/week`)], SCOPE)).toBe(1)
    expect(pickWindow([win(`${SCOPE}#/`), win(`${SCOPE}#/week`, false, 'visible')], SCOPE)).toBe(1)
    expect(pickWindow([win(`${SCOPE}#/`), win(`${SCOPE}#/week`, false, 'visible'), win(`${SCOPE}#/cockpit`, true, 'visible')], SCOPE)).toBe(2)
  })
})

describe('what the build tells the worker to save', () => {
  const made: string[] = []
  afterEach(() => {
    for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true })
  })

  function build(files: Record<string, string>): string {
    const dir = mkdtempSync(join(tmpdir(), 'fw-shell-'))
    made.push(dir)
    for (const [file, content] of Object.entries(files)) {
      mkdirSync(join(dir, file, '..'), { recursive: true })
      writeFileSync(join(dir, file), content)
    }
    return dir
  }

  const app = {
    'index.html': '<html></html>',
    'manifest.webmanifest': '{}',
    'icons/icon-192.png': 'png',
    'assets/index-abc.js': 'console.log(1)',
    'assets/index-abc.js.map': '{}',
    'assets/font.woff2': 'woff2',
    'assets/font.woff': 'woff',
    'sw.js': 'old worker',
    '.DS_Store': 'x',
  }

  it('everything a phone asks for, and nothing else', () => {
    expect(shellOf(build(app)).files).toEqual(['assets/font.woff2', 'assets/index-abc.js', 'icons/icon-192.png', 'index.html', 'manifest.webmanifest'])
  })

  it('the same files give the same version; any change gives a new one', () => {
    const first = shellOf(build(app)).version
    expect(first).toMatch(/^[0-9a-f]{16}$/)
    expect(shellOf(build(app)).version).toBe(first)
    // Files the worker does not save do not count.
    expect(shellOf(build({ ...app, 'sw.js': 'another worker', 'assets/index-abc.js.map': '{"new":1}' })).version).toBe(first)
    expect(shellOf(build({ ...app, 'index.html': '<html lang="en"></html>' })).version).not.toBe(first)
    expect(shellOf(build({ ...app, 'icons/icon-512.png': 'png' })).version).not.toBe(first)
    const { 'manifest.webmanifest': _gone, ...without } = app
    expect(shellOf(build(without)).version).not.toBe(first)
  })
})
