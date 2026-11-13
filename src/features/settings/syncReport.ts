// "Copy details": a short plain-text report about sync, to paste into a message when
// something needs looking at. It holds no names and nothing from an envelope, only counts, codes and
// the first characters of the ids. Always in English, because support reads it.

import type { SyncStatus } from '../../data/sync'

export interface SyncReportInput {
  version: string
  /** Which cloud the app talks to: "supabase" or the pretend one. */
  backend: string
  /** The moment the report was made (ISO). */
  now: string
  status: SyncStatus
  online: boolean
  lang: string
  theme: string
  /** How many people are in the room on this phone's copy. */
  members: number
  householdId?: string
  memberId?: string
  userAgent: string
  /** Changes the cloud refused and that were set aside. */
  refused: { table: string; kind: string; lastError?: string; failedAt: string }[]
  /** The last error on record, even if sync has recovered since. */
  lastErrorOnRecord?: { message: string; at: string } | null
  /** Sealed files the cloud refused so often that they wait for "Try again". */
  stuckFiles?: number
  /** How many rows this device holds per table. Numbers only. */
  rows?: Record<string, number>
}

const short = (id: string | undefined) => (id ? id.slice(0, 8) : 'none')

/**
 * An error message, made safe to pass on. The cloud's messages name tables and rules
 * (kept), and could in theory quote something a person typed (replaced). Capped in length.
 */
export function scrub(message: string): string {
  return message
    .replace(/\s+/g, ' ')
    .replace(/\(([^()=]*)\)=\(([^()]*)\)/g, '($1)=(…)')
    .replace(/"([^"]*)"/g, (whole, inner: string) => (/^[a-z0-9_.]+$/.test(inner) ? whole : '"…"'))
    .replace(/'([^']*)'/g, (whole, inner: string) => (/^[A-Za-z0-9_.]+$/.test(inner) ? whole : "'…'"))
    .trim()
    .slice(0, 200)
}

export function syncReport(input: SyncReportInput): string {
  const { status } = input
  const lines = [
    'WhisperUs sync report',
    `App: ${input.version} (${input.backend})`,
    `Made: ${input.now}`,
    `State: ${status.state}`,
    `Online: ${input.online ? 'yes' : 'no'}`,
    `Last sync: ${status.lastSyncAt ?? 'never'}`,
    `Changes waiting: ${status.pending}`,
    `Voice notes waiting: ${status.uploads}${input.stuckFiles ? ` (${input.stuckFiles} gave up)` : ''}`,
    `Refused changes: ${status.stuck}`,
    `Last error: ${status.lastError ? scrub(status.lastError) : 'none'}`,
  ]
  if (input.lastErrorOnRecord) lines.push(`Last error on record: ${scrub(input.lastErrorOnRecord.message)}, ${input.lastErrorOnRecord.at}`)
  lines.push(`Room: ${short(input.householdId)}, people: ${input.members}, me: ${short(input.memberId)}`)
  if (input.rows) {
    lines.push(
      `Rows: ${Object.entries(input.rows)
        .map(([table, count]) => `${table} ${count}`)
        .join(', ')}`,
    )
  }
  lines.push(`Language: ${input.lang}, theme: ${input.theme}`, `Phone: ${input.userAgent}`)
  for (const item of input.refused.slice(0, 10)) {
    lines.push(`Refused: ${item.kind} ${item.table}, ${item.lastError ? scrub(item.lastError) : 'no reason given'}, ${item.failedAt}`)
  }
  if (input.refused.length > 10) lines.push(`and ${input.refused.length - 10} more refused changes`)
  return lines.join('\n')
}
