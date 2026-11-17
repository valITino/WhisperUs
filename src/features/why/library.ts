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
 * about: why something about myself is the way it is.   checkin: what is behind how I am today.
 * leaning: why I answer an item of the list the way I do.
 * wish: why I wish for something.   decision: why I answer a wish the way I do.
 */
export type WhyContext = 'said' | 'received' | 'about' | 'checkin' | 'leaning' | 'wish' | 'decision'

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
  about: [
    ...reasons('about', 'warm', [
      ['safe', 'I feel safe with you', 'Ich fühle mich sicher bei dir'],
      ['know', 'I know myself here', 'Da kenne ich mich gut'],
      ['curious', 'I am curious about it', 'Ich bin neugierig darauf'],
      ['easier', 'It has been getting easier', 'Es wird leichter'],
      ['mine', 'I like this about me', 'Das mag ich an mir'],
    ]),
    ...reasons('about', 'tender', [
      ['no-words', 'I never had words for it', 'Mir fehlten immer die Worte'],
      ['taught', 'I learned to keep quiet about it', 'Ich habe gelernt, darüber zu schweigen'],
      ['afraid-no', 'Afraid of a no', 'Angst vor einem Nein'],
      ['hurt-you', 'I do not want to hurt you', 'Ich will dich nicht verletzen'],
      ['judged', 'Afraid of what you will think', 'Angst, was du denkst'],
      ['unsure', 'I am not sure myself', 'Ich weiss es selbst nicht genau'],
      ['before', 'Something from before us', 'Etwas von früher'],
      ['head', 'My head is often full', 'Mein Kopf ist oft voll'],
      ['body', 'My body and I are still making peace', 'Mein Körper und ich finden uns noch'],
    ]),
  ],
  checkin: [
    ...reasons('checkin', 'warm', [
      ['rested', 'Well rested', 'Ausgeschlafen'],
      ['time', 'Time for each other', 'Zeit füreinander'],
      ['talk', 'A talk that did me good', 'Ein Gespräch, das gut tat'],
      ['touch', 'A touch that stayed with me', 'Eine Berührung, die nachklingt'],
      ['wanted', 'I felt wanted', 'Ich fühlte mich begehrt'],
      ['body', 'At home in my body', 'Wohl in meinem Körper'],
      ['words', 'Something you said', 'Etwas, das du gesagt hast'],
      ['fantasy', 'A fantasy keeps coming back', 'Eine Fantasie kommt immer wieder'],
      ['looking', 'Looking forward to tonight', 'Vorfreude auf heute Abend'],
      ['alone', 'Time to myself', 'Zeit für mich'],
    ]),
    ...reasons('checkin', 'tender', [
      ['tired', 'Tired', 'Müde'],
      ['stress', 'Stressed', 'Gestresst'],
      ['head', 'My head is full', 'Mein Kopf ist voll'],
      ['body-off', 'Not at home in my body', 'Nicht zu Hause in meinem Körper'],
      ['unwell', 'In pain or unwell', 'Schmerzen oder krank'],
      ['cycle', 'My cycle', 'Mein Zyklus'],
      ['argued', 'We argued', 'Wir haben gestritten'],
      ['miss', 'I miss you', 'Du fehlst mir'],
      ['unseen', 'I feel unseen', 'Ich fühle mich nicht gesehen'],
      ['worry', 'Something worries me', 'Etwas macht mir Sorgen'],
      ['rushed', 'Everything is rushed', 'Alles ist gehetzt'],
      ['never-alone', 'We are never alone', 'Wir sind nie allein'],
    ]),
  ],
  leaning: [
    ...reasons('leaning', 'warm', [
      ['turns-on', 'It turns me on', 'Es macht mich an'],
      ['long', 'I have wanted this for a long time', 'Das wünsche ich mir schon lange'],
      ['trust', 'With you I would dare', 'Mit dir würde ich mich trauen'],
      ['liked', 'I liked it before', 'Ich mochte es schon einmal'],
      ['new', 'It would be new for us', 'Es wäre neu für uns'],
      ['give', 'I would love to give you that', 'Das würde ich dir gern schenken'],
      ['close', 'It makes me feel close', 'Es bringt mich dir nah'],
    ]),
    ...reasons('leaning', 'tender', [
      ['allowed', 'Not sure I am allowed to want this', 'Unsicher, ob ich das wollen darf'],
      ['think', 'Afraid of what you will think', 'Angst, was du denkst'],
      ['slowly', 'Only very slowly', 'Nur ganz langsam'],
      ['conditions', 'Only if a few things are clear', 'Nur wenn ein paar Dinge klar sind'],
      ['scares', 'It scares me a little', 'Es macht mir etwas Angst'],
      ['reminds', 'It reminds me of something', 'Es erinnert mich an etwas'],
      ['not-mine', 'It is just not mine', 'Es ist einfach nicht meins'],
      ['body', 'It does not suit my body', 'Es passt nicht zu meinem Körper'],
      ['head-only', 'In my head, yes. For real, no', 'Im Kopf ja. In echt nein'],
    ]),
  ],
  wish: [
    ...reasons('wish', 'warm', [
      ['long', 'I have carried this for a long time', 'Das trage ich schon lange mit mir'],
      ['turns-on', 'The thought alone turns me on', 'Schon der Gedanke macht mich an'],
      ['close', 'I want to feel close to you', 'Ich will dir nah sein'],
      ['seen', 'I want you to know me', 'Ich will, dass du mich kennst'],
      ['trust', 'Because I trust you', 'Weil ich dir vertraue'],
      ['play', 'I want us to play more', 'Ich will mehr mit dir spielen'],
      ['give', 'I want to give you something', 'Ich will dir etwas schenken'],
      ['again', 'It was so lovely the last time', 'Letztes Mal war es so schön'],
    ]),
    ...reasons('wish', 'tender', [
      ['nervous', 'Nervous to ask', 'Nervös, das zu fragen'],
      ['too-much', 'Afraid it is too much', 'Angst, dass es zu viel ist'],
      ['no-is-fine', 'A no would be all right', 'Ein Nein wäre in Ordnung'],
      ['differently', 'Afraid you will see me differently', 'Angst, dass du mich anders siehst'],
      ['missing', 'I have been missing this', 'Das hat mir gefehlt'],
      ['unsure', 'Not sure I want it for real', 'Unsicher, ob ich es in echt will'],
    ]),
  ],
  decision: [
    ...reasons('decision', 'warm', [
      ['want-too', 'I want that too', 'Das will ich auch'],
      ['glad', 'I am glad you asked', 'Ich bin froh, dass du fragst'],
      ['curious', 'You made me curious', 'Du hast mich neugierig gemacht'],
      ['for-you', 'I would love to do that for you', 'Das mache ich gern für dich'],
      ['trust', 'With you, yes', 'Mit dir, ja'],
      ['turns-on', 'It turns me on', 'Es macht mich an'],
    ]),
    ...reasons('decision', 'tender', [
      ['time', 'I need time with it', 'Ich brauche Zeit damit'],
      ['slower', 'Slower, please', 'Langsamer, bitte'],
      ['part', 'A part of it, yes', 'Einen Teil davon, ja'],
      ['another-time', 'Another time, gladly', 'Ein andermal, gern'],
      ['know-more', 'I need to know more first', 'Ich muss erst mehr wissen'],
      ['not-me', 'It is not for me', 'Es ist nichts für mich'],
      ['scares', 'It scares me a little', 'Es macht mir etwas Angst'],
      ['nothing-changes', 'It changes nothing about us', 'Es ändert nichts an uns'],
      ['jealous', 'A sting of jealousy', 'Ein Stich Eifersucht'],
    ]),
  ],
}

const BY_ID = new Map(Object.values(LIBRARY).flatMap((list) => list.map((reason) => [reason.id, reason] as const)))

export const reasonById = (id: string): Reason | undefined => BY_ID.get(id)

/** A reason in words. An id the app no longer knows (an old one) is shown as it was saved. */
export const reasonWords = (id: string, lang: Lang): string => BY_ID.get(id)?.[lang] ?? id

export { cleanWhy, isEmptyWhy, NOTE_MAX, OWN_LIMIT, OWN_MAX } from '../../data/why'

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
