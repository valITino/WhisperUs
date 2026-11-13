import { describe, expect, it } from 'vitest'
import { camelKeys, reviveRow, snakeKeys } from '../../src/data/case'

describe('column name conversion', () => {
  it('converts top-level names both ways and leaves what is nested alone', () => {
    const row = { householdId: 'h', heatOutside: null, reply: { taps: ['safe'], why: { chips: ['received.close'], own: [], note: null } }, seen: { words: '2026-11-13T21:00:00Z' } }
    const snake = snakeKeys(row)
    expect(snake).toEqual({ household_id: 'h', heat_outside: null, reply: { taps: ['safe'], why: { chips: ['received.close'], own: [], note: null } }, seen: { words: '2026-11-13T21:00:00Z' } })
    expect(camelKeys(snake)).toEqual(row)
  })

  it('leaves rows as they are: no table has a column that Postgres sends as a numeric string', () => {
    const row = { bytes: 4096, opensAt: '2026-11-13T21:00:00Z', layers: { words: { iv: 'a', box: 'b' } } }
    expect(reviveRow('media', { ...row })).toEqual(row)
    expect(reviveRow('envelopes', { ...row })).toEqual(row)
  })
})
