// The push function without its Deno wrapper (index.ts), so the whole of it can run in
// the unit tests against a stand-in database and a stand-in push service.
//
// It receives one event from the database (0003_push.sql), looks up who should hear about
// it, sends each of their devices one notification, and forgets devices the push service
// reports as gone.
//
// It is given no secrets of its own. The shared secret, the subject and the VAPID keys
// live in the database (private.push_config); it fetches them with the service role key
// that Supabase hands every function, and makes the key pair itself the first time.

import { langOf, parseEvent, plan, type PushEvent, type Room } from './logic.ts'
import { sendWebPush, toBase64Url } from './webpush.ts'

export interface PushConfig {
  supabaseUrl: string
  /** Reads past row-level security. Never leaves the function. */
  serviceRoleKey: string
}

export interface Tools {
  fetch: typeof fetch
  now: () => Date
}

/** The header the database trigger puts the shared secret in. */
export const SECRET_HEADER = 'x-push-secret'
/** How long fetched settings are used before the database is asked again. */
const KEEP_MS = 5 * 60_000
/** However many wrong secrets arrive, the database is asked at most this often. */
const RETRY_MS = 10_000

/** What private.push_config holds for us (public.push_settings). */
interface Settings {
  secret: string
  subject: string
  /** Empty until the key pair has been made. */
  publicKey: string
  privateKey: string
}

type Row = Record<string, unknown>

const json = (status: number, body: unknown): Response => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
/** A text column, or nothing. */
const str = (value: unknown): string => (typeof value === 'string' ? value : '')

/** Compare without giving away, through timing, how much of a guess was right. */
async function same(a: string, b: string): Promise<boolean> {
  const digest = async (value: string) => new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))
  const [x, y] = await Promise.all([digest(a), digest(b)])
  let difference = 0
  for (let i = 0; i < x.length; i++) difference |= x[i] ^ y[i]
  return difference === 0
}

