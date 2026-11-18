// The vocabulary of a check-in: what is asked, between which poles, and the words for
// what there was since last time. Ids are what gets saved.
//
// Every scale describes and none of them grades: there is no good end and no bad end.
// A check-in asks about the day and the person, never about how an encounter went.

import type { CheckinScale, Often } from '../../data/types'

export interface ScaleWords {
  ask: string
  low: string
  high: string
  /** One or two words, for the line that says what somebody shared and for the cockpit. */
  short: string
}

export const SCALES: Record<CheckinScale, { en: ScaleWords; de: ScaleWords }> = {
  energy: {
    en: { ask: 'How much energy do you have?', low: 'Drained', high: 'Wide awake', short: 'Energy' },
    de: { ask: 'Wie viel Energie hast du?', low: 'Leer', high: 'Hellwach', short: 'Energie' },
  },
  mood: {
    en: { ask: 'How does the day feel?', low: 'Heavy', high: 'Light', short: 'The day' },
    de: { ask: 'Wie fühlt sich der Tag an?', low: 'Schwer', high: 'Leicht', short: 'Der Tag' },
  },
  close: {
    en: { ask: 'How close do you feel to each other?', low: 'Far away', high: 'Very close', short: 'Closeness' },
    de: { ask: 'Wie nah fühlt ihr euch an?', low: 'Weit weg', high: 'Ganz nah', short: 'Nähe' },
  },
  open: {
    en: { ask: 'How open are you for closeness right now?', low: 'Slow today, please', high: 'Come closer', short: 'Open for closeness' },
    de: { ask: 'Wie offen bist du gerade für Nähe?', low: 'Heute bitte langsam', high: 'Komm näher', short: 'Offen für Nähe' },
  },
  desire: {
    en: { ask: 'How much desire is there?', low: 'Quiet', high: 'On fire', short: 'Desire' },
    de: { ask: 'Wie viel Lust ist da?', low: 'Still', high: 'In Flammen', short: 'Lust' },
  },
  kinky: {
    en: { ask: 'How kinky do you feel?', low: 'Not at all', high: 'Very', short: 'Kinky' },
    de: { ask: 'Wie kinky fühlst du dich?', low: 'Gar nicht', high: 'Sehr', short: 'Kinky' },
  },
}

/** How often sex crossed my mind. The steps are words, not numbers. */
export const OFTEN: readonly { value: Often; en: string; de: string }[] = [
  { value: 0, en: 'Not at all', de: 'Gar nicht' },
  { value: 1, en: 'Once or twice', de: 'Ein-, zweimal' },
  { value: 2, en: 'Now and then', de: 'Ab und zu' },
  { value: 3, en: 'Often', de: 'Oft' },
  { value: 4, en: 'Most of the time', de: 'Fast die ganze Zeit' },
]

/** What there was since the last check-in. A log, never a tally to reach. */
export const HAPPENED: readonly { id: string; en: string; de: string }[] = [
  { id: 'tender', en: 'Tenderness', de: 'Zärtlichkeit' },
  { id: 'kiss', en: 'A kiss that lasted', de: 'Ein Kuss, der blieb' },
  { id: 'talk', en: 'A talk about us', de: 'Ein Gespräch über uns' },
  { id: 'flirt', en: 'Flirting', de: 'Geflirtet' },
  { id: 'sex', en: 'Sex', de: 'Sex' },
  { id: 'kinky', en: 'Something kinky', de: 'Etwas Kinky' },
  { id: 'solo', en: 'By myself', de: 'Für mich allein' },
]

const HAPPENED_BY_ID = new Map(HAPPENED.map((h) => [h.id, h] as const))
export const happenedWords = (id: string, lang: 'en' | 'de'): string => HAPPENED_BY_ID.get(id)?.[lang] ?? id
export const oftenWords = (value: Often, lang: 'en' | 'de'): string => OFTEN[value]?.[lang] ?? String(value)
