// What a person notes about themselves: a check-in, an answer to a question about
// themselves, what they say to an item of the list.
//
// Two places, one rule. The whole of it is written to the `diary`, a table that never
// leaves this phone. What its author chooses to show is written, part by part, to a row
// that syncs (`notes`, `leanings`) under the same id. Nothing is shown on anybody's
// behalf: a part that is not named in `share` stays here.
//
// The ids are stable (types.ts, stableId): this morning's check-in is the same row on
// every device of mine, so checking in again changes it instead of adding a second one.

import { addDays, toDay, zurichMinutes, type Day } from '../lib/dates'
import { ActionError, stamp, who, type Kit } from './actions'
import type { DiaryEntry } from './db'
import { CHECKIN_PARTS, CHECKIN_SCALES, nowIso, stableId, type AboutBody, type AboutPart, type CheckinBody, type CheckinPart, type Half, type ID, type ISO, type Lean, type Leaning, type LeaningBody, type Note, type Often, type Score5, type Why } from './types'
import { cleanWhy, isEmptyWhy } from './why'

// ------------------------------------------------------------------ slots --

export interface Slot {
  day: Day
  half: Half
}

/** The day turns at four in the morning: a check-in at half past one belongs to the evening before. */
const DAY_TURNS = 4 * 60
/** From here on a check-in is the second of its day. */
const SECOND_HALF = 14 * 60

/** Which check-in of which day a moment belongs to, on the room's clock. */
export function slotOf(moment: Date | ISO): Slot {
  const minutes = zurichMinutes(moment)
  const day = toDay(moment)
  if (minutes < DAY_TURNS) return { day: addDays(day, -1), half: 'pm' }
  return { day, half: minutes < SECOND_HALF ? 'am' : 'pm' }
}

export const slotRef = (slot: Slot): string => `${slot.day}.${slot.half}`

/** "2026-11-17.am" back into its day and half. Null when it is not a slot. */
export function parseSlot(ref: string): Slot | null {
  const match = /^(\d{4}-\d{2}-\d{2})\.(am|pm)$/.exec(ref)
  return match ? { day: match[1], half: match[2] as Half } : null
}

// ------------------------------------------------------------------ tidying --

const score = (value: unknown): Score5 | undefined => (typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 5 ? (value as Score5) : undefined)
const often = (value: unknown): Often | undefined => (typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 4 ? (value as Often) : undefined)
const ids = (value: unknown, limit: number): string[] | undefined => {
  if (!Array.isArray(value)) return undefined
  const clean = [...new Set(value.filter((id): id is string => typeof id === 'string' && id.length > 0 && id.length <= 60))].slice(0, limit)
  return clean.length > 0 ? clean : undefined
}
const why = (value: unknown): Why | undefined => {
  if (!value || typeof value !== 'object') return undefined
  const raw = value as Partial<Why>
  const clean = cleanWhy({ chips: Array.isArray(raw.chips) ? raw.chips.filter((c): c is string => typeof c === 'string') : [], own: Array.isArray(raw.own) ? raw.own.filter((o): o is string => typeof o === 'string') : [], note: typeof raw.note === 'string' ? raw.note : null })
  return isEmptyWhy(clean) ? undefined : clean
}

/** A check-in as it is kept: only the parts that were really answered, each within its range. */
export function cleanCheckin(body: Record<string, unknown>): CheckinBody {
  const out: CheckinBody = {}
  for (const part of CHECKIN_SCALES) {
    const value = score(body[part])
    if (value !== undefined) out[part] = value
  }
  const thoughts = often(body.thoughts)
  if (thoughts !== undefined) out.thoughts = thoughts
  const fantasies = ids(body.fantasies, 12)
  if (fantasies) out.fantasies = fantasies
  const happened = ids(body.happened, 12)
  if (happened) out.happened = happened
  const reasons = why(body.why)
  if (reasons) out.why = reasons
  return out
}

export function cleanAbout(body: Record<string, unknown>): AboutBody {
  const out: AboutBody = {}
  const value = score(body.value)
  if (value !== undefined) out.value = value
  const reasons = why(body.why)
  if (reasons) out.why = reasons
  return out
}

const LEANS: readonly Lean[] = ['yes', 'maybe', 'dream', 'no']

export function cleanLeaning(body: Record<string, unknown>): LeaningBody | null {
  if (!LEANS.includes(body.lean as Lean)) return null
  const out: LeaningBody = { lean: body.lean as Lean }
  // A "not for me" needs no strength. Its why is welcome and stays here.
  const pull = out.lean === 'no' ? undefined : score(body.pull)
  if (pull !== undefined) out.pull = pull
  const reasons = why(body.why)
  if (reasons) out.why = reasons
  if (body.quiet === true && out.lean !== 'no') out.quiet = true
  return out
}

