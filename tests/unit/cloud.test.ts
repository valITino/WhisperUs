import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { cloudKnown } from '../../src/data/cloud'

// A build either knows its cloud or shows one page that says it does not. Nothing in
// between: half an address must not produce a start screen whose buttons fail.

const root = join(__dirname, '../..')
const env = (file: string): Record<string, string> =>
  Object.fromEntries(
    readFileSync(join(root, file), 'utf8')
      .split('\n')
      .filter((line) => /^[A-Z_]+=/.test(line))
      .map((line) => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1).trim()]),
  )

describe('whether a build knows its cloud', () => {
  const url = 'https://abcdefghijklmnopqrst.supabase.co'
  const key = 'sb_publishable_0123456789abcdefghij'

  it('the pretend cloud of the dev server is always known', () => {
    expect(cloudKnown({ backend: 'fake' })).toBe(true)
  })

  it('a real one needs its address and its key', () => {
    expect(cloudKnown({ backend: 'supabase', url, key })).toBe(true)
    expect(cloudKnown({ url: `${url}/`, key })).toBe(true)
    expect(cloudKnown({ backend: 'supabase', url, key: '' })).toBe(false)
    expect(cloudKnown({ backend: 'supabase', url: '', key })).toBe(false)
    expect(cloudKnown({ backend: 'supabase' })).toBe(false)
    expect(cloudKnown({})).toBe(false)
  })

  it('takes nothing that is not an https address, and no key too short to be one', () => {
    expect(cloudKnown({ url: 'http://abcdefghijklmnopqrst.supabase.co', key })).toBe(false)
    expect(cloudKnown({ url: 'abcdefghijklmnopqrst.supabase.co', key })).toBe(false)
    expect(cloudKnown({ url: `${url}/rest/v1`, key })).toBe(false)
    expect(cloudKnown({ url: '   ', key })).toBe(false)
    expect(cloudKnown({ url, key: 'todo' })).toBe(false)
  })
})

describe('the settings in the repository', () => {
  it('development talks to the pretend cloud and to nothing else', () => {
    expect(env('.env.development')).toEqual({ VITE_BACKEND: 'fake' })
  })

  it('production names one cloud completely, or none at all', () => {
    const production = env('.env.production')
    expect(production.VITE_BACKEND).toBe('supabase')
    const named = Boolean(production.VITE_SUPABASE_URL) || Boolean(production.VITE_SUPABASE_KEY)
    expect(cloudKnown({ backend: 'supabase', url: production.VITE_SUPABASE_URL, key: production.VITE_SUPABASE_KEY })).toBe(named)
    // Only ever the publishable key. A secret key would open the whole database to anybody.
    expect(production.VITE_SUPABASE_KEY ?? '').not.toMatch(/^sb_secret_|service_role/)
    expect(production.VITE_SUPABASE_KEY ?? '').not.toMatch(/^eyJ/)
  })

  it('nothing in the repository carries a secret key', () => {
    for (const file of ['.env.production', '.env.development', '.github/workflows/keepalive.yml', '.github/workflows/deploy.yml', '.github/workflows/check.yml']) {
      expect(readFileSync(join(root, file), 'utf8'), file).not.toMatch(/sb_secret_|service_role|eyJhbGciOi/)
    }
  })
})
