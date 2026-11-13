import { describe, expect, it } from 'vitest'
import { NO_WHY, type Why } from '../../src/data/types'
import { cleanWhy, isEmptyWhy, LIBRARY, NOTE_MAX, OWN_LIMIT, OWN_MAX, reasonById, reasonWords, tonesOf, type WhyContext } from '../../src/features/why/library'

// "And why?" is asked wherever somebody chooses or rates. What gets saved has to stay
// readable for years: the Cockpit counts reasons across time and across languages.

const contexts = Object.keys(LIBRARY) as WhyContext[]
const all = contexts.flatMap((context) => LIBRARY[context])

describe('the reasons on offer', () => {
  it('every reason has an id of its context, a tone, and words in both languages', () => {
    for (const context of contexts) {
      for (const reason of LIBRARY[context]) {
        expect(reason.id, reason.id).toMatch(new RegExp(`^${context}\\.[a-z]+(-[a-z]+)*$`))
        expect(['warm', 'tender']).toContain(reason.tone)
        expect(reason.en.trim(), reason.id).not.toBe('')
        expect(reason.de.trim(), reason.id).not.toBe('')
      }
    }
  })

  it('no id is used twice: an id is what gets saved', () => {
    expect(new Set(all.map((reason) => reason.id)).size).toBe(all.length)
  })

  it('no two reasons of one question read the same', () => {
    for (const context of contexts) {
      for (const lang of ['en', 'de'] as const) {
        const texts = LIBRARY[context].map((reason) => reason[lang].toLowerCase())
        expect(new Set(texts).size, `${context} ${lang}`).toBe(texts.length)
      }
    }
  })

  it('every question offers both tones: what was easy to feel, and what was harder', () => {
    for (const context of contexts) {
      const tones = LIBRARY[context].map((reason) => reason.tone)
      expect(tones.filter((tone) => tone === 'warm').length, context).toBeGreaterThanOrEqual(4)
      expect(tones.filter((tone) => tone === 'tender').length, context).toBeGreaterThanOrEqual(4)
    }
  })

  it('fits on a chip, and follows the house rules: sentence case, no em dashes, Swiss spelling', () => {
    for (const reason of all) {
      for (const text of [reason.en, reason.de]) {
        expect(text.length, text).toBeLessThanOrEqual(40)
        expect(text, text).not.toMatch(/[—–→·ß]/)
        expect(text, text).not.toMatch(/[.!]$/)
        expect(text[0], text).toBe(text[0].toUpperCase())
      }
    }
  })

  it('never judges: no reason calls a feeling good, bad, wrong or normal', () => {
    for (const reason of all) {
      expect(`${reason.en} ${reason.de}`.toLowerCase(), reason.id).not.toMatch(/\b(bad|wrong|normal|weird|schlecht|falsch|komisch|abnormal)\b/)
    }
  })

  it('finds a reason by its id, and words it in the reader\'s language', () => {
    expect(reasonById('said.brave')).toMatchObject({ tone: 'warm', en: 'Brave', de: 'Mutig' })
    expect(reasonWords('said.shy', 'de')).toBe('Schüchtern')
    expect(reasonWords('received.jealous', 'en')).toBe('A sting of jealousy')
  })

  it('shows a reason the app no longer knows as it was saved, instead of dropping it', () => {
    expect(reasonById('said.retired-long-ago')).toBeUndefined()
    expect(reasonWords('said.retired-long-ago', 'en')).toBe('said.retired-long-ago')
  })
})

describe('a why before it is saved', () => {
  const why = (changes: Partial<Why> = {}): Why => ({ ...NO_WHY, ...changes })

  it('is empty when nothing was chosen, added or written', () => {
    expect(isEmptyWhy(NO_WHY)).toBe(true)
    expect(isEmptyWhy(why({ note: '   ' }))).toBe(true)
    expect(isEmptyWhy(why({ chips: ['said.brave'] }))).toBe(false)
    expect(isEmptyWhy(why({ own: ['greedy'] }))).toBe(false)
    expect(isEmptyWhy(why({ note: 'because' }))).toBe(false)
  })

  it('is tidied: no blanks, no doubles, nothing over length', () => {
    const cleaned = cleanWhy({
      chips: ['said.brave', 'said.shy', 'said.brave'],
      own: ['  greedy ', '', 'greedy', '   ', 'x'.repeat(OWN_MAX + 20), ...Array.from({ length: 10 }, (_, i) => `word ${i}`)],
      note: `  ${'n'.repeat(NOTE_MAX + 50)}  `,
    })
    expect(cleaned.chips).toEqual(['said.brave', 'said.shy'])
    expect(cleaned.own).toHaveLength(OWN_LIMIT)
    expect(cleaned.own.slice(0, 2)).toEqual(['greedy', 'x'.repeat(OWN_MAX)])
    expect(cleaned.note).toHaveLength(NOTE_MAX)
  })

  it('an empty note is no note', () => {
    expect(cleanWhy(why({ note: '  \n ' })).note).toBeNull()
    expect(cleanWhy(why({ note: null })).note).toBeNull()
    expect(cleanWhy(why({ note: ' because I never thought I would ' })).note).toBe('because I never thought I would')
  })

  it('keeps her own words exactly as she wrote them', () => {
    expect(cleanWhy(why({ own: ['Wie ein Teenager', 'GREEDY'] })).own).toEqual(['Wie ein Teenager', 'GREEDY'])
  })

  it('does not change what it is given', () => {
    const given = why({ chips: ['said.brave', 'said.brave'], own: [' a '] })
    cleanWhy(given)
    expect(given).toEqual({ chips: ['said.brave', 'said.brave'], own: [' a '], note: null })
  })
})

describe('the tones of a why', () => {
  it('counts warm and tender, and both can be true of one moment', () => {
    expect(tonesOf({ chips: ['said.aroused', 'said.brave', 'said.exposed'], own: [], note: null })).toEqual({ warm: 2, tender: 1 })
    expect(tonesOf(NO_WHY)).toEqual({ warm: 0, tender: 0 })
  })

  it('her own words and unknown ids have no tone: nobody decides that for her', () => {
    expect(tonesOf({ chips: ['said.retired-long-ago'], own: ['greedy'], note: 'so much' })).toEqual({ warm: 0, tender: 0 })
  })
})
