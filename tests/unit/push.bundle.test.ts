import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { base64Url, makeBrowser, open, type Browser } from './pushBrowser'

// The push function is deployed as ONE file: `npm run build:push` bundles it into
// supabase/functions/push/dist/index.js, and that text is pasted into the connector.
// This test builds that very file, loads it the way Supabase's runtime would (with a
// stand-in for the `Deno` it expects) and runs real calls through it.

const root = join(__dirname, '../..')
const file = join(root, 'supabase/functions/push/dist/index.js')
const SUPABASE = 'https://project.supabase.test'
const SERVICE_KEY = 'service-role-key-for-tests'
const SECRET = 'a-shared-secret-made-in-the-database-0123456789'
const H = '11111111-1111-4111-8111-111111111111'
const MIA = '22222222-2222-4222-8222-222222222222'
const LEO = '33333333-3333-4333-8333-333333333333'
const ENVELOPE = '0f8fad5b-d9cb-469f-a165-70867728950e'

let printed = ''
let bundle = ''
let served: (request: Request) => Promise<Response>
let browser: Browser
const settings: { secret: string; subject: string; vapid_public: string | null; vapid_private: string | null } = { secret: SECRET, subject: 'https://room.example.org/', vapid_public: null, vapid_private: null }
const pushes: { url: string; headers: Record<string, string>; body: Uint8Array }[] = []
const asked: string[] = []

/** The database and the push service, as far as one opening needs them. */
const world = (async (input: string | URL | Request, init: RequestInit = {}) => {
  const url = new URL(String(input))
  const reply = (body: unknown) => new Response(JSON.stringify(body), { status: 200 })
  if (url.origin === 'https://push.service.test') {
    pushes.push({ url: url.href, headers: init.headers as Record<string, string>, body: init.body as Uint8Array })
    return new Response(null, { status: 201 })
  }
  if (url.origin !== SUPABASE) throw new Error(`a test must never reach ${url.origin}`)
  expect(init.headers).toMatchObject({ apikey: SERVICE_KEY })
  const what = url.pathname.replace('/rest/v1/', '')
  asked.push(what)
  if (what === 'rpc/push_settings') return reply(settings)
  if (what === 'rpc/push_store_keys') {
    const sent = JSON.parse(String(init.body)) as { p_public: string; p_private: string }
    if (!settings.vapid_public) Object.assign(settings, { vapid_public: sent.p_public, vapid_private: sent.p_private })
    return reply({ vapid_public: settings.vapid_public, vapid_private: settings.vapid_private })
  }
  if (what === 'members') return reply([{ id: MIA, name: 'Mia', prefs: {}, disabled_at: null }, { id: LEO, name: 'Leo', prefs: { lang: 'de' }, disabled_at: null }])
  if (what === 'envelopes') return reply([{ author_id: MIA, open_mode: 'now', opens_at: null, created_at: new Date().toISOString(), deleted_at: null, seen: {}, reply: null }])
  if (what === 'keys') return reply([{ layer: 'words', opens_at: new Date().toISOString() }])
  if (what === 'push_subscriptions') return reply([{ id: browser.id, member_id: LEO, endpoint: browser.endpoint, p256dh: base64Url(browser.publicKey), auth: base64Url(browser.auth), muted_types: [] }])
  return reply([])
}) as typeof fetch

const post = (body: unknown, secret: string | null = SECRET) => served(new Request(`${SUPABASE}/functions/v1/push`, { method: 'POST', headers: secret ? { 'x-push-secret': secret } : {}, body: JSON.stringify(body) }))

beforeAll(async () => {
  printed = execFileSync('node', ['tools/build-push.mjs'], { cwd: root, encoding: 'utf8' })
  bundle = readFileSync(file, 'utf8')
  browser = await makeBrowser('leo-phone')

  // What Supabase's runtime provides: the two settings every function gets, and serve().
  vi.stubGlobal('Deno', {
    env: { get: (name: string) => ({ SUPABASE_URL: SUPABASE, SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY })[name] },
    serve: (handler: typeof served) => void (served = handler),
  })
  vi.stubGlobal('fetch', world)
  await import(/* @vite-ignore */ `${pathToFileURL(file).href}?built=${Date.now()}`)
}, 60_000)

