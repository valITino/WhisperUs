import { beforeEach, describe, expect, it } from 'vitest'
import { pushHandler, SECRET_HEADER } from '../../supabase/functions/push/handler'
import { fromBase64Url, toBase64Url } from '../../supabase/functions/push/webpush'
import { makeBrowser, open, type Browser } from './pushBrowser'

// The whole push function, minus its Deno wrapper, run against a stand-in database
// (Supabase's REST dialect) and a stand-in push service. Nothing here leaves the machine.
//
// The function is given no secrets: the shared secret, the subject and the VAPID keys
// are in the database, and it fetches them with the service role.

const SUPABASE = 'https://project.supabase.test'
const SERVICE_KEY = 'service-role-key-for-tests'
const SECRET = 'a-shared-secret-of-decent-length-0123456789'
const H = '11111111-1111-4111-8111-111111111111'
const MIA = '22222222-2222-4222-8222-222222222222'
const LEO = '33333333-3333-4333-8333-333333333333'
const ENVELOPE = '0f8fad5b-d9cb-469f-a165-70867728950e'
const START = new Date('2026-11-10T17:30:00Z').getTime()
const SUBJECT = 'https://room.example.org/whisperus/'

/** Seconds from the start of the test, as the database writes a time. */
const at = (seconds: number) => new Date(START + seconds * 1000).toISOString()
// What must never travel: the line on the outside, the sealed inside, and a key.
const TEASER = 'about last Saturday'
const SEALED_BOX = 'c2VhbGVkLWluc2lkZS1vZi10aGUtZW52ZWxvcGU='
const KEY = 'a2V5LWtleS1rZXkta2V5LWtleS1rZXkta2V5LWtleS1rZXkta2V5LWs='

type Row = Record<string, unknown>
const utf8 = (text: string) => new TextEncoder().encode(text)

// ------------------------------------------------------------ the stand-ins --

/** private.push_config: one row, or none while notifications are not set up. */
interface ConfigRow {
  secret: string
  subject: string
  vapid_public: string | null
  vapid_private: string | null
}

let tables: Record<string, Row[]>
let settingsRow: ConfigRow | null
let pushes: { endpoint: string; headers: Record<string, string>; body: Uint8Array }[]
let dbCalls: { method: string; url: string; headers: Record<string, string>; body: Row | null }[]
let pushStatus: Record<string, number>
let dbDown = false
let rowGoneWhenStoring = false
/** The clock every handler in a test reads. */
let clock = START
let leoPhone: Browser
let leoTablet: Browser
let miaPhone: Browser

const looks = () => dbCalls.filter((c) => c.url === '/rest/v1/rpc/push_settings').length
const stores = () => dbCalls.filter((c) => c.url === '/rest/v1/rpc/push_store_keys')

/** Just enough of PostgREST: eq, in and is.null filters on one table. */
function query(table: string, params: URLSearchParams): Row[] {
  let rows = tables[table] ?? []
  for (const [column, filter] of params) {
    if (column === 'select') continue
    if (filter.startsWith('eq.')) rows = rows.filter((row) => String(row[column]) === filter.slice(3))
    else if (filter.startsWith('in.(')) rows = rows.filter((row) => filter.slice(4, -1).split(',').includes(String(row[column])))
    else if (filter === 'is.null') rows = rows.filter((row) => row[column] == null)
    else throw new Error(`the stand-in database does not know the filter ${filter}`)
  }
  return rows
}

