// The list: things to say "I would like that", "I am curious", "only in my head" or
// "not for me" to, each of the two alone.
//
// What ships with the app are groups and plainly named items, the kind of word a
// mainstream platform shows as a tag. Nothing here is explicit, and nothing has to be:
// whatever the two of them want beyond it they write onto the list themselves, in their
// own words (`ideas`), and it then behaves like every other item.
//
// The ids are what gets saved, so they must never change. A retired item keeps its id.

import type { Lang } from '../../i18n'
import type { Idea } from '../../data/types'

export interface Item {
  id: string
  en: string
  de: string
}

export interface Section {
  id: string
  en: string
  de: string
  items: Item[]
}

const section = (id: string, en: string, de: string, items: [key: string, en: string, de: string][]): Section => ({ id, en, de, items: items.map(([key, itemEn, itemDe]) => ({ id: `${id}.${key}`, en: itemEn, de: itemDe })) })

export const SECTIONS: Section[] = [
  section('tender', 'Tenderness', 'Zärtlichkeit', [
    ['cuddling', 'Cuddling', 'Kuscheln'],
    ['hugs', 'Long hugs', 'Lange Umarmungen'],
    ['kissing', 'Slow kissing', 'Langsames Küssen'],
    ['held', 'Being held', 'Gehalten werden'],
    ['hands', 'Hand in hand', 'Hand in Hand'],
    ['eyes', 'Eye contact', 'Blickkontakt'],
    ['asleep', 'Falling asleep together', 'Zusammen einschlafen'],
  ]),
  section('romance', 'Romance', 'Romantik', [
    ['date', 'An evening for two', 'Ein Abend zu zweit'],
    ['letters', 'Love letters', 'Liebesbriefe'],
    ['candles', 'Candlelight', 'Kerzenlicht'],
    ['dancing', 'Slow dancing', 'Eng tanzen'],
    ['surprises', 'Surprises', 'Überraschungen'],
    ['away', 'A weekend away', 'Ein Wochenende weg'],
    ['compliments', 'Compliments', 'Komplimente'],
  ]),
  section('soft', 'Sensual touch', 'Sinnliche Berührung', [
    ['massage', 'Massage', 'Massage'],
    ['bath', 'A bath together', 'Zusammen baden'],
    ['oil', 'Scented oil', 'Duftöl'],
    ['light', 'Feather-light touch', 'Federleichte Berührung'],
    ['hair', 'Fingers in my hair', 'Finger im Haar'],
    ['back', 'Back scratching', 'Rücken kraulen'],
    ['slow', 'Taking it slow', 'Ganz langsam'],
  ]),
  section('words', 'Words and voice', 'Worte und Stimme', [
    ['whisper', 'Whispering', 'Flüstern'],
    ['voice', 'Voice notes', 'Sprachnachrichten'],
    ['messages', 'Flirty messages', 'Flirtende Nachrichten'],
    ['praise', 'Praise', 'Lob'],
    ['names', 'Pet names', 'Kosenamen'],
    ['teasing', 'Teasing words', 'Neckende Worte'],
    ['reading', 'Reading aloud', 'Vorlesen'],
    ['saying', 'Saying what I like', 'Sagen, was ich mag'],
    ['dirty', 'Dirty talk', 'Dirty Talk'],
  ]),
  section('place', 'Mood and place', 'Stimmung und Ort', [
    ['music', 'Music', 'Musik'],
    ['dim', 'Dim light', 'Gedämpftes Licht'],
    ['morning', 'In the morning', 'Am Morgen'],
    ['night', 'Late at night', 'Spät in der Nacht'],
    ['shower', 'In the shower', 'Unter der Dusche'],
    ['hotel', 'A hotel room', 'Ein Hotelzimmer'],
    ['new', 'Somewhere new', 'An einem neuen Ort'],
    ['outdoors', 'Outdoors, unseen', 'Draussen, ungesehen'],
  ]),
  section('pace', 'Pace', 'Tempo', [
    ['anticipation', 'Anticipation', 'Vorfreude'],
    ['build', 'A long build-up', 'Ein langer Aufbau'],
    ['teasing', 'Teasing', 'Reizen und warten lassen'],
    ['spontaneous', 'Spontaneous', 'Spontan'],
    ['planned', 'A planned evening', 'Ein geplanter Abend'],
    ['quick', 'Quick', 'Schnell'],
    ['unhurried', 'Unhurried', 'Ohne Eile'],
    ['turns', 'Taking turns', 'Abwechselnd'],
  ]),
  section('looks', 'Looks', 'Ansehen', [
    ['lingerie', 'Lingerie', 'Dessous'],
    ['dressing', 'Dressing up', 'Sich schön machen'],
    ['undressed', 'Being undressed', 'Ausgezogen werden'],
    ['watching', 'Watching', 'Zusehen'],
    ['watched', 'Being watched', 'Angesehen werden'],
    ['mirrors', 'Mirrors', 'Spiegel'],
    ['photos', 'Photos for each other', 'Fotos füreinander'],
  ]),
  section('play', 'Play and fantasy', 'Spiel und Fantasie', [
    ['roles', 'Role play', 'Rollenspiel'],
    ['strangers', 'Playing strangers', 'Fremde spielen'],
    ['fantasies', 'Sharing fantasies', 'Fantasien teilen'],
    ['dares', 'Dares', 'Mutproben'],
    ['games', 'Games', 'Spiele'],
    ['costumes', 'Costumes', 'Kostüme'],
    ['stories', 'Stories made up together', 'Gemeinsam erfundene Geschichten'],
  ]),
  section('lead', 'Leading and following', 'Führen und folgen', [
    ['charge', 'Being in charge', 'Das Sagen haben'],
    ['handing', 'Handing over control', 'Die Kontrolle abgeben'],
    ['giving', 'Giving instructions', 'Anweisungen geben'],
    ['following', 'Following instructions', 'Anweisungen folgen'],
    ['switching', 'Switching', 'Wechseln'],
    ['waiting', 'Being made to wait', 'Warten müssen'],
    ['rules', 'Rules for an evening', 'Regeln für einen Abend'],
  ]),
  section('senses', 'Restraint and senses', 'Fesseln und Sinne', [
    ['blindfolds', 'Blindfolds', 'Augenbinde'],
    ['ties', 'Soft ties', 'Weiche Fesseln'],
    ['cuffs', 'Handcuffs', 'Handschellen'],
    ['still', 'Being held still', 'Festgehalten werden'],
    ['ice', 'Ice and warmth', 'Eis und Wärme'],
    ['feathers', 'Feathers', 'Federn'],
    ['spanking', 'Light spanking', 'Leichte Klapse'],
  ]),
  section('extras', 'Toys and extras', 'Spielzeug und mehr', [
    ['toys', 'Toys together', 'Spielzeug zu zweit'],
    ['remote', 'Remote toys', 'Spielzeug mit Fernbedienung'],
    ['tools', 'Massage tools', 'Massagegeräte'],
    ['shopping', 'Shopping together', 'Zusammen einkaufen'],
    ['trying', 'Trying something new', 'Etwas Neues ausprobieren'],
  ]),
  section('after', 'Afterwards', 'Danach', [
    ['cuddle', 'Cuddling after', 'Danach kuscheln'],
    ['talk', 'Talking after', 'Danach reden'],
    ['quiet', 'Quiet together', 'Zusammen still sein'],
    ['snack', 'Water and a snack', 'Wasser und etwas Kleines'],
    ['shower', 'A shower together', 'Zusammen duschen'],
    ['message', 'A message the next day', 'Eine Nachricht am nächsten Tag'],
  ]),
]

/** Where the items the two of them wrote stand. */
export const OWN_SECTION = 'own'

const ITEMS = new Map(SECTIONS.flatMap((s) => s.items.map((item) => [item.id, item] as const)))

/**
 * An item in words: one of the app's in the reader's language, or what one of the two
 * wrote. Null for an id nobody knows any more (an idea that was taken off the list).
 */
export function itemWords(id: string, lang: Lang, ideas: readonly Idea[]): string | null {
  const known = ITEMS.get(id)
  if (known) return known[lang]
  const idea = ideas.find((i) => i.id === id && !i.deletedAt && i.label !== '')
  return idea ? idea.label : null
}

export const isListItem = (id: string): boolean => ITEMS.has(id)
