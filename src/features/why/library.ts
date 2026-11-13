// The reasons the app offers wherever somebody chooses or rates: "and why?".
//
// A reason has a stable id (that is what gets saved, so the Cockpit can count across
// time and across languages), a tone, and its words in both languages. People can always
// add reasons of their own; those are saved as written.
//
// Two tones, never "good" and "bad": warm is what was easy to feel, tender is what was
// harder. Both can be true of the same moment, and the picker says so.

import type { Lang } from '../../i18n'
import type { Why } from '../../data/types'

export type Tone = 'warm' | 'tender'

/**
 * Which question is being answered.
 * said: how it felt to say what is in an envelope.   received: what an envelope did to its reader.
 */
export type WhyContext = 'said' | 'received'

export interface Reason {
  id: string
  tone: Tone
  en: string
  de: string
}

const reasons = (context: WhyContext, tone: Tone, list: [key: string, en: string, de: string][]): Reason[] => list.map(([key, en, de]) => ({ id: `${context}.${key}`, tone, en, de }))

export const LIBRARY: Record<WhyContext, Reason[]> = {
  said: [
    ...reasons('said', 'warm', [
      ['aroused', 'It turned me on', 'Es hat mich angemacht'],
      ['close', 'Close to you', 'Dir nah'],
      ['brave', 'Brave', 'Mutig'],
      ['free', 'Free', 'Frei'],
      ['proud', 'Proud of myself', 'Stolz auf mich'],
      ['playful', 'Playful', 'Verspielt'],
      ['safe', 'Safe with you', 'Sicher bei dir'],
      ['relieved', 'Relieved', 'Erleichtert'],
      ['curious', 'Curious what you think', 'Neugierig, was du denkst'],
    ]),
    ...reasons('said', 'tender', [
      ['shy', 'Shy', 'Schüchtern'],
      ['nervous', 'Nervous', 'Nervös'],
      ['exposed', 'Exposed', 'Entblösst'],
      ['ashamed', 'A little ashamed', 'Ein bisschen beschämt'],
      ['seen-differently', 'Afraid you will see me differently', 'Angst, dass du mich anders siehst'],
      ['your-reaction', 'Worried about your reaction', 'Sorge, wie du reagierst'],
      ['allowed', 'Not sure I am allowed to want this', 'Unsicher, ob ich das wollen darf'],
      ['too-much', 'Afraid it is too much', 'Angst, dass es zu viel ist'],
      ['mixed', 'Mixed up', 'Durcheinander'],
    ]),
  ],
  received: [
    ...reasons('received', 'warm', [
      ['aroused', 'It turned me on', 'Es hat mich angemacht'],
      ['close', 'I feel closer to you', 'Ich fühle mich dir näher'],
      ['safe', 'You are safe with me', 'Du bist sicher bei mir'],
      ['grateful', 'Thankful you told me', 'Dankbar, dass du es mir sagst'],
      ['proud', 'Proud of you', 'Stolz auf dich'],
      ['moved', 'Moved', 'Berührt'],
      ['more', 'I want to hear more', 'Ich will mehr hören'],
      ['surprised', 'Surprised, in a good way', 'Überrascht, auf gute Art'],
    ]),
    ...reasons('received', 'tender', [
      ['need-time', 'I need a moment to take it in', 'Ich brauche einen Moment dafür'],
      ['unsure', 'Not sure what to say', 'Unsicher, was ich sagen soll'],
      ['questions', 'I have questions', 'Ich habe Fragen'],
      ['jealous', 'A sting of jealousy', 'Ein Stich Eifersucht'],
      ['afraid', 'A little afraid', 'Ein bisschen Angst'],
    ]),
  ],
}

const BY_ID = new Map(Object.values(LIBRARY).flatMap((list) => list.map((reason) => [reason.id, reason] as const)))

export const reasonById = (id: string): Reason | undefined => BY_ID.get(id)

/** A reason in words. An id the app no longer knows (an old one) is shown as it was saved. */
export const reasonWords = (id: string, lang: Lang): string => BY_ID.get(id)?.[lang] ?? id

export const OWN_MAX = 60
export const OWN_LIMIT = 6
export const NOTE_MAX = 600

export const isEmptyWhy = (why: Why): boolean => why.chips.length === 0 && why.own.length === 0 && !why.note?.trim()

/** Tidy a why before it is saved: no blanks, no doubles, nothing over length. */
export function cleanWhy(why: Why): Why {
  const own = [...new Set(why.own.map((word) => word.trim().slice(0, OWN_MAX)).filter(Boolean))].slice(0, OWN_LIMIT)
  return { chips: [...new Set(why.chips)], own, note: why.note?.trim().slice(0, NOTE_MAX) || null }
}

/** Which tones a why touches: the first thing the Cockpit will want to know about it. */
export function tonesOf(why: Why): { warm: number; tender: number } {
  let warm = 0
  let tender = 0
  for (const id of why.chips) {
    const tone = BY_ID.get(id)?.tone
    if (tone === 'warm') warm += 1
    else if (tone === 'tender') tender += 1
  }
  return { warm, tender }
}