const world = (async (input: string | URL | Request, init: RequestInit = {}) => {
  const url = new URL(String(input))
  const headers = (init.headers ?? {}) as Record<string, string>
  const answer = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
  if (url.origin === SUPABASE) {
    const body = typeof init.body === 'string' ? (JSON.parse(init.body) as Row) : null
    dbCalls.push({ method: init.method ?? 'GET', url: url.pathname + url.search, headers, body })
    if (dbDown) return answer({ message: 'down' }, 503)
    // The two database functions that are for the service role alone (0003_push.sql).
    if (url.pathname === '/rest/v1/rpc/push_settings') return answer(settingsRow)
    if (url.pathname === '/rest/v1/rpc/push_store_keys') {
      const { p_public, p_private } = body as { p_public: string; p_private: string }
      if (!/^[A-Za-z0-9_-]{87}$/.test(p_public) || !/^[A-Za-z0-9_-]{43}$/.test(p_private)) return answer({ code: 'P0001', message: 'push_invalid' }, 400)
      if (!settingsRow || rowGoneWhenStoring) return answer(null)
      if (!settingsRow.vapid_public) Object.assign(settingsRow, { vapid_public: p_public, vapid_private: p_private })
      return answer({ vapid_public: settingsRow.vapid_public, vapid_private: settingsRow.vapid_private })
    }
    const table = url.pathname.replace('/rest/v1/', '')
    if (init.method === 'DELETE') {
      const gone = new Set(query(table, url.searchParams))
      tables[table] = tables[table].filter((row) => !gone.has(row))
      return new Response(null, { status: 204 })
    }
    return answer(query(table, url.searchParams))
  }
  if (url.origin === 'https://push.service.test') {
    pushes.push({ endpoint: url.href, headers, body: init.body as Uint8Array })
    const status = pushStatus[url.href] ?? 201
    if (status === 0) throw new TypeError('fetch failed')
    return new Response(null, { status })
  }
  throw new Error(`a test must never reach ${url.origin}`)
}) as typeof fetch

const subscription = (browser: Browser, memberId: string, muted: string[] = []): Row => ({
  id: browser.id,
  household_id: H,
  member_id: memberId,
  endpoint: browser.endpoint,
  p256dh: toBase64Url(browser.publicKey),
  auth: toBase64Url(browser.auth),
  muted_types: muted,
})

/** A VAPID pair as the function would make and store it. */
async function makeKeys(): Promise<{ vapid_public: string; vapid_private: string }> {
  const keys = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])
  return { vapid_public: toBase64Url(new Uint8Array(await crypto.subtle.exportKey('raw', keys.publicKey))), vapid_private: (await crypto.subtle.exportKey('jwk', keys.privateKey)).d as string }
}

/** One running copy of the function. Each has its own memory of the settings, like in the cloud. */
const startFunction = () => pushHandler({ supabaseUrl: SUPABASE, serviceRoleKey: SERVICE_KEY }, { fetch: world, now: () => new Date(clock) })
let handle: ReturnType<typeof startFunction>

beforeEach(async () => {
  clock = START
  settingsRow = { secret: SECRET, subject: SUBJECT, ...(await makeKeys()) }
  handle = startFunction()
  leoPhone = await makeBrowser('leo-phone')
  leoTablet = await makeBrowser('leo-tablet')
  miaPhone = await makeBrowser('mia-phone')
  pushes = []
  dbCalls = []
  pushStatus = {}
  dbDown = false
  rowGoneWhenStoring = false
  tables = {
    members: [
      { id: MIA, household_id: H, name: 'Mia', prefs: { lang: 'en' }, disabled_at: null, deleted_at: null },
      { id: LEO, household_id: H, name: 'Leo', prefs: { lang: 'de', theme: 'dark' }, disabled_at: null, deleted_at: null },
    ],
    // Mia sealed something half a minute ago. It opens when she says so.
    envelopes: [
      { id: ENVELOPE, household_id: H, author_id: MIA, open_mode: 'hand', opens_at: null, created_at: at(-30), deleted_at: null, seen: {}, reply: null, teaser: TEASER, layers: { words: { iv: 'aXY=', box: SEALED_BOX } } },
    ],
    keys: [],
    push_subscriptions: [subscription(leoPhone, LEO), subscription(leoTablet, LEO), subscription(miaPhone, MIA)],
  }
})

const eventBody = (changes: Row = {}) => ({ type: 'sealed', household_id: H, actor_id: MIA, envelope_id: ENVELOPE, ...changes })

/** The envelope the tests are about, and a key of it that is out in the cloud. */
const envelope = () => tables.envelopes[0]
const keyRow = (layer: string, opensAt: string, changes: Row = {}): Row => ({ id: `key-${layer}`, household_id: H, envelope_id: ENVELOPE, author_id: MIA, layer, key: KEY, opens_at: opensAt, deleted_at: null, ...changes })
const onLeoPhone = async () => open(pushes.find((p) => p.endpoint === leoPhone.endpoint)!.body, leoPhone)

