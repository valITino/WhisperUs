import type { Kit } from '../../src/data/actions'
import { AppDB } from '../../src/data/db'
import type { FakeCloud } from '../../src/data/fake/cloudCore'
import { MemoryBackend } from '../../src/data/fake/memoryBackend'
import { takeSeat } from '../../src/data/seat'
import { Store } from '../../src/data/store'
import { SyncEngine } from '../../src/data/sync'
import { newId, nowIso, type Envelope, type ID } from '../../src/data/types'

let counter = 0

export interface Phone {
  db: AppDB
  backend: MemoryBackend
  store: Store
  engine: SyncEngine
  /** What the actions in src/data/actions.ts ask for. */
  kit: Kit
  adopt(m: { householdId: ID; memberId: ID }): Promise<void>
  /** Put a plain envelope of this phone's person into the room: nothing inside, opens by hand. */
  envelope(overrides?: Partial<Envelope>): Promise<Envelope>
}

/** A simulated phone: its own local database, its own connection to the shared cloud. */
export function makePhone(cloud: FakeCloud): Phone {
  const db = new AppDB(`phone-${++counter}-${Math.random().toString(36).slice(2)}`)
  const backend = new MemoryBackend(cloud)
  const store = new Store(db)
  const engine = new SyncEngine(db, backend, store)
  // Tests drive sync passes by hand, so writes must not start background passes.
  store.onWrite = () => {}

  return {
    db,
    backend,
    store,
    engine,
    kit: { db, store, backend },
    async adopt(m) {
      await takeSeat(db, m)
    },
    async envelope(overrides = {}) {
      const at = nowIso()
      const envelope: Envelope = {
        id: newId(),
        householdId: (await store.householdId()) as ID,
        authorId: (await store.memberId()) as ID,
        kind: 'confession',
        teaser: 'About Saturday',
        heatOutside: null,
        wants: 'listen',
        keep: 'keep',
        openMode: 'hand',
        opensAt: null,
        layers: {},
        seen: {},
        reply: null,
        createdAt: at,
        updatedAt: at,
        deletedAt: null,
        ...overrides,
      }
      await store.put('envelopes', envelope)
      return envelope
    },
  }
}

export const HER_PIN = '271828'
export const HIS_PIN = '314159'

/** Two phones in one room: she opened it (so she is the admin), he joined with her invite code. */
export async function makeCouple(cloud: FakeCloud): Promise<{ her: Phone; him: Phone }> {
  const her = makePhone(cloud)
  const him = makePhone(cloud)
  await her.adopt(await her.backend.createHousehold('Our room', { name: 'Mia' }, HER_PIN))
  const invite = await her.backend.createInvite('join')
  await him.adopt(await him.backend.joinHousehold(invite.code, { name: 'Leo' }, HIS_PIN))
  await her.engine.sync()
  await him.engine.sync()
  return { her, him }
}

/** One more device of somebody who is in the room already: logged in with name and PIN. */
export async function anotherDevice(cloud: FakeCloud, name: string, pin: string): Promise<Phone> {
  const phone = makePhone(cloud)
  await phone.adopt(await phone.backend.signInWithPin(name, pin))
  await phone.engine.sync()
  return phone
}

/** Both phones send what they have and fetch what there is, until nothing moves any more. */
export async function settle(...phones: Phone[]): Promise<void> {
  for (let round = 0; round < 2; round++) for (const phone of phones) await phone.engine.sync()
}
