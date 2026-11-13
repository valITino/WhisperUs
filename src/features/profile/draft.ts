// A profile while it is being edited: the same shape in the start wizard and in Settings.
// Pure helpers only, so they can be unit tested without a browser.

import type { ProfileChanges } from '../../data/actions'
import type { ProfileInput } from '../../data/backend'
import { nameKey } from '../../data/pin'
import type { Member } from '../../data/types'

export const DISC_COLORS = ['candle', 'wax', 'moss', 'plum'] as const
export const NAME_MAX = 40
export const STATUS_MAX = 60

export interface ProfileDraft {
  name: string
  avatar: string
  color: string
  accessory: string | null
  status: string
}

/**
 * A friendly starting point. Whoever opens the room starts as the moon; whoever joins
 * starts as the sun, or as the moon if the host already took the sun.
 */
export function defaultDraft(hostAvatar?: string | null): ProfileDraft {
  if (hostAvatar === undefined) return { name: '', avatar: 'moon', color: 'candle', accessory: null, status: '' }
  return { name: '', avatar: hostAvatar === 'sun' ? 'moon' : 'sun', color: 'plum', accessory: null, status: '' }
}

export function draftFromMember(member: Pick<Member, 'name' | 'avatar' | 'color' | 'accessory' | 'status'>): ProfileDraft {
  return {
    name: member.name,
    avatar: member.avatar,
    color: member.color,
    accessory: member.accessory ?? null,
    status: member.status ?? '',
  }
}

/** Cut a text to a length without leaving half an emoji behind. */
export function clip(text: string, max: number): string {
  if (text.length <= max) return text
  let cut = text.slice(0, max)
  const last = cut.charCodeAt(cut.length - 1)
  if (last >= 0xd800 && last <= 0xdbff) cut = cut.slice(0, -1)
  return cut
}

/** The whole profile, as opening or joining a room takes it. */
export function toProfileInput(draft: ProfileDraft): ProfileInput {
  return {
    name: clip(draft.name.trim(), NAME_MAX),
    avatar: draft.avatar,
    color: draft.color,
    accessory: draft.accessory,
    status: clip(draft.status.trim(), STATUS_MAX) || null,
  }
}

/**
 * The look for somebody who was just invited. As long as they have not touched their
 * look, it is the counterpart of the host's.
 */
export function asGuestOf(draft: ProfileDraft, hostAvatar: string | null | undefined): ProfileDraft {
  const was = defaultDraft()
  const untouched = draft.avatar === was.avatar && draft.color === was.color && draft.accessory === null
  const next = defaultDraft(hostAvatar ?? null)
  return untouched ? { ...draft, avatar: next.avatar, color: next.color } : draft
}

/** Two names are the same log-in when they match without capitals and outer spaces. */
export const sameName = (a: string, b: string): boolean => nameKey(a) === nameKey(b)

/** Only the fields that differ from the saved profile, so a save sends as little as possible. */
export function changesBetween(saved: ProfileDraft, draft: ProfileDraft): ProfileChanges {
  const changes: ProfileChanges = {}
  const name = clip(draft.name.trim(), NAME_MAX)
  const status = clip(draft.status.trim(), STATUS_MAX)
  if (name !== saved.name) changes.name = name
  if (draft.avatar !== saved.avatar) changes.avatar = draft.avatar
  if (draft.color !== saved.color) changes.color = draft.color
  if (draft.accessory !== saved.accessory) changes.accessory = draft.accessory
  if (status !== saved.status.trim()) changes.status = status || null
  return changes
}

export const isReady = (draft: ProfileDraft): boolean => draft.name.trim().length > 0

/** The next suggestion in the list after the current status. Goes round and round. */
export function nextSuggestion(suggestions: readonly string[], current: string): string {
  if (suggestions.length === 0) return current
  const at = suggestions.indexOf(current.trim())
  return suggestions[(at + 1) % suggestions.length]
}
