// Serves the pretend cloud under /__cloud while developing and testing.
// It never ships: the production build talks to Supabase.

import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Connect, Plugin } from 'vite'
import { BackendError } from '../src/data/backend.ts'
import { FakeCloud } from '../src/data/fake/cloudCore.ts'

const METHODS = new Set([
  'membership',
  'roomExists',
  'createHousehold',
  'createInvite',
  'peekInvite',
  'joinHousehold',
  'signInWithPin',
  'setPin',
  'signOutDevice',
  'signOutOtherDevices',
  'setMemberPaused',
  'signOutMember',
  'pushPublicKey',
  'savePushSubscription',
  'setPushMuted',
  'removePushSubscription',
  'push',
  'pull',
])

function readBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => chunks.push(c))
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status
  res.setHeader('content-type', 'application/json')
  res.end(JSON.stringify(body))
}

export function fakeCloud(): Plugin {
  const cloud = new FakeCloud()

  const handler: Connect.NextHandleFunction = async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://local')
    const user = String(req.headers['x-user'] ?? '')
    try {
      if (url.pathname === '/reset' && req.method === 'POST') {
        cloud.reset()
        return json(res, 200, { result: null })
      }

      // The owner's master key. In the real cloud it is run from the Supabase dashboard;
      // here the tests reach it directly.
      if (url.pathname === '/rescue' && req.method === 'POST') {
        return json(res, 200, { result: cloud.rescueCode(url.searchParams.get('name') ?? '') })
      }

      // What a phone's lock screen would show: the notifications "sent" so far, and who
      // is signed up for them. The real cloud hands these to the browser's push service.
      if (url.pathname === '/pushes' && req.method === 'GET') {
        return json(res, 200, { result: { sent: cloud.sentPushes(), devices: cloud.pushSubscriptions() } })
      }

      // The owner's side of notifications, run from the SQL editor in the real cloud:
      // no "value" is "not set up yet", a value is the key browsers sign up with.
      if (url.pathname === '/push-key' && req.method === 'POST') {
        cloud.setPushPublicKey(url.searchParams.get('value') || null)
        return json(res, 200, { result: null })
      }

      // The minute job of the real cloud: announce envelopes whose time has come.
      if (url.pathname === '/tick' && req.method === 'POST') {
        cloud.tick()
        return json(res, 200, { result: null })
      }

      // A row as the cloud has it, whoever may read it. For tests that check what the
      // cloud keeps (and what it has forgotten).
      if (url.pathname === '/peek' && req.method === 'GET') {
        return json(res, 200, { result: cloud.peek(url.searchParams.get('table') as never, url.searchParams.get('id') ?? '') ?? null })
      }

      if (url.pathname === '/events') {
        const household = url.searchParams.get('household')
        res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' })
        res.write(': connected\n\n')
        const stop = cloud.subscribe((changed) => {
          if (changed === household) res.write('data: change\n\n')
        })
        req.on('close', stop)
        return
      }

      if (url.pathname.startsWith('/rpc/') && req.method === 'POST') {
        const method = url.pathname.slice('/rpc/'.length)
        const args = JSON.parse((await readBody(req)).toString('utf8') || '[]') as unknown[]
        if (method === 'signIn') return json(res, 200, { result: cloud.signIn() })
        if (!METHODS.has(method)) return json(res, 404, { kind: 'rejected', code: 'unknown_method' })
        if (!user) return json(res, 401, { kind: 'auth', code: 'not_signed_in' })
        const fn = (cloud as unknown as Record<string, (...a: unknown[]) => unknown>)[method]
        const result = fn.call(cloud, user, ...args)
        return json(res, 200, { result: result ?? null })
      }

      if (url.pathname.startsWith('/blob/')) {
        const path = decodeURIComponent(url.pathname.slice('/blob/'.length))
        if (req.method === 'PUT') {
          const body = await readBody(req)
          cloud.uploadBlob(user, path, new Uint8Array(body), String(req.headers['content-type'] ?? 'application/octet-stream'))
          return json(res, 200, { result: null })
        }
        if (req.method === 'DELETE') {
          cloud.removeBlob(user, path)
          return json(res, 200, { result: null })
        }
        const found = cloud.downloadBlob(user, path)
        if (!found) return json(res, 404, { kind: 'rejected', code: 'not_found' })
        res.statusCode = 200
        res.setHeader('content-type', found.type)
        return res.end(Buffer.from(found.bytes))
      }

      json(res, 404, { kind: 'rejected', code: 'not_found' })
    } catch (e) {
      if (e instanceof BackendError) return json(res, 400, { kind: e.kind, code: e.code, details: e.details })
      json(res, 500, { kind: 'network', code: 'fake_cloud_crashed', message: String(e) })
    }
  }

  return {
    name: 'whisperus-fake-cloud',
    configureServer(server) {
      server.middlewares.use('/__cloud', handler)
    },
    configurePreviewServer(server) {
      server.middlewares.use('/__cloud', handler)
    },
  }
}
