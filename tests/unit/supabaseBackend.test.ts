import { describe, expect, it } from 'vitest'
import { SupabaseBackend } from '../../src/data/supabaseBackend'

// Points at a port nothing listens on, so these tests can never reach a real project.
const unreachable = () => new SupabaseBackend('http://127.0.0.1:9', 'sb_publishable_test')

describe('Supabase backend when the cloud cannot be reached', () => {
  it('reports "offline" when signing in fails, so the sync engine simply tries again later', async () => {
    await expect(unreachable().ensureSession()).rejects.toMatchObject({ name: 'BackendError', kind: 'network' })
  })

  it('reports "offline" for pulls and pushes too', async () => {
    const backend = unreachable()
    await expect(backend.pull(null)).rejects.toMatchObject({ kind: 'network' })
    await expect(backend.push({ table: 'envelopes', kind: 'patch', id: crypto.randomUUID(), data: { teaser: 'x' } })).rejects.toMatchObject({ kind: 'network' })
  })
})
