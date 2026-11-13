// The real cloud cannot be reached from the test machine, so this test stands in a small
// local server that speaks Supabase's HTTP dialect and checks two things:
//
//   1. Every database function the app calls exists in supabase/migrations, with exactly
//      the parameter names the app sends. A typo here would only show up on a real phone.
//   2. The app understands the answers: wrong PIN, paused name, taken name and so on.

import { readdirSync, readFileSync } from 'node:fs'
import { createServer, type IncomingMessage, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { join } from 'node:path'
import 'fake-indexeddb/auto'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { SupabaseBackend } from '../../src/data/supabaseBackend'
import { pushHandler, SECRET_HEADER } from '../../supabase/functions/push/handler'

// ------------------------------------------------- what the migrations define --

interface Signature {
  /** Every parameter, in order. */
  params: string[]
  /** Parameters the caller must send (no default). */
  required: string[]
}

/** The public functions that exist after all migrations have run. */
function functionsInMigrations(): Map<string, Signature> {
  const dir = join(__dirname, '../../supabase/migrations')
  const found = new Map<string, Signature>()
  for (const file of readdirSync(dir).sort()) {
    const sql = readFileSync(join(dir, file), 'utf8')
    const statement = /(create\s+(?:or\s+replace\s+)?function|drop\s+function)\s+public\.(\w+)\s*\(([^)]*)\)/gi
    for (const [, verb, name, args] of sql.matchAll(statement)) {
      if (/^drop/i.test(verb)) {
        found.delete(name)
        continue
      }
      const parts = args.split(',').map((a) => a.trim()).filter(Boolean)
      found.set(name, {
        params: parts.map((a) => a.split(/\s+/)[0]),
        required: parts.filter((a) => !/\sdefault\s/i.test(a)).map((a) => a.split(/\s+/)[0]),
      })
    }
  }
  return found
}

/** Every column of every public table after all migrations have run. */
function columnsInMigrations(): Map<string, Set<string>> {
  const dir = join(__dirname, '../../supabase/migrations')
  const found = new Map<string, Set<string>>()
  const notAColumn = /^(check|primary|unique|foreign|constraint)\b/i
  for (const file of readdirSync(dir).sort()) {
    const sql = readFileSync(join(dir, file), 'utf8')
    for (const [, table, body] of sql.matchAll(/create table public\.(\w+) \(\n([\s\S]*?)\n\);/g)) {
      const names = body.split('\n').map((line) => line.trim()).filter((line) => line && !line.startsWith('--') && !notAColumn.test(line)).map((line) => line.split(/\s+/)[0])
      found.set(table, new Set(names))
    }
    for (const [, table, changes] of sql.matchAll(/alter table public\.(\w+)\n?([\s\S]*?);/g)) {
      for (const [, column] of changes.matchAll(/add column (\w+)/g)) found.get(table)?.add(column)
      for (const [, column] of changes.matchAll(/drop column (\w+)/g)) found.get(table)?.delete(column)
    }
  }
  return found
}

// ------------------------------------------------------- the stand-in server --

type Reply = { status?: number; body: unknown }
const calls: { fn: string; args: Record<string, unknown> }[] = []
const patches: { table: string; body: Record<string, unknown> }[] = []
let answers: Record<string, Reply> = {}
let patchAnswer: Reply = { status: 204, body: null }
let server: Server
let url = ''

function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    let raw = ''
    req.on('data', (c: Buffer) => (raw += c.toString('utf8')))
    req.on('end', () => resolve(raw ? (JSON.parse(raw) as Record<string, unknown>) : {}))
  })
}

const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url')