function call(body: unknown, options: { secret?: string | null; method?: string; on?: typeof handle } = {}): Promise<Response> {
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (options.secret !== null) headers[SECRET_HEADER] = options.secret ?? SECRET
  const method = options.method ?? 'POST'
  const request = new Request('https://project.supabase.test/functions/v1/push', { method, headers, body: method === 'POST' ? (typeof body === 'string' ? body : JSON.stringify(body)) : undefined })
  return (options.on ?? handle)(request)
}

// ---------------------------------------------------------------- the tests --

describe('who may call the function', () => {
  it('refuses a call without the secret before looking anything up', async () => {
    expect((await call(eventBody(), { secret: null })).status).toBe(401)
    expect((await call(eventBody(), { secret: '' })).status).toBe(401)
    expect(dbCalls).toEqual([])
    expect(pushes).toEqual([])
  })

  it('refuses a wrong secret, and sends nothing', async () => {
    for (const guess of ['guess', `${SECRET}x`, SECRET.slice(1)]) {
      const answer = await call(eventBody(), { secret: guess })
      expect(answer.status).toBe(401)
      expect(await answer.json()).toEqual({ error: 'wrong_secret' })
    }
    expect(pushes).toEqual([])
    // It looked at its settings and at nothing else in the room.
    expect(dbCalls.map((c) => c.url)).toEqual(['/rest/v1/rpc/push_settings'])
  })

  it('answers "not set up" while the database has no settings for it', async () => {
    settingsRow = null
    const answer = await call(eventBody())
    expect(answer.status).toBe(500)
    expect(await answer.json()).toEqual({ error: 'not_set_up' })
    expect((await call({ type: 'init' })).status).toBe(500)
    expect(pushes).toEqual([])
    expect(stores()).toEqual([])
  })

  it('is given nothing but the service role key, and fetches the rest with it', async () => {
    await call(eventBody())
    expect(dbCalls[0]).toMatchObject({ method: 'POST', url: '/rest/v1/rpc/push_settings', body: {}, headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` } })
    // Neither the service role key nor the shared secret ever travels to a push service.
    expect(pushes.length).toBeGreaterThan(0)
    for (const push of pushes) {
      expect(JSON.stringify(push.headers)).not.toContain(SERVICE_KEY)
      expect(JSON.stringify(push.headers)).not.toContain(SECRET)
    }
  })

  it('answers only to POST, and only to events it knows', async () => {
    expect((await call(null, { method: 'GET' })).status).toBe(405)
    expect((await call('not json')).status).toBe(400)
    expect((await call({ type: 'sealed' })).status).toBe(400)
    expect((await call(eventBody({ type: 'burnt' }))).status).toBe(400)
    expect((await call(eventBody({ envelope_id: `${ENVELOPE}&or=(id.neq.x)` }))).status).toBe(400)
    expect(dbCalls.filter((c) => !c.url.startsWith('/rest/v1/rpc/'))).toEqual([])
    expect(pushes).toEqual([])
  })
})

describe('remembering the settings', () => {
  it('asks the database once, then again after five minutes', async () => {
    await call(eventBody())
    await call(eventBody())
    clock += 4 * 60_000
    await call(eventBody())
    expect(looks()).toBe(1)
    clock += 2 * 60_000
    await call(eventBody())
    expect(looks()).toBe(2)
  })

  it('picks up a new secret by itself: the first call with it makes it look again', async () => {
    await call(eventBody())
    expect(looks()).toBe(1)

    // select private.push_new_secret();
    const fresh = 'another-secret-made-in-the-database-0123456789abcdef'
    ;(settingsRow as ConfigRow).secret = fresh
    clock += 30_000
    const answer = await call(eventBody(), { secret: fresh })
    expect(answer.status).toBe(200)
    expect(looks()).toBe(2)
    // The old one is history.
    expect((await call(eventBody(), { secret: SECRET })).status).toBe(401)
  })

  it('however many wrong secrets arrive, it asks the database at most once in ten seconds', async () => {
    await call(eventBody())
    for (let i = 0; i < 20; i++) {
      clock += 1000
      expect((await call(eventBody(), { secret: `guess-${i}` })).status).toBe(401)
    }
    // Twenty seconds of guessing: the first look, and two more.
    expect(looks()).toBe(3)
    // The right secret still works straight away.
    expect((await call(eventBody())).status).toBe(200)
  })

  it('does not hammer the database while it is not set up, and notices when it is', async () => {
    settingsRow = null
    for (let i = 0; i < 5; i++) expect((await call(eventBody())).status).toBe(500)
    expect(looks()).toBe(1)

    // select private.push_setup(...);
    settingsRow = { secret: SECRET, subject: SUBJECT, vapid_public: null, vapid_private: null }
    clock += 11_000
    expect((await call({ type: 'init' })).status).toBe(200)
  })
})

describe('the key pair', () => {
  const noKeys = () => Object.assign(settingsRow as ConfigRow, { vapid_public: null, vapid_private: null })

  it('"init" makes the pair, stores it in the database and answers with the public half only', async () => {
    noKeys()
    const answer = await call({ type: 'init' })
    expect(answer.status).toBe(200)
    const body = (await answer.json()) as { ok: boolean; publicKey: string }
    expect(Object.keys(body).sort()).toEqual(['ok', 'publicKey'])
    expect(body.ok).toBe(true)

    // A real P-256 public key, uncompressed, the way a browser wants it.
    const point = fromBase64Url(body.publicKey)
    expect(point.length).toBe(65)
    expect(point[0]).toBe(4)
    expect(settingsRow).toMatchObject({ vapid_public: body.publicKey })
    expect(settingsRow?.vapid_private).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(JSON.stringify(body)).not.toContain(settingsRow?.vapid_private as string)

    // The two halves belong together: what the private half signs, the public half verifies.
    const jwk = { kty: 'EC', crv: 'P-256', x: toBase64Url(point.slice(1, 33)), y: toBase64Url(point.slice(33, 65)) }
    const signer = await crypto.subtle.importKey('jwk', { ...jwk, d: settingsRow?.vapid_private as string }, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign'])
    const checker = await crypto.subtle.importKey('raw', point, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify'])
    const signature = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, signer, utf8('hello'))
    expect(await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, checker, signature, utf8('hello'))).toBe(true)
  })

  it('"init" a second time changes nothing and answers with the same key', async () => {
    noKeys()
    const first = (await (await call({ type: 'init' })).json()) as { publicKey: string }
    const second = (await (await call({ type: 'init' })).json()) as { publicKey: string }
    const elsewhere = (await (await call({ type: 'init' }, { on: startFunction() })).json()) as { publicKey: string }
    expect(second.publicKey).toBe(first.publicKey)
    expect(elsewhere.publicKey).toBe(first.publicKey)
    expect(stores()).toHaveLength(1)
  })

  it('two first calls at the same moment end up with one pair', async () => {
    noKeys()
    const [a, b] = await Promise.all([call({ type: 'init' }, { on: startFunction() }), call({ type: 'init' }, { on: startFunction() })])
    const [first, second] = [(await a.json()) as { publicKey: string }, (await b.json()) as { publicKey: string }]
    expect(first.publicKey).toBe(second.publicKey)
    expect(first.publicKey).toBe(settingsRow?.vapid_public)
  })

  it('"init" needs the secret like everything else', async () => {
    noKeys()
    expect((await call({ type: 'init' }, { secret: 'guess' })).status).toBe(401)
    expect((await call({ type: 'init' }, { secret: null })).status).toBe(401)
    expect(settingsRow?.vapid_public).toBeNull()
    expect(stores()).toEqual([])
  })

  it('an ordinary event makes the pair too if nobody has yet, and signs with it', async () => {
    noKeys()
    const answer = await call(eventBody())
    expect(await answer.json()).toEqual({ type: 'sealed', sent: 2, gone: 0, failed: 0 })
    expect(stores()).toHaveLength(1)
    expect(settingsRow?.vapid_public).toMatch(/^[A-Za-z0-9_-]{87}$/)
    for (const push of pushes) expect(push.headers.Authorization).toContain(`k=${settingsRow?.vapid_public}`)

    // The next event uses what is there.
    await call(eventBody())
    expect(stores()).toHaveLength(1)
  })

  it('after the keys were thrown away, "init" makes new ones even where the old are still remembered', async () => {
    await call(eventBody())
    const before = settingsRow?.vapid_public
    // select private.push_forget_keys();
    noKeys()
    const answer = (await (await call({ type: 'init' })).json()) as { publicKey: string }
    expect(answer.publicKey).not.toBe(before)
    expect(answer.publicKey).toBe(settingsRow?.vapid_public)

    pushes = []
    await call(eventBody())
    for (const push of pushes) expect(push.headers.Authorization).toContain(`k=${answer.publicKey}`)
  })

  it('reports it when the pair cannot be stored', async () => {
    // Notifications were switched off between the look and the storing: the row is gone.
    noKeys()
    rowGoneWhenStoring = true
    const answer = await call({ type: 'init' })
    expect(answer.status).toBe(502)
    expect(await answer.json()).toEqual({ error: 'failed', message: 'the key pair could not be stored' })
    expect(pushes).toEqual([])
  })
})

describe('"Something is waiting for you"', () => {
  it('tells the other person once per device, in their language, and nobody else', async () => {
    const answer = await call(eventBody())
    expect(answer.status).toBe(200)
    expect(await answer.json()).toEqual({ type: 'sealed', sent: 2, gone: 0, failed: 0 })

    expect(pushes.map((p) => p.endpoint).sort()).toEqual([leoPhone.endpoint, leoTablet.endpoint].sort())
    const onPhone = pushes.find((p) => p.endpoint === leoPhone.endpoint)!
    expect(await open(onPhone.body, leoPhone)).toEqual({
      type: 'sealed',
      title: 'Etwas wartet auf dich',
      body: 'Mia hat etwas versiegelt. Es öffnet sich, wenn Mia so weit ist.',
      tag: `envelope-${ENVELOPE}`,
      url: `/envelope/${ENVELOPE}`,
    })
    expect(onPhone.headers).toMatchObject({ 'Content-Encoding': 'aes128gcm', TTL: String(48 * 3600), Urgency: 'normal', Topic: ENVELOPE.replaceAll('-', '') })
    // Signed as us, with the key and the subject from the database, for this push service.
    const [, token, key] = /^vapid t=(.+), k=(.+)$/.exec(onPhone.headers.Authorization) as RegExpExecArray
    expect(key).toBe(settingsRow?.vapid_public)
    expect(JSON.parse(new TextDecoder().decode(fromBase64Url(token.split('.')[1])))).toMatchObject({ aud: 'https://push.service.test', sub: SUBJECT })
  })

  it('reads the room with the service role, and only this room', async () => {
    await call(eventBody())
    const reads = dbCalls.filter((c) => !c.url.startsWith('/rest/v1/rpc/'))
    expect(reads.length).toBeGreaterThanOrEqual(4)
    for (const { headers, url } of reads) {
      expect(headers).toMatchObject({ apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` })
      expect(url).toContain(H)
    }
  })

  it('asks the database for nothing of the inside, the outside or a key', async () => {
    envelope().open_mode = 'at'
    envelope().opens_at = at(-5)
    tables.keys = [keyRow('words', at(-5))]
    for (const type of ['sealed', 'opened']) await call(eventBody({ type }))
    Object.assign(envelope(), { seen: { words: at(-2) }, reply: { taps: ['more'], heat: 4, why: { chips: ['received.close'], own: [], note: 'for your eyes' }, at: at(-1) } })
    await call(eventBody({ type: 'answered', actor_id: LEO }))

    const columns = dbCalls
      .filter((c) => !c.url.startsWith('/rest/v1/rpc/'))
      .flatMap((c) => (new URL(c.url, SUPABASE).searchParams.get('select') ?? '*').split(','))
    expect(columns.length).toBeGreaterThan(0)
    for (const forbidden of ['*', 'teaser', 'layers', 'heat_outside', 'key', 'wants']) expect(columns).not.toContain(forbidden)
  })

  it('puts nothing on the lock screen but who and when', async () => {
    envelope().open_mode = 'at'
    envelope().opens_at = at(-5)
    tables.keys = [keyRow('words', at(-5))]
    await call(eventBody({ type: 'opened' }))
    Object.assign(envelope(), { seen: { words: at(-2) }, reply: { taps: ['more'], heat: 4, why: { chips: [], own: ['my own reason'], note: 'for your eyes' }, at: at(-1) } })
    await call(eventBody({ type: 'answered', actor_id: LEO }))

    expect(pushes).toHaveLength(3)
    for (const push of pushes) {
      const browser = [leoPhone, leoTablet, miaPhone].find((b) => b.endpoint === push.endpoint)!
      const message = JSON.stringify(await open(push.body, browser))
      for (const secret of [TEASER, SEALED_BOX, KEY, 'my own reason', 'for your eyes', 'more']) expect(message).not.toContain(secret)
    }
  })

  it('skips a device that muted this kind, and a paused profile altogether', async () => {
    tables.push_subscriptions = [subscription(leoPhone, LEO, ['sealed']), subscription(leoTablet, LEO, ['opened'])]
    expect(await (await call(eventBody())).json()).toMatchObject({ sent: 1 })
    expect(pushes.map((p) => p.endpoint)).toEqual([leoTablet.endpoint])

    pushes = []
    tables.members[1].disabled_at = '2026-11-01T00:00:00Z'
    expect(await (await call(eventBody())).json()).toMatchObject({ sent: 0 })
    expect(pushes).toEqual([])
  })

  it('forgets a device the push service reports as gone, and only that one', async () => {
    pushStatus[leoPhone.endpoint] = 410
    expect(await (await call(eventBody())).json()).toEqual({ type: 'sealed', sent: 1, gone: 1, failed: 0 })
    expect(tables.push_subscriptions.map((s) => s.endpoint).sort()).toEqual([leoTablet.endpoint, miaPhone.endpoint].sort())
    expect(dbCalls.filter((c) => c.method === 'DELETE').map((c) => c.url)).toEqual([`/rest/v1/push_subscriptions?id=in.(${leoPhone.id})`])

    pushStatus = { [leoTablet.endpoint]: 404 }
    await call(eventBody())
    expect(tables.push_subscriptions.map((s) => s.endpoint)).toEqual([miaPhone.endpoint])
  })

  it('keeps a device when the push service is merely busy or unreachable', async () => {
    pushStatus[leoPhone.endpoint] = 429
    pushStatus[leoTablet.endpoint] = 0
    expect(await (await call(eventBody())).json()).toEqual({ type: 'sealed', sent: 0, gone: 0, failed: 2 })
    expect(tables.push_subscriptions).toHaveLength(3)
    expect(dbCalls.filter((c) => c.method === 'DELETE')).toEqual([])
  })

  it('says nothing when the envelope has been taken back in the meantime', async () => {
    envelope().deleted_at = at(-1)
    expect(await (await call(eventBody())).json()).toEqual({ type: 'sealed', sent: 0, gone: 0, failed: 0 })
    expect(pushes).toEqual([])
  })

  it('says nothing about an envelope of another room, or from somebody who is not in this one', async () => {
    const elsewhere = '77777777-7777-4777-8777-777777777777'
    expect(await (await call(eventBody({ household_id: elsewhere }))).json()).toMatchObject({ sent: 0 })
    expect(await (await call(eventBody({ actor_id: elsewhere }))).json()).toMatchObject({ sent: 0 })
    // Nor when somebody else claims to have sealed it.
    expect(await (await call(eventBody({ actor_id: LEO }))).json()).toMatchObject({ sent: 0 })
    expect(pushes).toEqual([])
  })

  it('names the time when the envelope has one', async () => {
    // 22:00 in Zurich, the same evening.
    Object.assign(envelope(), { open_mode: 'at', opens_at: '2026-11-10T21:00:00Z' })
    tables.keys = [keyRow('words', '2026-11-10T21:00:00Z')]
    await call(eventBody())
    expect((await onLeoPhone()).body).toBe('Mia hat etwas versiegelt. Es öffnet sich heute Abend um 22:00.')

    pushes = []
    tables.members[1].prefs = {}
    Object.assign(envelope(), { opens_at: '2026-11-13T19:00:00Z' })
    await call(eventBody())
    expect((await onLeoPhone()).body).toBe('Mia sealed something. It opens on Friday at 20:00.')
  })

  it('is too late once something in it is open: "opened" has said so already', async () => {
    tables.keys = [keyRow('feel', at(-3))]
    expect(await (await call(eventBody())).json()).toMatchObject({ sent: 0 })
  })
})