/** Only the named parts of a body: what the synced row carries. */
export function shownParts(body: Record<string, unknown>, shared: readonly string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const part of shared) if (body[part] !== undefined) out[part] = body[part]
  return out
}

// ------------------------------------------------------------- writing notes --

interface NoteInput {
  id: ID
  kind: Note['kind']
  ref: string
  at: ISO
  body: Record<string, unknown>
  shared: string[]
}

/** The whole of it into the diary; the shown parts into the row that syncs. */
async function writeNote(kit: Kit, householdId: ID, memberId: ID, input: NoteInput): Promise<void> {
  const now = nowIso()
  const entry: DiaryEntry = { id: input.id, kind: input.kind, ref: input.ref, at: input.at, body: input.body, shared: input.shared, updatedAt: now }
  await kit.db.diary.put(entry)
  const row = await kit.db.notes.get(input.id)
  if (input.shared.length === 0) {
    // Nothing is shown. If something was, the row is emptied (not removed: it may be shown
    // again). If nothing was, nothing is sent at all: the cloud does not even learn that
    // something was noted, or when.
    if (row && !row.deletedAt && Object.keys(row.body).length > 0) await kit.store.patch('notes', input.id, { body: {} })
    return
  }
  const shown = shownParts(input.body, input.shared)
  if (row) await kit.store.patch('notes', input.id, { at: input.at, body: shown, deletedAt: null })
  else await kit.store.put('notes', { id: input.id, ...stamp(householdId, now), memberId, kind: input.kind, ref: input.ref, at: input.at, body: shown })
}

async function dropNote(kit: Kit, id: ID): Promise<void> {
  await kit.db.diary.delete(id)
  const row = await kit.db.notes.get(id)
  if (row && !row.deletedAt) await kit.store.remove('notes', id)
}

// ---------------------------------------------------------------- check-in --

export interface CheckinInput {
  body: CheckinBody
  /** The parts the other one may see. Everything else stays on this phone. */
  share: readonly CheckinPart[]
  /** The moment it is about. Now, unless an earlier check-in is being changed. */
  at?: Date
}

/**
 * Note how I am. One check-in per half of a day: checking in again changes it.
 * Resolves with its id.
 */
export async function saveCheckin(kit: Kit, input: CheckinInput): Promise<ID> {
  const { householdId, memberId } = await who(kit)
  const body = cleanCheckin(input.body as Record<string, unknown>)
  if (Object.keys(body).length === 0) throw new ActionError('nothing_noted')
  const at = input.at ?? new Date()
  const ref = slotRef(slotOf(at))
  const id = await stableId(memberId, 'checkin', ref)
  const shared = CHECKIN_PARTS.filter((part) => input.share.includes(part) && body[part] !== undefined)
  // An earlier check-in of the same half keeps the moment it was first made.
  const before = await kit.db.diary.get(id)
  await writeNote(kit, householdId, memberId, { id, kind: 'checkin', ref, at: input.at ? at.toISOString() : (before?.at ?? at.toISOString()), body: body as Record<string, unknown>, shared })
  return id
}

/** Remove a check-in, here and from what the other one sees. */
export async function removeCheckin(kit: Kit, id: ID): Promise<void> {
  await who(kit)
  await dropNote(kit, id)
}

// ------------------------------------------------------------- about myself --

/** Answer one of the questions about myself. An empty answer takes it away again. */
export async function saveAbout(kit: Kit, question: string, answer: AboutBody, share: readonly AboutPart[]): Promise<void> {
  const { householdId, memberId } = await who(kit)
  const id = await stableId(memberId, 'about', question)
  const body = cleanAbout(answer as Record<string, unknown>)
  if (Object.keys(body).length === 0) return dropNote(kit, id)
  const shared = (['value', 'why'] as const).filter((part) => share.includes(part) && body[part] !== undefined)
  await writeNote(kit, householdId, memberId, { id, kind: 'about', ref: question, at: nowIso(), body: body as Record<string, unknown>, shared })
}

// ----------------------------------------------------------------- the list --

/**
 * Say what I think of one item of the list, or (null) take my answer back.
 * "Not for me" and anything kept quiet stay on this phone. The three open answers go
 * to the cloud, which shows them to the other one only when they answered openly too.
 * The why travels only if I say so.
 */
