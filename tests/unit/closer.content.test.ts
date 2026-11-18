import { describe, expect, it } from 'vitest'
import { DEFAULT_CHECKIN_TIMES, CHECKIN_SCALES } from '../../src/data/types'
import { FIRST_QUESTIONS, questionById, QUESTIONS, questionWords } from '../../src/features/about/library'
import { HAPPENED, happenedWords, OFTEN, oftenWords, SCALES } from '../../src/features/checkin/library'
import { checkinTimes } from '../../src/features/checkin/TimesPage'
import { stepWords } from '../../src/features/checkin/words'
import { isListItem, itemWords, OWN_SECTION, SECTIONS } from '../../src/features/list/library'
import { stepBetween } from '../../src/features/share/steps'
import { WISH_TAPS, wishTapById } from '../../src/features/wishes/library'

// The words that ship with the app for the first look, the check-in, the list and
// wishes. Their ids are what gets saved, so they must stay put; their wording follows
// the house rules; and none of it grades a person or is explicit.

const HOUSE = /[—–→·ß]/
const JUDGING = /\b(good|bad|wrong|normal|weird|healthy|should|gut|schlecht|falsch|komisch|gesund|sollte|solltest)\b/i
/** Words that would make a shipped item explicit. The list names things the way a mainstream platform's tags do. */
const EXPLICIT = /\b(anal|oral|cum|orgasm|penis|vagina|cock|pussy|fuck|blow|nipple|breast|genital|naked|nude|ficken|schwanz|muschi|blasen|nackt|brust|orgasmus)\w*/i
const both = <T extends { en: string; de: string }>(thing: T) => [thing.en, thing.de]

describe('the questions about myself', () => {
  it('each has an id of its own, a question and two poles in both languages', () => {
    expect(new Set(QUESTIONS.map((q) => q.id)).size).toBe(QUESTIONS.length)
    for (const question of QUESTIONS) {
      expect(question.id).toMatch(/^[a-z]+$/)
      for (const lang of ['en', 'de'] as const) {
        const { ask, low, high } = question[lang]
        expect(ask.trim().endsWith('?'), ask).toBe(true)
        for (const text of [ask, low, high]) {
          expect(text.trim(), question.id).not.toBe('')
          expect(text, text).not.toMatch(HOUSE)
          expect(text[0], text).toBe(text[0].toUpperCase())
        }
        // Two poles that are both all right: they never repeat each other.
        expect(low).not.toBe(high)
        expect(low.length, low).toBeLessThanOrEqual(28)
        expect(high.length, high).toBeLessThanOrEqual(28)
      }
    }
  })

  it('never grades: no pole and no question calls anything good, bad, healthy or normal', () => {
    for (const question of QUESTIONS) for (const lang of ['en', 'de'] as const) expect(Object.values(question[lang]).join(' '), question.id).not.toMatch(JUDGING)
  })

  it('the first look asks a handful, and every one of them is a question the page "About me" has too', () => {
    expect(FIRST_QUESTIONS.length).toBeGreaterThanOrEqual(4)
    expect(FIRST_QUESTIONS.length).toBeLessThanOrEqual(7)
    for (const question of FIRST_QUESTIONS) expect(questionById(question.id)).toBe(question)
  })

  it('these ids are saved on people\'s phones: they stay', () => {
    expect(QUESTIONS.map((q) => q.id)).toEqual(['say', 'no', 'told', 'arrive', 'mind', 'brakes', 'lead', 'new', 'asked', 'body', 'after'])
  })

  it('a question the app no longer knows is shown as it was saved', () => {
    expect(questionWords('say', 'de').ask).toBe('Wie leicht fällt es dir, zu sagen, was du gern hättest?')
    expect(questionWords('retired', 'en')).toEqual({ ask: 'retired', low: '', high: '' })
  })
})

describe('a step between two poles, in words', () => {
  it('the ends are the poles, the middle is in between, and the rest lean', () => {
    expect([1, 2, 3, 4, 5].map((value) => stepBetween('Very hard', 'It comes easy', value, 'en'))).toEqual(['Very hard', 'Rather "Very hard"', 'In between', 'Rather "It comes easy"', 'It comes easy'])
    expect(stepBetween('Sehr schwer', 'Ganz leicht', 4, 'de')).toBe('Eher «Ganz leicht»')
    // A mean of two check-ins reads as the nearest step.
    expect(stepBetween('Quiet', 'On fire', 4.6, 'en')).toBe('On fire')
    expect(stepWords('open', 1, 'en')).toBe('Slow today, please')
    expect(stepWords('open', 2, 'de')).toBe('Eher «Heute bitte langsam»')
  })
})

describe('the vocabulary of a check-in', () => {
  it('every scale has a question, two poles and a short name in both languages', () => {
    expect(Object.keys(SCALES).sort()).toEqual([...CHECKIN_SCALES].sort())
    for (const scale of CHECKIN_SCALES) {
      for (const lang of ['en', 'de'] as const) {
        const words = SCALES[scale][lang]
        expect(words.ask.endsWith('?'), words.ask).toBe(true)
        for (const text of Object.values(words)) {
          expect(text.trim()).not.toBe('')
          expect(text, text).not.toMatch(HOUSE)
          expect(text, text).not.toMatch(JUDGING)
        }
        expect(words.short.length, words.short).toBeLessThanOrEqual(22)
      }
    }
  })

  it('"how often" has five steps from not at all, in words', () => {
    expect(OFTEN.map((o) => o.value)).toEqual([0, 1, 2, 3, 4])
    expect(oftenWords(0, 'en')).toBe('Not at all')
    expect(oftenWords(4, 'de')).toBe('Fast die ganze Zeit')
  })

  it('what there was is a short list of plain words, with ids that stay', () => {
    expect(HAPPENED.map((h) => h.id)).toEqual(['tender', 'kiss', 'talk', 'flirt', 'sex', 'kinky', 'solo'])
    for (const thing of HAPPENED) for (const text of both(thing)) expect(text, text).not.toMatch(HOUSE)
    expect(happenedWords('tender', 'de')).toBe('Zärtlichkeit')
    expect(happenedWords('retired', 'en')).toBe('retired')
  })
})