describe('the other two', () => {
  it('an opening wakes the phone at once', async () => {
    tables.keys = [keyRow('feel', at(-2)), keyRow('words', at(-2))]
    expect(await (await call(eventBody({ type: 'opened' }))).json()).toEqual({ type: 'opened', sent: 2, gone: 0, failed: 0 })
    expect(await onLeoPhone()).toEqual({
      type: 'opened',
      title: 'Es ist offen',
      body: 'Der Umschlag von Mia ist jetzt offen für dich.',
      tag: `envelope-${ENVELOPE}`,
      url: `/envelope/${ENVELOPE}`,
    })
    expect(pushes[0].headers).toMatchObject({ Urgency: 'high', TTL: String(24 * 3600), Topic: ENVELOPE.replaceAll('-', '') })
  })

  it('an opening is not announced before its time, nor after it was read or burnt', async () => {
    // The key waits in the cloud for 22:00.
    tables.keys = [keyRow('words', at(3600))]
    expect(await (await call(eventBody({ type: 'opened' }))).json()).toMatchObject({ sent: 0 })

    // The time has come.
    clock += 3601_000
    expect(await (await call(eventBody({ type: 'opened' }))).json()).toMatchObject({ sent: 2 })

    // Leo has opened it already (the event was late).
    pushes = []
    envelope().seen = { words: at(3700) }
    expect(await (await call(eventBody({ type: 'opened' }))).json()).toMatchObject({ sent: 0 })

    // One layer read, another still waiting: that is news.
    tables.keys.push(keyRow('voice', at(3600)))
    expect(await (await call(eventBody({ type: 'opened' }))).json()).toMatchObject({ sent: 2 })

    // Burnt after one listening: the key is marked deleted and counts no more.
    pushes = []
    Object.assign(tables.keys[1], { key: '', deleted_at: at(3800) })
    expect(await (await call(eventBody({ type: 'opened' }))).json()).toMatchObject({ sent: 0 })
    expect(pushes).toEqual([])
  })

  it('an opening from days ago is old news', async () => {
    tables.keys = [keyRow('words', at(-2))]
    clock += 25 * 3600_000
    expect(await (await call(eventBody({ type: 'opened' }))).json()).toMatchObject({ sent: 0 })
  })

  it('an answer goes back to whoever sealed it, and only once there is one', async () => {
    tables.keys = [keyRow('words', at(-20))]
    envelope().seen = { words: at(-10) }
    expect(await (await call(eventBody({ type: 'answered', actor_id: LEO }))).json()).toMatchObject({ sent: 0 })

    envelope().reply = { taps: ['more'], heat: 4, why: { chips: [], own: [], note: null }, at: at(-1) }
    expect(await (await call(eventBody({ type: 'answered', actor_id: LEO }))).json()).toEqual({ type: 'answered', sent: 1, gone: 0, failed: 0 })
    expect(pushes.map((p) => p.endpoint)).toEqual([miaPhone.endpoint])
    expect(await open(pushes[0].body, miaPhone)).toEqual({
      type: 'answered',
      title: 'An answer for you',
      body: 'Leo answered your envelope.',
      tag: `envelope-${ENVELOPE}`,
      url: `/envelope/${ENVELOPE}`,
    })
    expect(pushes[0].headers).toMatchObject({ Urgency: 'normal', TTL: String(48 * 3600) })

    // Nobody answers their own envelope.
    pushes = []
    expect(await (await call(eventBody({ type: 'answered', actor_id: MIA }))).json()).toMatchObject({ sent: 0 })
    expect(pushes).toEqual([])
  })
})

describe('when something breaks', () => {
  it('reports a database that is down instead of pretending all went well', async () => {
    dbDown = true
    const answer = await call(eventBody())
    expect(answer.status).toBe(502)
    expect(await answer.json()).toMatchObject({ error: 'failed' })
    expect(pushes).toEqual([])

    // Back up: the very next call works. An outage is not mistaken for "not set up".
    dbDown = false
    expect(await (await call(eventBody())).json()).toMatchObject({ sent: 2 })
    // Down again, this time with the settings still remembered: reported just the same.
    pushes = []
    dbDown = true
    expect((await call(eventBody())).status).toBe(502)
    expect(pushes).toEqual([])
  })

  it('a device with broken keys does not keep the others from hearing', async () => {
    tables.push_subscriptions[0].p256dh = 'not-a-key'
    expect(await (await call(eventBody())).json()).toEqual({ type: 'sealed', sent: 1, gone: 0, failed: 1 })
    expect(pushes.map((p) => p.endpoint)).toEqual([leoTablet.endpoint])
  })
})