beforeAll(async () => {
  server = createServer(async (req, res) => {
    const path = (req.url ?? '').split('?')[0]
    const body = await readJson(req)
    const send = (reply: Reply) => {
      res.statusCode = reply.status ?? 200
      res.setHeader('content-type', 'application/json')
      res.end(reply.body === null ? '' : JSON.stringify(reply.body))
    }
    if (path === '/auth/v1/signup') {
      const exp = Math.floor(Date.now() / 1000) + 3600
      const id = '11111111-1111-4111-8111-111111111111'
      return send({
        body: {
          access_token: `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: id, role: 'authenticated', exp })}.sig`,
          token_type: 'bearer',
          expires_in: 3600,
          expires_at: exp,
          refresh_token: 'refresh',
          user: { id, aud: 'authenticated', role: 'authenticated', is_anonymous: true, app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() },
        },
      })
    }
    if (path.startsWith('/rest/v1/rpc/')) {
      const fn = path.slice('/rest/v1/rpc/'.length)
      calls.push({ fn, args: body })
      return send(answers[fn] ?? { body: null })
    }
    if (path.startsWith('/rest/v1/') && (req.method === 'PATCH' || req.method === 'POST')) {
      patches.push({ table: path.slice('/rest/v1/'.length), body })
      return send(patchAnswer)
    }
    send({ status: 404, body: { message: 'not found' } })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})

afterAll(() => new Promise<void>((resolve) => void server.close(() => resolve())))

beforeEach(() => {
  calls.length = 0
  patches.length = 0
  answers = {}
  patchAnswer = { status: 204, body: null }
})

const backend = () => new SupabaseBackend(url, 'sb_publishable_test')
const refuse = (message: string, code = 'P0001'): Reply => ({ status: 400, body: { code, message, details: null, hint: null } })
const seat = { household_id: 'h1', member_id: 'm1' }

// ----------------------------------------------------------------- the tests --

describe('the app and the database agree on every function', () => {
  it('calls only functions that exist, with the parameter names they declare', async () => {
    const defined = functionsInMigrations()
    answers = {
      my_membership: { body: { ...seat, paused: false } },
      room_exists: { body: true },
      create_household: { body: seat },
      create_invite: { body: { code: 'ABCDEFGHJK', kind: 'join', expires_at: '2026-11-12T10:00:00Z' } },
      peek_invite: { body: { kind: 'join', room_name: 'Casa', host: null, profile: null } },
      join_household: { body: { ...seat, kind: 'join' } },
      sign_in_with_pin: { body: { ok: true, ...seat } },
      sign_out_other_devices: { body: 2 },
      sign_out_member: { body: 1 },
      sync_pull: { body: { server_time: '2026-11-10T10:00:00Z', seat: 'ok' } },
    }
    const b = backend()
    const me = { name: 'Leo', avatar: 'sun', color: 'plum', accessory: 'bow', status: 'Always Huuungryyyyy' as const }
    await b.membership()
    await b.roomExists()
    await b.createHousehold('Casa', me, '314159')
    await b.createInvite('join')
    await b.createInvite('restore', 'm2')
    await b.peekInvite('ABCDE-FGHJK')
    await b.joinHousehold('ABCDEFGHJK', me, '314159')
    await b.signInWithPin('Leo', '314159')
    await b.setPin('864209')
    await b.signOutDevice()
    await b.signOutOtherDevices()
    await b.setMemberPaused('m2', true)
    await b.signOutMember('m2')
    await b.pull(null)
    await b.savePushSubscription({ endpoint: 'https://push.example.test/send/abc', p256dh: 'BPublicKey', auth: 'AuthSecret', mutedTypes: ['opened'], userAgent: 'Test browser' })
    await b.savePushSubscription({ endpoint: 'https://push.example.test/send/abc', p256dh: 'BPublicKey', auth: 'AuthSecret', mutedTypes: [] })
    await b.setPushMuted('https://push.example.test/send/abc', ['sealed', 'answered'])
    await b.removePushSubscription('https://push.example.test/send/abc')
    await b.pushPublicKey()

    const used = new Set(calls.map((c) => c.fn))
    expect([...used].sort()).toEqual(
      [
        'create_household',
        'create_invite',
        'join_household',
        'room_exists',
        'my_membership',
        'peek_invite',
        'push_public_key',
        'remove_push_subscription',
        'save_push_subscription',
        'set_member_paused',
        'set_pin',
        'set_push_muted',
        'sign_in_with_pin',
        'sign_out_device',
        'sign_out_member',
        'sign_out_other_devices',
        'sync_pull',
      ].sort(),
    )
    for (const { fn, args } of calls) {
      const signature = defined.get(fn)
      expect(signature, `${fn} is not defined in supabase/migrations`).toBeDefined()
      const sent = Object.keys(args)
      expect(sent.filter((name) => !signature!.params.includes(name)), `${fn} was sent parameters it does not have`).toEqual([])
      expect(signature!.required.filter((name) => !sent.includes(name)), `${fn} is missing required parameters`).toEqual([])
    }
    // Nothing the app could call is left over from the recovery-key days.
    expect([...defined.keys()].filter((name) => /recover/.test(name))).toEqual([])
  })

  it('signs a device up for notifications with the names the database expects', async () => {
    const b = backend()
    await b.savePushSubscription({ endpoint: 'https://push.example.test/send/abc', p256dh: 'BPublicKey', auth: 'AuthSecret', mutedTypes: ['opened', 'answered'], userAgent: 'Test browser' })
    await b.setPushMuted('https://push.example.test/send/abc', [])
    await b.removePushSubscription('https://push.example.test/send/abc')
    expect(calls).toEqual([
      { fn: 'save_push_subscription', args: { p_endpoint: 'https://push.example.test/send/abc', p_p256dh: 'BPublicKey', p_auth: 'AuthSecret', p_muted_types: ['opened', 'answered'], p_user_agent: 'Test browser' } },
      { fn: 'set_push_muted', args: { p_endpoint: 'https://push.example.test/send/abc', p_muted_types: [] } },
      { fn: 'remove_push_subscription', args: { p_endpoint: 'https://push.example.test/send/abc' } },
    ])
    // The table itself is closed to the app (0003_push.sql): nothing may go around the functions.
    expect(patches).toEqual([])
  })

  it('asks for the room\'s public key, and reads "none yet" as null', async () => {
    const b = backend()
    answers = { push_public_key: { body: 'BA1Hxzyi1RUM1b5wjxsn7nGxAszw2u61m164i3MrAIxHF6YK5h4SDYic-dRuU_RCPCfA5aq9ojSwk5Y2EmClBPs' } }
    expect(await b.pushPublicKey()).toBe('BA1Hxzyi1RUM1b5wjxsn7nGxAszw2u61m164i3MrAIxHF6YK5h4SDYic-dRuU_RCPCfA5aq9ojSwk5Y2EmClBPs')
    answers = { push_public_key: { body: null } }
    expect(await b.pushPublicKey()).toBeNull()
    expect(calls.map((c) => [c.fn, c.args])).toEqual([
      ['push_public_key', {}],
      ['push_public_key', {}],
    ])
  })

  it('sends the profile in the database\'s spelling', async () => {
    answers = { create_household: { body: seat } }
    await backend().createHousehold('Casa', { name: 'Leo', accessory: 'bow', status: 'Here' }, '314159')
    expect(calls[0].args).toEqual({ p_household_name: 'Casa', p_member: { name: 'Leo', accessory: 'bow', status: 'Here' }, p_pin: '314159' })
  })
})

describe('the app understands the database\'s answers', () => {
  it('reads who is logged in, paused or not', async () => {
    answers = { my_membership: { body: { ...seat, paused: true } } }
    expect(await backend().membership()).toEqual({ householdId: 'h1', memberId: 'm1', paused: true })
    answers = { my_membership: { body: { ...seat, paused: false } } }
    expect(await backend().membership()).toEqual({ householdId: 'h1', memberId: 'm1' })
    answers = { my_membership: { body: null } }
    expect(await backend().membership()).toBeNull()
  })

  it('turns a wrong PIN, a paused name and a paused profile into the matching refusals', async () => {
    const b = backend()
    answers = { sign_in_with_pin: { body: { ok: false, reason: 'wrong', tries_left: 3 } } }
    await expect(b.signInWithPin('Leo', '000001')).rejects.toMatchObject({ kind: 'rejected', code: 'pin_wrong', details: { triesLeft: 3 } })
    answers = { sign_in_with_pin: { body: { ok: false, reason: 'locked', retry_at: '2026-11-10T12:15:00+00:00' } } }
    await expect(b.signInWithPin('Leo', '000001')).rejects.toMatchObject({ code: 'pin_locked', details: { retryAt: '2026-11-10T12:15:00+00:00' } })
    answers = { sign_in_with_pin: { body: { ok: false, reason: 'paused' } } }
    await expect(b.signInWithPin('Leo', '314159')).rejects.toMatchObject({ code: 'account_paused' })
    answers = { sign_in_with_pin: { body: { ok: true, ...seat } } }
    await expect(b.signInWithPin('Leo', '314159')).resolves.toEqual({ householdId: 'h1', memberId: 'm1' })
  })

  it('passes on the database\'s own refusals by name', async () => {
    const b = backend()
    for (const code of ['pin_invalid', 'pin_too_simple', 'name_taken', 'invite_invalid', 'room_full', 'room_already_exists', 'already_in_room']) {
      answers = { join_household: refuse(code) }
      await expect(b.joinHousehold('ABCDEFGHJK', { name: 'Leo' }, '314159'), code).rejects.toMatchObject({ kind: 'rejected', code })
    }
    for (const code of ['admin_only', 'not_yourself', 'member_not_found', 'not_in_room']) {
      answers = { set_member_paused: refuse(code) }
      await expect(b.setMemberPaused('m2', true), code).rejects.toMatchObject({ kind: 'rejected', code })
    }
    for (const code of ['not_in_room', 'push_invalid']) {
      answers = { save_push_subscription: refuse(code) }
      await expect(b.savePushSubscription({ endpoint: 'https://push.example.test/x', p256dh: 'k', auth: 'a', mutedTypes: [] }), code).rejects.toMatchObject({ kind: 'rejected', code })
    }
    answers = { set_push_muted: refuse('push_missing') }
    await expect(b.setPushMuted('https://push.example.test/x', ['opened'])).rejects.toMatchObject({ kind: 'rejected', code: 'push_missing' })
  })

  it('shows who invites before the code is used', async () => {
    answers = { peek_invite: { body: { kind: 'restore', room_name: 'Casa', host: { name: 'Mia', avatar: 'moon', color: 'candle', accessory: 'bow' }, profile: { name: 'Leo', avatar: 'sun', color: 'plum', accessory: null } } } }
    expect(await backend().peekInvite('abcde-fghjk')).toEqual({
      kind: 'restore',
      roomName: 'Casa',
      host: { name: 'Mia', avatar: 'moon', color: 'candle', accessory: 'bow' },
      profile: { name: 'Leo', avatar: 'sun', color: 'plum', accessory: null },
    })
  })

  it('learns from a pull whether the device still has its seat', async () => {
    const b = backend()
    for (const state of ['ok', 'paused', 'gone'] as const) {
      answers = { sync_pull: { body: { server_time: '2026-11-10T10:00:00Z', seat: state, members: [{ id: 'm1', household_id: 'h1', is_admin: true, disabled_at: null, prefs: { lang: 'de' } }] } } }
      const pulled = await b.pull(null)
      expect(pulled.seat).toBe(state)
      expect(pulled.tables.members).toEqual([{ id: 'm1', householdId: 'h1', isAdmin: true, disabledAt: null, prefs: { lang: 'de' } }])
    }
  })

  it('explains a refused rename as "name taken"', async () => {
    patchAnswer = { status: 409, body: { code: '23505', message: 'duplicate key value violates unique constraint "members_household_name_key"', details: null, hint: null } }
    await expect(backend().push({ table: 'members', kind: 'patch', id: 'm1', data: { name: 'Mia' } })).rejects.toMatchObject({ kind: 'rejected', code: 'name_taken' })
  })

  it('sends profile changes with the database\'s column names and never its clock', async () => {
    await backend().push({ table: 'members', kind: 'patch', id: 'm1', data: { accessory: 'halo', prefs: { heatMax: 3 }, updatedAt: '2026-01-01T00:00:00Z' } })
    expect(patches).toEqual([{ table: 'members', body: { accessory: 'halo', prefs: { heatMax: 3 } } }])
  })
})

// The push function (supabase/functions/push) talks to the database too: two functions
// that are for the service role alone, and a handful of tables it reads. It has never
// run against the real project from here, so its spelling is checked the same way.
describe('the push function and the database agree', () => {
  const secret = 'a-shared-secret-made-in-the-database-0123456789'
  const post = (body: unknown) => new Request('https://project.supabase.test/functions/v1/push', { method: 'POST', headers: { [SECRET_HEADER]: secret }, body: JSON.stringify(body) })

  it('calls only database functions that exist, with the parameter names they declare', async () => {
    const defined = functionsInMigrations()
    answers = {
      push_settings: { body: { secret, subject: 'https://room.example.org/', vapid_public: null, vapid_private: null } },
      push_store_keys: { body: { vapid_public: 'B'.repeat(87), vapid_private: 'd'.repeat(43) } },
    }
    const answer = await pushHandler({ supabaseUrl: url, serviceRoleKey: 'service-role-key' })(post({ type: 'init' }))
    expect(await answer.json()).toEqual({ ok: true, publicKey: 'B'.repeat(87) })

    expect(calls.map((c) => c.fn)).toEqual(['push_settings', 'push_settings', 'push_store_keys'])
    for (const { fn, args } of calls) {
      const signature = defined.get(fn)
      expect(signature, `${fn} is not defined in supabase/migrations`).toBeDefined()
      const sent = Object.keys(args)
      expect(sent.filter((name) => !signature!.params.includes(name)), `${fn} was sent parameters it does not have`).toEqual([])
      expect(signature!.required.filter((name) => !sent.includes(name)), `${fn} is missing required parameters`).toEqual([])
    }
    // What it reads back are the names push_settings and push_store_keys write.
    const sql = readFileSync(join(__dirname, '../../supabase/migrations/0003_push.sql'), 'utf8')
    for (const name of ['secret', 'subject', 'vapid_public', 'vapid_private']) expect(sql).toContain(`'${name}', ${name}`)
  })

  it('reads only tables and columns that exist', async () => {
    const columns = columnsInMigrations()
    const ids = { h: '11111111-1111-4111-8111-111111111111', mia: '22222222-2222-4222-8222-222222222222', leo: '77777777-7777-4777-8777-777777777777', envelope: '33333333-3333-4333-8333-333333333333' }
    const asked: { table: string; names: string[] }[] = []
    const database = (async (input: string | URL | Request, init: RequestInit = {}) => {
      const at = new URL(String(input))
      const table = at.pathname.replace('/rest/v1/', '')
      const reply = (body: unknown) => new Response(JSON.stringify(body), { status: 200 })
      if (table === 'rpc/push_settings') return reply({ secret, subject: 'https://room.example.org/', vapid_public: 'B'.repeat(87), vapid_private: 'd'.repeat(43) })
      if (init.method === 'DELETE') return new Response(null, { status: 204 })
      asked.push({ table, names: [...at.searchParams.keys()].filter((key) => key !== 'select').concat((at.searchParams.get('select') ?? '').split(',')) })
      if (table === 'members') return reply([{ id: ids.mia, name: 'Mia', prefs: {}, disabled_at: null }])
      if (table === 'envelopes') return reply([{ author_id: ids.mia, open_mode: 'hand', opens_at: null, created_at: new Date().toISOString(), deleted_at: null, seen: {}, reply: null }])
      return reply([])
    }) as typeof fetch
    const handle = pushHandler({ supabaseUrl: 'https://project.supabase.test', serviceRoleKey: 'service-role-key' }, { fetch: database, now: () => new Date() })

    const event = { household_id: ids.h, envelope_id: ids.envelope }
    expect((await handle(post({ ...event, type: 'sealed', actor_id: ids.mia }))).status).toBe(200)
    expect((await handle(post({ ...event, type: 'opened', actor_id: ids.mia }))).status).toBe(200)
    expect((await handle(post({ ...event, type: 'answered', actor_id: ids.leo }))).status).toBe(200)

    expect([...new Set(asked.map((a) => a.table))].sort()).toEqual(['envelopes', 'keys', 'members', 'push_subscriptions'])
    for (const { table, names } of asked) {
      const known = columns.get(table)
      expect(known, `the table ${table} is not defined in supabase/migrations`).toBeDefined()
      expect(names.filter((name) => !known!.has(name)), `the function asks ${table} for columns it does not have`).toEqual([])
    }
    // It never asks for what is inside an envelope, nor for what is written on it.
    const envelopeColumns = asked.filter((a) => a.table === 'envelopes').flatMap((a) => a.names)
    expect(envelopeColumns.filter((name) => ['layers', 'teaser', 'heat_outside'].includes(name))).toEqual([])
    // The parser really sees the columns.
    expect(columns.get('members')!.has('prefs')).toBe(true)
    expect(columns.get('members')!.has('disabled_at')).toBe(true)
    expect(columns.get('keys')!.has('announced_at')).toBe(true)
    expect(columns.get('push_subscriptions')!.has('user_id')).toBe(true)
  })
})

// The sync engine sends rows as the app knows them, spelled the database's way. A field
// the database has no column for would be refused, on a real phone, on the first try.
describe('what the app sends and what the tables take', () => {
  it('has a column for every field of an envelope, a key and a sealed file', async () => {
    const { FakeCloud } = await import('../../src/data/fake/cloudCore')
    const { sealEnvelope } = await import('../../src/data/actions')
    const { snakeKeys } = await import('../../src/data/case')
    const { makeCouple } = await import('./helpers')
    const { her } = await makeCouple(new FakeCloud())
    await sealEnvelope(her.kit, {
      feel: { heat: 3, ease: 3, why: { chips: [], own: [], note: null } },
      words: 'A few words',
      voice: { blob: new Blob([new Uint8Array(64)]), mime: 'audio/webm', seconds: 2 },
      teaser: 'On the outside',
      heatOutside: 3,
      wants: 'talk',
      keep: 'once',
      openMode: 'now',
      opensAt: null,
      release: ['feel', 'words', 'voice'],
    })
    const columns = columnsInMigrations()
    const sent = await her.db.outbox.toArray()
    expect([...new Set(sent.map((op) => op.table))].sort()).toEqual(['envelopes', 'keys', 'media'])
    for (const op of sent) {
      const names = Object.keys(snakeKeys(op.data)).filter((name) => name !== 'updated_at')
      const known = columns.get(op.table)!
      expect(names.filter((name) => !known.has(name)), `${op.table} is sent fields it has no column for`).toEqual([])
    }
    // And the other way round: every column is one the app knows, or one that is the server's own.
    const serverOnly: Record<string, string[]> = { keys: ['announced_at'] }
    for (const table of ['envelopes', 'keys', 'media']) {
      const appFields = new Set(sent.filter((op) => op.table === table).flatMap((op) => Object.keys(snakeKeys(op.data))))
      const unknown = [...columns.get(table)!].filter((column) => !appFields.has(column) && !(serverOnly[table] ?? []).includes(column))
      expect(unknown, `${table} has columns the app never fills`).toEqual([])
    }
  })

  it('pulls every table the app syncs, under the name the app expects', () => {
    const sql = readFileSync(join(__dirname, '../../supabase/migrations/0002_envelopes.sql'), 'utf8')
    const pull = sql.slice(sql.indexOf('create or replace function public.sync_pull'))
    for (const table of ['households', 'members', 'envelopes', 'keys', 'media']) expect(pull).toContain(`'${table}', (select`)
    // Realtime tells phones about every one of them.
    const all = readdirSync(join(__dirname, '../../supabase/migrations')).map((file) => readFileSync(join(__dirname, '../../supabase/migrations', file), 'utf8')).join('\n')
    for (const table of ['households', 'members', 'envelopes', 'keys', 'media']) expect(all).toContain(`alter publication supabase_realtime add table public.${table};`)
  })
})
