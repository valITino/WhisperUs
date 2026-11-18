// A why, tidied before it is saved. Shared by the screens that ask "and why?" and by
// the actions that write what was answered.

import type { Why } from './types'

export const OWN_MAX = 60
export const OWN_LIMIT = 6
export const NOTE_MAX = 600

export const isEmptyWhy = (why: Why | null | undefined): boolean => !why || (why.chips.length === 0 && why.own.length === 0 && !why.note?.trim())

/** Tidy a why before it is saved: no blanks, no doubles, nothing over length. */
export function cleanWhy(why: Why): Why {
  const own = [...new Set(why.own.map((word) => word.trim().slice(0, OWN_MAX)).filter(Boolean))].slice(0, OWN_LIMIT)
  return { chips: [...new Set(why.chips)], own, note: why.note?.trim().slice(0, NOTE_MAX) || null }
}