export function pushHandler(config: PushConfig, tools: Tools = { fetch, now: () => new Date() }): (request: Request) => Promise<Response> {
  const headers = { apikey: config.serviceRoleKey, Authorization: `Bearer ${config.serviceRoleKey}`, 'Content-Type': 'application/json' }
  let settings: Settings | null = null
  let lookedAt = 0

  /** The database's REST API, with the service role's rights. */
  async function database(path: string, init: RequestInit = {}): Promise<unknown> {
    const response = await tools.fetch(`${config.supabaseUrl}/rest/v1/${path}`, { ...init, headers })
    if (!response.ok) throw new Error(`database said ${response.status} to ${path.split('?')[0]}`)
    return response.status === 204 ? null : response.json()
  }
  const rows = (query: string) => database(query) as Promise<Row[]>
  const call = (name: string, args: Row = {}) => database(`rpc/${name}`, { method: 'POST', body: JSON.stringify(args) }) as Promise<Row | null>

  /** Ask the database for our settings. Null while notifications are not set up. */
  async function look(): Promise<Settings | null> {
    const raw = await call('push_settings')
    // (Only an answer counts as a look. A database that is down is asked again next time.)
    lookedAt = tools.now().getTime()
    settings = raw && str(raw.secret) ? { secret: str(raw.secret), subject: str(raw.subject), publicKey: str(raw.vapid_public), privateKey: str(raw.vapid_private) } : null
    return settings
  }

  /** The settings with a key pair in them: made now, and stored, if there was none. */
  async function withKeys(known: Settings): Promise<Settings> {
    if (known.publicKey && known.privateKey) return known
    const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])
    const made = {
      p_public: toBase64Url(new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey))),
      p_private: str((await crypto.subtle.exportKey('jwk', pair.privateKey)).d),
    }
    // The database keeps the first pair it is given and answers with the one it has.
    const stored = await call('push_store_keys', made)
    if (!stored || !str(stored.vapid_public) || !str(stored.vapid_private)) throw new Error('the key pair could not be stored')
    settings = { ...known, publicKey: str(stored.vapid_public), privateKey: str(stored.vapid_private) }
    return settings
  }

  async function lookUp(event: PushEvent): Promise<Room> {
    const room = `household_id=eq.${event.householdId}`
    const [members, envelopes, keys, devices] = await Promise.all([
      rows(`members?${room}&deleted_at=is.null&select=id,name,prefs,disabled_at`),
      rows(`envelopes?id=eq.${event.envelopeId}&${room}&select=author_id,open_mode,opens_at,created_at,deleted_at,seen,reply`),
      // (A burnt key is marked deleted. The key itself is never asked for: the function has no use for it.)
      rows(`keys?envelope_id=eq.${event.envelopeId}&${room}&deleted_at=is.null&select=layer,opens_at`),
      rows(`push_subscriptions?${room}&select=id,member_id,endpoint,p256dh,auth,muted_types`),
    ])
    const envelope = envelopes[0]
    const now = tools.now().getTime()
    const seen = (envelope?.seen ?? {}) as Row
    // What the reader can open right now and has not opened yet. Only counted, never read.
    const open = keys.filter((k) => Date.parse(str(k.opens_at)) <= now && seen[str(k.layer)] == null)
    const reply = envelope?.reply as Row | null | undefined
    return {
      people: members.map((m) => ({ id: str(m.id), name: str(m.name), lang: langOf(m.prefs), paused: m.disabled_at != null })),
      devices: devices.map((d) => ({
        id: str(d.id),
        memberId: str(d.member_id),
        endpoint: str(d.endpoint),
        p256dh: str(d.p256dh),
        auth: str(d.auth),
        mutedTypes: Array.isArray(d.muted_types) ? (d.muted_types as string[]) : [],
      })),
      envelope: envelope
        ? {
            deleted: envelope.deleted_at != null,
            authorId: str(envelope.author_id),
            openMode: str(envelope.open_mode),
            opensAt: str(envelope.opens_at) || null,
            createdAt: str(envelope.created_at) || null,
            waiting: open.length,
            openedAt: open.map((k) => str(k.opens_at)).sort().at(-1) ?? null,
            repliedAt: reply ? str(reply.at) || str(envelope.created_at) : null,
          }
        : null,
    }
  }

  return async (request) => {
    if (request.method !== 'POST') return json(405, { error: 'post_only' })
    const given = request.headers.get(SECRET_HEADER)
    // A call without the secret is refused before anything is looked up.
    if (!given) return json(401, { error: 'wrong_secret' })

    try {
      const age = () => tools.now().getTime() - lookedAt
      // (A look that found nothing is not repeated for a moment either.)
      let known = settings && age() < KEEP_MS ? settings : age() < RETRY_MS ? null : await look()
      // The secret may have been replaced since we last looked: look once more.
      if (known && !(await same(given, known.secret)) && age() >= RETRY_MS) known = await look()
      if (!known) return json(500, { error: 'not_set_up' })
      if (!(await same(given, known.secret))) return json(401, { error: 'wrong_secret' })

      const body: unknown = await request.json().catch(() => null)
      if ((body as Row | null)?.type === 'init') {
        // Set-up asks for the key pair. Always from a fresh look: the keys may have been thrown away.
        const fresh = await withKeys((await look()) ?? known)
        return json(200, { ok: true, publicKey: fresh.publicKey })
      }
      const event = parseEvent(body)
      if (!event) return json(400, { error: 'not_an_event' })

      const ready = await withKeys(known)
      const vapid = { publicKey: ready.publicKey, privateKey: ready.privateKey, subject: ready.subject }
      const gone: string[] = []
      let sent = 0
      let failed = 0
      await Promise.all(
        plan(event, await lookUp(event), tools.now()).map(async ({ device, message, urgency, topic, ttl }) => {
          try {
            const answer = await sendWebPush(device, JSON.stringify(message), vapid, { ttl, urgency, topic }, tools.fetch, tools.now())
            // The browser threw the subscription away (app removed, data cleared): forget the device.
            if (answer.status === 404 || answer.status === 410) gone.push(device.id)
            else if (answer.ok) sent += 1
            else failed += 1
          } catch {
            // One unreachable push service must not keep the other devices waiting.
            failed += 1
          }
        }),
      )
      if (gone.length > 0) await database(`push_subscriptions?id=in.(${gone.join(',')})`, { method: 'DELETE' })
      return json(200, { type: event.type, sent, gone: gone.length, failed })
    } catch (error) {
      return json(502, { error: 'failed', message: error instanceof Error ? error.message : String(error) })
    }
  }
}
