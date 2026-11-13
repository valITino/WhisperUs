// What somebody has put together in the booth so far. Kept on this phone for a day, so a
// reload or a moment of doubt does not throw the words away. A recording is never part of
// what is kept: it lives in memory until the envelope is sealed.

import type { FeelBody, Heat, ISO, Keep, Layer, OpenMode, Score5, Wants, Why } from '../../data/types'
import { NO_WHY } from '../../data/types'
import { cleanWhy, isEmptyWhy } from '../why'

const SLOT = 'whisperus.boothDraft'
const MAX_AGE_MS = 24 * 3_600_000

export interface BoothDraft {
  step: number
  words: string
  heat: Heat | null
  ease: Score5 | null
  why: Why
  teaser: string
  showHeat: boolean
  wants: Wants
  keep: Keep
  openMode: OpenMode
  /** openMode "at": the chosen moment. */
  opensAt: ISO | null
  /** Layers that stay behind on this phone when the envelope opens. */
  holdBack: Layer[]
}

export const freshDraft = (): BoothDraft => ({
  step: 0,
  words: '',
  heat: null,
  ease: null,
  why: NO_WHY,
  teaser: '',
  showHeat: false,
  // The gentlest choices first: nothing is asked of the other one, and nothing leaves
  // this phone until its author says so.
  wants: 'listen',
  keep: 'keep',
  openMode: 'hand',
  opensAt: null,
  holdBack: [],
})

/** How it felt, as it goes into the envelope. Null when nothing was said about it. */
export function feelOf(draft: BoothDraft): FeelBody | null {
  const why = cleanWhy(draft.why)
  if (draft.heat === null && draft.ease === null && isEmptyWhy(why)) return null
  return { heat: draft.heat, ease: draft.ease, why }
}

/** Whether there is anything in the draft worth asking about before it is left. */
export const hasContent = (draft: BoothDraft, recorded: boolean): boolean => recorded || draft.words.trim() !== '' || feelOf(draft) !== null || draft.teaser.trim() !== ''

const oneOf = <T extends string>(value: unknown, allowed: readonly T[], fallback: T): T => (allowed.includes(value as T) ? (value as T) : fallback)
const score = (value: unknown): Score5 | null => (value === 1 || value === 2 || value === 3 || value === 4 || value === 5 ? value : null)

/** Read a saved draft, or null when there is none, it is too old or it does not look right. */
export function parseDraft(raw: string | null, now = Date.now()): BoothDraft | null {
  if (!raw) return null
  try {
    const saved = JSON.parse(raw) as { at?: number; draft?: Partial<BoothDraft> }
    const d = saved.draft
    if (!d || typeof saved.at !== 'number' || now - saved.at > MAX_AGE_MS) return null
    const base = freshDraft()
    const why = (d.why ?? {}) as Partial<Why>
    const opensAt = typeof d.opensAt === 'string' && !Number.isNaN(Date.parse(d.opensAt)) ? d.opensAt : null
    return {
      step: d.step === 1 || d.step === 2 ? d.step : 0,
      words: typeof d.words === 'string' ? d.words : '',
      heat: score(d.heat),
      ease: score(d.ease),
      why: {
        chips: Array.isArray(why.chips) ? why.chips.filter((chip): chip is string => typeof chip === 'string') : [],
        own: Array.isArray(why.own) ? why.own.filter((own): own is string => typeof own === 'string') : [],
        note: typeof why.note === 'string' ? why.note : null,
      },
      teaser: typeof d.teaser === 'string' ? d.teaser : '',
      showHeat: d.showHeat === true,
      wants: oneOf(d.wants, ['listen', 'react', 'talk'], base.wants),
      keep: oneOf(d.keep, ['keep', 'once'], base.keep),
      openMode: oneOf(d.openMode, ['now', 'at', 'hand'], base.openMode),
      opensAt,
      holdBack: Array.isArray(d.holdBack) ? d.holdBack.filter((layer): layer is Layer => layer === 'feel' || layer === 'words' || layer === 'voice') : [],
    }
  } catch {
    return null
  }
}

export function loadDraft(): BoothDraft | null {
  try {
    return parseDraft(localStorage.getItem(SLOT))
  } catch {
    return null
  }
}

export function saveDraft(draft: BoothDraft): void {
  try {
    localStorage.setItem(SLOT, JSON.stringify({ at: Date.now(), draft }))
  } catch {
    /* private mode: the draft lives on in memory until the app closes */
  }
}

export function clearDraft(): void {
  try {
    localStorage.removeItem(SLOT)
  } catch {
    /* nothing to clear */
  }
}