describe('the two moments of the day', () => {
  it('a profile that says nothing gets the defaults, with no reminder', () => {
    expect(checkinTimes(undefined)).toEqual(DEFAULT_CHECKIN_TIMES)
    expect(checkinTimes({})).toEqual(DEFAULT_CHECKIN_TIMES)
    expect(DEFAULT_CHECKIN_TIMES.remind).toBe(false)
  })

  it('reads what a profile says, and ignores what makes no sense', () => {
    expect(checkinTimes({ checkin: { remind: true, times: ['07:15', '22:05'] } })).toEqual({ remind: true, times: ['07:15', '22:05'] })
    for (const odd of [{ remind: true, times: ['7:15', '22:05'] }, { remind: true, times: ['07:15'] }, { remind: true, times: ['25:00', '22:05'] }, { remind: true, times: 'soon' }]) {
      expect(checkinTimes({ checkin: odd as never })).toEqual(DEFAULT_CHECKIN_TIMES)
    }
    // "yes" is not true: no reminder goes out on a maybe.
    expect(checkinTimes({ checkin: { remind: 'yes' as never, times: ['07:15', '22:05'] } }).remind).toBe(false)
  })
})

describe('the list', () => {
  const items = SECTIONS.flatMap((section) => section.items)

  it('every group and item has words in both languages, and an id that carries its group', () => {
    expect(new Set(SECTIONS.map((s) => s.id)).size).toBe(SECTIONS.length)
    expect(new Set(items.map((i) => i.id)).size).toBe(items.length)
    for (const section of SECTIONS) {
      expect(section.id).toMatch(/^[a-z]+$/)
      expect(section.id).not.toBe(OWN_SECTION)
      expect(section.items.length).toBeGreaterThanOrEqual(5)
      for (const item of section.items) {
        expect(item.id).toMatch(new RegExp(`^${section.id}\\.[a-z]+$`))
        expect(item.id.length).toBeLessThanOrEqual(60)
        for (const text of both(item)) {
          expect(text.trim()).not.toBe('')
          expect(text.length, text).toBeLessThanOrEqual(34)
          expect(text, text).not.toMatch(HOUSE)
          expect(text, text).not.toMatch(/[.!]$/)
          expect(text[0], text).toBe(text[0].toUpperCase())
        }
      }
    }
  })

  it('within a group no two items read the same', () => {
    for (const section of SECTIONS) for (const lang of ['en', 'de'] as const) expect(new Set(section.items.map((i) => i[lang].toLowerCase())).size, `${section.id} ${lang}`).toBe(section.items.length)
  })

  it('ships no explicit text: plainly named things, the way a tag names them', () => {
    for (const thing of [...SECTIONS, ...items]) for (const text of both(thing)) expect(text, text).not.toMatch(EXPLICIT)
  })

  it('begins with tenderness and ends with what comes afterwards', () => {
    expect(SECTIONS[0].id).toBe('tender')
    expect(SECTIONS.at(-1)?.id).toBe('after')
  })

  it('these ids are saved on people\'s phones and in the cloud: a few of them, pinned', () => {
    for (const id of ['soft.massage', 'words.whisper', 'pace.unhurried', 'play.roles', 'looks.mirrors', 'lead.handing', 'senses.blindfolds', 'after.cuddle']) expect(isListItem(id), id).toBe(true)
  })

  it('names an item in the reader\'s language, an idea in its author\'s words, and nothing that is gone', () => {
    const idea = { id: 'idea-1', householdId: 'h', authorId: 'm', label: 'Breakfast in bed', section: OWN_SECTION, createdAt: '', updatedAt: '', deletedAt: null }
    expect(itemWords('soft.massage', 'de', [])).toBe('Massage')
    expect(itemWords('words.whisper', 'en', [])).toBe('Whispering')
    expect(itemWords('idea-1', 'de', [idea])).toBe('Breakfast in bed')
    expect(itemWords('idea-1', 'en', [{ ...idea, deletedAt: '2026-11-17T10:00:00Z', label: '' }])).toBeNull()
    expect(itemWords('nobody.knows', 'en', [idea])).toBeNull()
  })
})

describe('warm lines for the answer to a wish', () => {
  it('each has an id, a sign and words in both languages, and none of them decides anything', () => {
    expect(new Set(WISH_TAPS.map((tap) => tap.id)).size).toBe(WISH_TAPS.length)
    for (const tap of WISH_TAPS) {
      expect(tap.emoji).not.toBe('')
      for (const text of both(tap)) {
        expect(text, text).not.toMatch(HOUSE)
        // A warm line goes with a yes as well as with a no.
        expect(text.toLowerCase(), text).not.toMatch(/\b(yes|no|ja|nein)\b/)
      }
    }
    expect(wishTapById('glad')?.en).toBe('I like that you asked')
    expect(wishTapById('retired')).toBeUndefined()
  })
})
