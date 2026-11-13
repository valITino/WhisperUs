import { describe, expect, it } from 'vitest'
import { scrub, syncReport, type SyncReportInput } from '../../src/features/settings/syncReport'

const base: SyncReportInput = {
  version: '0.1.0',
  backend: 'supabase',
  now: '2026-11-10T08:00:00.000Z',
  status: { state: 'idle', pending: 0, uploads: 0, stuck: 0, later: 0, lastSyncAt: '2026-11-10T07:59:00.000Z', lastError: null },
  online: true,
  lang: 'en',
  theme: 'light',
  members: 2,
  householdId: '11111111-2222-3333-4444-555555555555',
  memberId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
  userAgent: 'TestPhone/1.0',
  refused: [],
}

describe('the sync report for support', () => {
  it('lists the state, the counts and the versions', () => {
    const text = syncReport(base)
    expect(text.split('\n')[0]).toBe('WhisperUs sync report')
    expect(text).toContain('App: 0.1.0 (supabase)')
    expect(text).toContain('State: idle')
    expect(text).toContain('Last sync: 2026-11-10T07:59:00.000Z')
    expect(text).toContain('Changes waiting: 0')
    expect(text).toContain('Voice notes waiting: 0')
    expect(text).toContain('Refused changes: 0')
    expect(text).toContain('Last error: none')
    expect(text).toContain('Phone: TestPhone/1.0')
  })

  it('shows only the start of the ids', () => {
    const text = syncReport(base)
    expect(text).toContain('Room: 11111111, people: 2, me: aaaaaaaa')
    expect(text).not.toContain('2222-3333')
    expect(text).not.toContain('bbbb-cccc')
  })

  it('spells out trouble: offline, waiting changes, refused changes, the last error', () => {
    const text = syncReport({
      ...base,
      online: false,
      status: { state: 'error', pending: 3, uploads: 1, stuck: 12, later: 0, lastSyncAt: null, lastError: 'forbidden' },
      refused: Array.from({ length: 12 }, (_, i) => ({ table: 'envelopes', kind: 'patch', lastError: i ? 'forbidden' : undefined, failedAt: '2026-11-10T07:00:00.000Z' })),
    })
    expect(text).toContain('State: error')
    expect(text).toContain('Online: no')
    expect(text).toContain('Last sync: never')
    expect(text).toContain('Changes waiting: 3')
    expect(text).toContain('Voice notes waiting: 1')
    expect(text).toContain('Last error: forbidden')
    expect(text).toContain('Refused: patch envelopes, no reason given, 2026-11-10T07:00:00.000Z')
    expect(text.match(/^Refused: /gm)).toHaveLength(10)
    expect(text).toContain('and 2 more refused changes')
  })

  it('says which cloud it talks to, and when it comes from an unpaired phone', () => {
    expect(syncReport({ ...base, backend: 'fake' })).toContain('App: 0.1.0 (fake)')
    expect(syncReport({ ...base, householdId: undefined, memberId: undefined, members: 0 })).toContain('Room: none, people: 0, me: none')
  })

  it('adds the last error on record, voice notes that gave up and row counts when it has them', () => {
    const text = syncReport({
      ...base,
      status: { ...base.status, uploads: 3 },
      stuckFiles: 2,
      lastErrorOnRecord: { message: 'new row for relation "envelopes" violates check constraint "envelopes_teaser_check"', at: '2026-11-09T20:00:00.000Z' },
      rows: { envelopes: 31, keys: 140, media: 72 },
    })
    expect(text).toContain('Voice notes waiting: 3 (2 gave up)')
    expect(text).toContain('Last error: none')
    expect(text).toContain('Last error on record: new row for relation "envelopes" violates check constraint "envelopes_teaser_check", 2026-11-09T20:00:00.000Z')
    expect(text).toContain('Rows: envelopes 31, keys 140, media 72')
    expect(syncReport(base)).not.toContain('Rows:')
    expect(syncReport(base)).not.toContain('on record')
  })

  it('carries nothing a person typed, even if an error message quotes it', () => {
    expect(scrub('duplicate key value violates unique constraint "members_household_name_key"')).toBe('duplicate key value violates unique constraint "members_household_name_key"')
    expect(scrub('Key (name)=(Mia Rossi) already exists.')).toBe('Key (name)=(…) already exists.')
    expect(scrub('invalid input value: "Grandma\'s secret Rösti"')).toBe('invalid input value: "…"')
    expect(scrub("Failed to execute 'fetch' on 'Window': cannot reach 'my secret note'")).toBe("Failed to execute 'fetch' on 'Window': cannot reach '…'")
    expect(scrub('line one\n   line two')).toBe('line one line two')
    expect(scrub('x'.repeat(500))).toHaveLength(200)

    const text = syncReport({
      ...base,
      status: { ...base.status, state: 'error', lastError: 'value "Leo loves Mia" is too long' },
      refused: [{ table: 'envelopes', kind: 'put', lastError: 'Failing row contains ("About Saturday")', failedAt: '2026-11-10T07:00:00.000Z' }],
    })
    expect(text).not.toContain('Leo loves Mia')
    expect(text).not.toContain('Speck')
    expect(text).toContain('Last error: value "…" is too long')
  })
})