export async function saveLeaning(kit: Kit, item: string, answer: LeaningBody | null, options: { showWhy?: boolean } = {}): Promise<void> {
  const { householdId, memberId } = await who(kit)
  const id = await stableId(memberId, 'leaning', item)
  const row = await kit.db.leanings.get(id)
  const body = answer ? cleanLeaning(answer as unknown as Record<string, unknown>) : null
  const out = body !== null && body.lean !== 'no' && !body.quiet
  const now = nowIso()

  if (!body) await kit.db.diary.delete(id)
  else {
    const shared = out && options.showWhy && body.why ? ['why'] : []
    await kit.db.diary.put({ id, kind: 'leaning', ref: item, at: now, body: body as unknown as Record<string, unknown>, shared, updatedAt: now })
  }

  if (!body || !out) {
    if (row && !row.deletedAt) await kit.store.remove('leanings', id)
    return
  }
  const shown: Pick<Leaning, 'lean' | 'pull' | 'why'> = { lean: body.lean as Leaning['lean'], pull: body.pull ?? null, why: options.showWhy && body.why ? body.why : null }
  if (row) await kit.store.patch('leanings', id, { ...shown, deletedAt: null })
  else await kit.store.put('leanings', { id, ...stamp(householdId, now), memberId, item, ...shown })
}

/**
 * Whether a diary entry holds something that exists on this phone only: a part that is
 * not shown, a "not for me", an answer kept quiet, a why that did not travel.
 */
export function keptHere(entry: DiaryEntry): boolean {
  if (entry.kind !== 'leaning') return Object.keys(entry.body).some((part) => !entry.shared.includes(part))
  const body = entry.body as unknown as LeaningBody
  return body.lean === 'no' || body.quiet === true || (body.why !== undefined && !entry.shared.includes('why'))
}

// ------------------------------------------------------------------ reading --
//
// Pure: rows in, what a screen shows out. A phone that holds the diary knows everything
// its person noted. Another device of theirs has only the shown parts, and says so.

export interface Noted<B> {
  id: ID
  ref: string
  at: ISO
  body: B
  /** The parts the other one may see. */
  shared: string[]
  /** False on a device that only has the shown parts (the whole is on another phone). */
  whole: boolean
}

/** My entries of one kind: the diary where this phone has it, otherwise what I showed. */
export function mine<B>(kind: Note['kind'], diary: readonly DiaryEntry[], notes: readonly Note[], meId: ID): Noted<B>[] {
  const out = new Map<ID, Noted<B>>()
  for (const note of notes) {
    if (note.memberId !== meId || note.kind !== kind || note.deletedAt || Object.keys(note.body).length === 0) continue
    out.set(note.id, { id: note.id, ref: note.ref, at: note.at, body: note.body as B, shared: Object.keys(note.body), whole: false })
  }
  for (const entry of diary) {
    if (entry.kind !== kind) continue
    out.set(entry.id, { id: entry.id, ref: entry.ref, at: entry.at, body: entry.body as B, shared: entry.shared, whole: true })
  }
  return [...out.values()].sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0))
}

/** What the other one chose to show me, newest first. */
export function theirs<B>(kind: Note['kind'], notes: readonly Note[], meId: ID): Noted<B>[] {
  return notes
    .filter((note) => note.memberId !== meId && note.kind === kind && !note.deletedAt && Object.keys(note.body).length > 0)
    .map((note) => ({ id: note.id, ref: note.ref, at: note.at, body: note.body as B, shared: Object.keys(note.body), whole: false }))
    .sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0))
}

export interface MyLeaning extends LeaningBody {
  item: string
  /** Whether the other one may read my why once we meet on this item. */
  whyShown: boolean
}

/** What I said to each item: the diary where this phone has it, otherwise the row that went out. */
export function myLeanings(diary: readonly DiaryEntry[], rows: readonly Leaning[], meId: ID): Map<string, MyLeaning> {
  const out = new Map<string, MyLeaning>()
  for (const row of rows) {
    if (row.memberId !== meId || row.deletedAt) continue
    out.set(row.item, { item: row.item, lean: row.lean, ...(row.pull ? { pull: row.pull } : {}), ...(row.why ? { why: row.why } : {}), whyShown: row.why !== null })
  }
  for (const entry of diary) {
    if (entry.kind !== 'leaning') continue
    out.set(entry.ref, { ...(entry.body as unknown as LeaningBody), item: entry.ref, whyShown: entry.shared.includes('why') })
  }
  return out
}

export interface Match {
  item: string
  mine: Leaning
  theirs: Leaning
  /** When the second of the two said so. */
  since: ISO
}

/** The items both answered openly, newest first. */
export function matchesOf(rows: readonly Leaning[], meId: ID): Match[] {
  const live = rows.filter((row) => !row.deletedAt)
  const out: Match[] = []
  for (const own of live) {
    if (own.memberId !== meId) continue
    const other = live.find((row) => row.memberId !== meId && row.item === own.item)
    if (other) out.push({ item: own.item, mine: own, theirs: other, since: own.createdAt > other.createdAt ? own.createdAt : other.createdAt })
  }
  return out.sort((a, b) => (a.since < b.since ? 1 : a.since > b.since ? -1 : 0))
}