afterAll(() => {
  vi.unstubAllGlobals()
})

describe('the one file that gets deployed', () => {
  it('stands alone and is plain enough to be pasted', () => {
    expect(bundle).not.toMatch(/^\s*(import|export)\s/m)
    // Nothing that a JSON string or a shell would have to escape twice.
    expect(bundle).not.toContain('\\')
    expect(bundle).not.toContain('@__PURE__')
    // Readable: not minified, no line a person could not follow.
    expect(bundle.split('\n').length).toBeGreaterThan(200)
    expect(Math.max(...bundle.split('\n').map((line) => line.length))).toBeLessThan(260)
    // Everything beyond plain ASCII are the umlauts of the German words.
    expect([...new Set(bundle.match(/[^\x00-\x7F]/g) ?? [])].sort()).toEqual(['ö', 'ü'])
    // It asks its environment for the two things Supabase gives every function, and nothing else.
    expect([...bundle.matchAll(/Deno\.env\.get\("(\w+)"\)/g)].map(([, name]) => name).sort()).toEqual(['SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_URL'])
    expect(bundle).not.toMatch(/VAPID_|PUSH_SECRET/)
    expect(bundle.length).toBeLessThan(20_000)
  })

  it('is the file whose size and checksum the build prints', () => {
    const bytes = Buffer.from(bundle, 'utf8')
    expect(printed).toContain('supabase/functions/push/dist/index.js')
    expect(printed).toContain(`size    ${bytes.length} bytes`)
    expect(printed).toContain(`sha256  ${createHash('sha256').update(bytes).digest('hex')}`)
    // Building twice gives the same file, byte for byte.
    expect(execFileSync('node', ['tools/build-push.mjs'], { cwd: root, encoding: 'utf8' })).toBe(printed)
    expect(readFileSync(file, 'utf8')).toBe(bundle)
  })

  it('serves: refuses strangers, makes the keys on "init", and sends a real notification', async () => {
    expect(typeof served).toBe('function')
    expect((await post({ type: 'init' }, null)).status).toBe(401)
    expect((await post({ type: 'init' }, 'a wrong secret')).status).toBe(401)
    expect(settings.vapid_public).toBeNull()

    const init = await post({ type: 'init' })
    expect(init.status).toBe(200)
    const { ok, publicKey } = (await init.json()) as { ok: boolean; publicKey: string }
    expect(ok).toBe(true)
    expect(publicKey).toMatch(/^B[A-Za-z0-9_-]{86}$/)
    expect(settings).toMatchObject({ vapid_public: publicKey })
    expect(settings.vapid_private).toMatch(/^[A-Za-z0-9_-]{43}$/)

    const answer = await post({ type: 'opened', household_id: H, actor_id: MIA, envelope_id: ENVELOPE })
    expect(await answer.json()).toEqual({ type: 'opened', sent: 1, gone: 0, failed: 0 })
    expect(pushes).toHaveLength(1)
    expect(pushes[0].url).toBe(browser.endpoint)
    expect(pushes[0].headers).toMatchObject({ 'Content-Encoding': 'aes128gcm', Urgency: 'high' })
    expect(pushes[0].headers.Authorization).toContain(`k=${publicKey}`)
    // The browser can open it, umlauts and all.
    expect(await open(pushes[0].body, browser)).toEqual({ type: 'opened', title: 'Es ist offen', body: 'Der Umschlag von Mia ist jetzt offen für dich.', tag: `envelope-${ENVELOPE}`, url: `/envelope/${ENVELOPE}` })
    expect(asked).toContain('rpc/push_store_keys')
  })
})
