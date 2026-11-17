// The questions a person answers about themselves: at the start, and again whenever they
// like. Each is a step between two poles, never a grade, and each can carry its why.
//
// The ids are what gets saved (as the note's `ref`), so they must never change.
// Where they come from: the dual control model (what speeds desire up, what slows it
// down), desire that comes first or follows (Basson), and research on how hard it is to
// say a like, a dislike and a no. DECISIONS.md, section 12, has the sources.

import type { Lang } from '../../i18n'

export interface Question {
  id: string
  /** Asked in the first look after signing up. The others wait on the page "About me". */
  first: boolean
  en: { ask: string; low: string; high: string }
  de: { ask: string; low: string; high: string }
}

export const QUESTIONS: Question[] = [
  {
    id: 'say',
    first: true,
    en: { ask: 'How easy is it for you to say what you would like?', low: 'Very hard', high: 'It comes easy' },
    de: { ask: 'Wie leicht fällt es dir, zu sagen, was du gern hättest?', low: 'Sehr schwer', high: 'Ganz leicht' },
  },
  {
    id: 'no',
    first: true,
    en: { ask: 'And to say what you would rather not?', low: 'Very hard', high: 'It comes easy' },
    de: { ask: 'Und zu sagen, was du lieber nicht möchtest?', low: 'Sehr schwer', high: 'Ganz leicht' },
  },
  {
    id: 'told',
    first: true,
    en: { ask: 'How much of what you like have you ever told anybody?', low: 'Almost nothing', high: 'Nearly all of it' },
    de: { ask: 'Wie viel von dem, was du magst, hast du je jemandem erzählt?', low: 'Fast nichts', high: 'Fast alles' },
  },
  {
    id: 'arrive',
    first: true,
    en: { ask: 'When does desire show up for you?', low: 'Once we are close', high: 'Out of nowhere' },
    de: { ask: 'Wann kommt die Lust bei dir?', low: 'Erst in der Nähe', high: 'Aus dem Nichts' },
  },
  {
    id: 'mind',
    first: true,
    en: { ask: 'How often does sex cross your mind?', low: 'Rarely', high: 'Many times a day' },
    de: { ask: 'Wie oft denkst du an Sex?', low: 'Selten', high: 'Viele Male am Tag' },
  },
  {
    id: 'brakes',
    first: true,
    en: { ask: 'How easily does something put you off: stress, a full head, a moment that does not fit?', low: 'Hardly ever', high: 'Very easily' },
    de: { ask: 'Wie schnell bringt dich etwas raus: Stress, ein voller Kopf, ein Moment, der nicht passt?', low: 'Kaum je', high: 'Sehr schnell' },
  },
  {
    id: 'lead',
    first: false,
    en: { ask: 'Who takes the first step?', low: 'I like to be led', high: 'I like to lead' },
    de: { ask: 'Wer macht den ersten Schritt?', low: 'Ich lasse mich gern führen', high: 'Ich führe gern' },
  },
  {
    id: 'new',
    first: false,
    en: { ask: 'What draws you more?', low: 'What I know', high: 'What is new' },
    de: { ask: 'Was zieht dich mehr an?', low: 'Das Vertraute', high: 'Das Neue' },
  },
  {
    id: 'asked',
    first: false,
    en: { ask: 'How do you like to be asked?', low: 'A hint is enough', high: 'Say it plainly' },
    de: { ask: 'Wie wirst du gern gefragt?', low: 'Ein Wink genügt', high: 'Sag es geradeheraus' },
  },
  {
    id: 'body',
    first: false,
    en: { ask: 'How at home are you in your body these days?', low: 'Not much', high: 'Very much' },
    de: { ask: 'Wie zu Hause bist du zurzeit in deinem Körper?', low: 'Wenig', high: 'Sehr' },
  },
  {
    id: 'after',
    first: false,
    en: { ask: 'And afterwards, what do you need?', low: 'Quiet', high: 'Words' },
    de: { ask: 'Und danach, was brauchst du?', low: 'Stille', high: 'Worte' },
  },
]

const BY_ID = new Map(QUESTIONS.map((question) => [question.id, question] as const))
export const questionById = (id: string): Question | undefined => BY_ID.get(id)
export const FIRST_QUESTIONS = QUESTIONS.filter((question) => question.first)

/** A question in the reader's language. An id the app no longer knows is shown as it was saved. */
export const questionWords = (id: string, lang: Lang): { ask: string; low: string; high: string } => BY_ID.get(id)?.[lang] ?? { ask: id, low: '', high: '' }
